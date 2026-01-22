/**
 * Детектор аномалий для защиты от отравления контекста
 * Обнаруживает повторяющиеся ответы, галлюцинации и некорректные паттерны
 */

export interface Anomaly {
  type: 'repetition' | 'hallucination' | 'tool_abuse' | 'nonsense' | 'loop';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: number;
  context?: any;
}

export interface AnomalyDetectionResult {
  hasAnomalies: boolean;
  anomalies: Anomaly[];
  score: number; // 0-100, чем выше, тем больше аномалий
}

export interface ToolUsagePattern {
  toolName: string;
  count: number;
  lastUsed: number;
  errors: number;
}

export class AnomalyDetector {
  private static readonly REPETITION_THRESHOLD = 3; // Количество повторений для детекции
  private static readonly REPETITION_WINDOW_MS = 60000; // 1 минута
  private static readonly MAX_TOOL_CALLS_PER_MINUTE = 50;
  private static readonly MAX_SAME_TOOL_CALLS_PER_MINUTE = 20;
  private static readonly NONSENSE_THRESHOLD = 0.3; // Порог для детекции бессмысленного текста

  private recentMessages: Array<{ text: string; timestamp: number }> = [];
  private toolUsage: Map<string, ToolUsagePattern> = new Map();
  private anomalyHistory: Anomaly[] = [];

  /**
   * Очищает историю (для новой сессии)
   */
  clearHistory(): void {
    this.recentMessages = [];
    this.toolUsage.clear();
    this.anomalyHistory = [];
  }

  /**
   * Детектирует повторяющиеся сообщения
   */
  detectRepetition(text: string): Anomaly | null {
    const now = Date.now();
    const recent = this.recentMessages.filter(
      (m) => now - m.timestamp < AnomalyDetector.REPETITION_WINDOW_MS
    );

    // Нормализуем текст для сравнения (убираем пробелы, приводим к нижнему регистру)
    const normalized = text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200); // Берем первые 200 символов для сравнения

    const similarCount = recent.filter((m) => {
      const mNormalized = m.text
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 200);
      return mNormalized === normalized;
    }).length;

    if (similarCount >= AnomalyDetector.REPETITION_THRESHOLD) {
      return {
        type: 'repetition',
        severity: similarCount >= 5 ? 'critical' : similarCount >= 3 ? 'high' : 'medium',
        message: `Message repeated ${similarCount + 1} times in last minute`,
        timestamp: now,
        context: { normalized, count: similarCount + 1 }
      };
    }

    // Добавляем сообщение в историю
    this.recentMessages.push({ text, timestamp: now });
    // Очищаем старые сообщения
    this.recentMessages = this.recentMessages.filter(
      (m) => now - m.timestamp < AnomalyDetector.REPETITION_WINDOW_MS * 2
    );

    return null;
  }

  /**
   * Детектирует бессмысленные ответы
   */
  detectNonsense(text: string): Anomaly | null {
    if (!text || text.length < 10) {
      return null;
    }

    // Проверка на повторяющиеся символы (например, "aaaaaaaa" или "1111111")
    const charRepetition = /(.)\1{20,}/.test(text);
    if (charRepetition) {
      return {
        type: 'nonsense',
        severity: 'high',
        message: 'Text contains excessive character repetition',
        timestamp: Date.now()
      };
    }

    // Проверка на повторяющиеся слова/фразы
    const words = text.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words);
    const repetitionRatio = uniqueWords.size / words.length;
    if (repetitionRatio < AnomalyDetector.NONSENSE_THRESHOLD && words.length > 20) {
      return {
        type: 'nonsense',
        severity: 'medium',
        message: `Low word diversity: ${uniqueWords.size}/${words.length} unique words`,
        timestamp: Date.now(),
        context: { repetitionRatio, uniqueWords: uniqueWords.size, totalWords: words.length }
      };
    }

    // Проверка на только спецсимволы или цифры
    const onlySpecialChars = /^[^a-zA-Zа-яА-Я]{20,}$/.test(text);
    if (onlySpecialChars) {
      return {
        type: 'nonsense',
        severity: 'high',
        message: 'Text contains only special characters or numbers',
        timestamp: Date.now()
      };
    }

    return null;
  }

  /**
   * Детектирует злоупотребление инструментами
   */
  detectToolAbuse(toolName: string, isError: boolean = false): Anomaly | null {
    const now = Date.now();
    const pattern = this.toolUsage.get(toolName) || {
      toolName,
      count: 0,
      lastUsed: 0,
      errors: 0
    };

    pattern.count++;
    pattern.lastUsed = now;
    if (isError) {
      pattern.errors++;
    }

    this.toolUsage.set(toolName, pattern);

    // Очищаем старые записи
    const oneMinuteAgo = now - 60000;
    if (pattern.lastUsed < oneMinuteAgo) {
      pattern.count = 1;
      pattern.errors = isError ? 1 : 0;
    }

    // Проверка на слишком частые вызовы одного инструмента
    if (pattern.count > AnomalyDetector.MAX_SAME_TOOL_CALLS_PER_MINUTE) {
      return {
        type: 'tool_abuse',
        severity: pattern.count > 30 ? 'critical' : 'high',
        message: `Tool ${toolName} called ${pattern.count} times in last minute`,
        timestamp: now,
        context: { toolName, count: pattern.count, errors: pattern.errors }
      };
    }

    // Проверка на общее количество вызовов инструментов
    const totalCalls = Array.from(this.toolUsage.values()).reduce(
      (sum, p) => sum + (now - p.lastUsed < 60000 ? p.count : 0),
      0
    );
    if (totalCalls > AnomalyDetector.MAX_TOOL_CALLS_PER_MINUTE) {
      return {
        type: 'tool_abuse',
        severity: totalCalls > 100 ? 'critical' : 'high',
        message: `Total tool calls exceeded limit: ${totalCalls} > ${AnomalyDetector.MAX_TOOL_CALLS_PER_MINUTE}`,
        timestamp: now,
        context: { totalCalls }
      };
    }

    // Проверка на высокий процент ошибок
    if (pattern.count >= 5 && pattern.errors / pattern.count > 0.5) {
      return {
        type: 'tool_abuse',
        severity: 'medium',
        message: `Tool ${toolName} has high error rate: ${pattern.errors}/${pattern.count} (${Math.round((pattern.errors / pattern.count) * 100)}%)`,
        timestamp: now,
        context: { toolName, errors: pattern.errors, total: pattern.count }
      };
    }

    return null;
  }

  /**
   * Детектирует зацикливание (loop)
   */
  detectLoop(actions: string[]): Anomaly | null {
    if (actions.length < 3) {
      return null;
    }

    // Проверка на повторяющуюся последовательность действий
    const lastThree = actions.slice(-3).join(' -> ');
    const previousThree = actions.length >= 6 ? actions.slice(-6, -3).join(' -> ') : null;

    if (previousThree && lastThree === previousThree) {
      return {
        type: 'loop',
        severity: 'high',
        message: 'Detected action loop: same sequence repeated',
        timestamp: Date.now(),
        context: { sequence: lastThree, count: 2 }
      };
    }

    // Проверка на повторение одного и того же действия
    const lastAction = actions[actions.length - 1];
    const sameActionCount = actions.filter((a) => a === lastAction).length;
    if (sameActionCount >= 5) {
      return {
        type: 'loop',
        severity: sameActionCount >= 10 ? 'critical' : 'high',
        message: `Action "${lastAction}" repeated ${sameActionCount} times`,
        timestamp: Date.now(),
        context: { action: lastAction, count: sameActionCount }
      };
    }

    return null;
  }

  /**
   * Комплексная проверка на аномалии
   */
  detectAnomalies(
    text?: string,
    toolName?: string,
    isError?: boolean,
    actions?: string[]
  ): AnomalyDetectionResult {
    const anomalies: Anomaly[] = [];

    // Проверка на повторения в тексте
    if (text) {
      const repetitionAnomaly = this.detectRepetition(text);
      if (repetitionAnomaly) {
        anomalies.push(repetitionAnomaly);
      }

      const nonsenseAnomaly = this.detectNonsense(text);
      if (nonsenseAnomaly) {
        anomalies.push(nonsenseAnomaly);
      }
    }

    // Проверка на злоупотребление инструментами
    if (toolName) {
      const toolAbuseAnomaly = this.detectToolAbuse(toolName, isError);
      if (toolAbuseAnomaly) {
        anomalies.push(toolAbuseAnomaly);
      }
    }

    // Проверка на зацикливание
    if (actions && actions.length > 0) {
      const loopAnomaly = this.detectLoop(actions);
      if (loopAnomaly) {
        anomalies.push(loopAnomaly);
      }
    }

    // Сохраняем аномалии в историю
    this.anomalyHistory.push(...anomalies);
    // Ограничиваем историю последними 100 аномалиями
    if (this.anomalyHistory.length > 100) {
      this.anomalyHistory = this.anomalyHistory.slice(-100);
    }

    // Вычисляем score (0-100)
    let score = 0;
    for (const anomaly of anomalies) {
      switch (anomaly.severity) {
        case 'critical':
          score += 30;
          break;
        case 'high':
          score += 20;
          break;
        case 'medium':
          score += 10;
          break;
        case 'low':
          score += 5;
          break;
      }
    }
    score = Math.min(100, score);

    return {
      hasAnomalies: anomalies.length > 0,
      anomalies,
      score
    };
  }

  /**
   * Получает историю аномалий
   */
  getAnomalyHistory(): Anomaly[] {
    return [...this.anomalyHistory];
  }

  /**
   * Получает статистику использования инструментов
   */
  getToolUsageStats(): Map<string, ToolUsagePattern> {
    return new Map(this.toolUsage);
  }
}
