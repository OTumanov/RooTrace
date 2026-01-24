/**
 * Формализованный алгоритм валидации гипотез
 * 
 * Реализует алгоритм подтверждения/отклонения гипотез на основе логов
 * с количественными порогами и обработкой конфликтов.
 */

import { RuntimeLog } from './types';

/**
 * Паттерн для валидации гипотезы
 */
export interface HypothesisValidation {
  hypothesisId: string;
  expectedPattern: RegExp | ((log: RuntimeLog) => boolean);
  minLogs: number;
  maxLogs?: number;
  timeWindow?: number; // в миллисекундах
  requiredFields?: string[]; // обязательные поля в log.data
}

/**
 * Результат валидации гипотезы
 */
export interface HypothesisValidationResult {
  hypothesisId: string;
  status: 'confirmed' | 'rejected' | 'missing';
  matchingLogs: RuntimeLog[];
  totalLogs: number;
  confidence: number; // 0-1, уверенность в результате
  reason: string;
}

/**
 * Валидирует гипотезу на основе логов
 * 
 * @param hypothesis - Конфигурация валидации гипотезы
 * @param logs - Массив логов для анализа
 * @param sinceTimestamp - Timestamp начала анализа (игнорируются логи до этого времени)
 * @returns Результат валидации с детальной информацией
 * 
 * @example
 * ```typescript
 * const validation: HypothesisValidation = {
 *   hypothesisId: 'H1',
 *   expectedPattern: (log) => log.data?.error !== undefined,
 *   minLogs: 3,
 *   requiredFields: ['error', 'stack']
 * };
 * 
 * const result = validateHypothesis(validation, logs, Date.now() - 60000);
 * if (result.status === 'confirmed') {
 *   console.log(`H1 confirmed with ${result.matchingLogs.length} logs`);
 * }
 * ```
 */
export function validateHypothesis(
  hypothesis: HypothesisValidation,
  logs: RuntimeLog[],
  sinceTimestamp: number
): HypothesisValidationResult {
  // Валидация входных данных
  if (!hypothesis.hypothesisId || typeof hypothesis.hypothesisId !== 'string') {
    throw new Error('hypothesisId must be a non-empty string');
  }
  if (hypothesis.minLogs < 1) {
    throw new Error('minLogs must be at least 1');
  }
  if (hypothesis.maxLogs !== undefined && hypothesis.maxLogs < hypothesis.minLogs) {
    throw new Error('maxLogs must be >= minLogs');
  }
  if (hypothesis.timeWindow !== undefined && hypothesis.timeWindow < 0) {
    throw new Error('timeWindow must be >= 0');
  }
  if (isNaN(sinceTimestamp) || sinceTimestamp < 0) {
    throw new Error(`Invalid sinceTimestamp: ${sinceTimestamp}. Expected a valid number (milliseconds).`);
  }
  
  // Фильтруем логи по hypothesisId и timestamp
  const relevantLogs = logs.filter(log => {
    if (log.hypothesisId !== hypothesis.hypothesisId) {
      return false;
    }
    const logTimestamp = new Date(log.timestamp).getTime();
    return logTimestamp >= sinceTimestamp;
  });

  // Если нет релевантных логов - гипотеза missing
  if (relevantLogs.length === 0) {
    return {
      hypothesisId: hypothesis.hypothesisId,
      status: 'missing',
      matchingLogs: [],
      totalLogs: 0,
      confidence: 0,
      reason: 'No logs found for this hypothesis after the specified timestamp'
    };
  }

  // Применяем временное окно если указано (используем sinceTimestamp как базовую точку)
  let filteredLogs = relevantLogs;
  if (hypothesis.timeWindow) {
    // Используем sinceTimestamp как базовую точку, но не раньше чем (текущее время - timeWindow)
    const windowStart = Math.max(sinceTimestamp, Date.now() - hypothesis.timeWindow);
    filteredLogs = relevantLogs.filter(log => {
      const logTimestamp = new Date(log.timestamp).getTime();
      return logTimestamp >= windowStart;
    });
  }

  // Проверяем обязательные поля
  if (hypothesis.requiredFields) {
    filteredLogs = filteredLogs.filter(log => {
      return hypothesis.requiredFields!.every(field => {
        return log.data && 
               typeof log.data === 'object' && 
               log.data !== null &&
               !Array.isArray(log.data) &&
               field in log.data;
      });
    });
  }

  // Применяем паттерн валидации
  const matchingLogs = filteredLogs.filter(log => {
    if (hypothesis.expectedPattern instanceof RegExp) {
      const logString = JSON.stringify(log.data);
      return hypothesis.expectedPattern.test(logString);
    } else {
      return hypothesis.expectedPattern(log);
    }
  });

  // Определяем статус на основе количества совпадений
  let status: 'confirmed' | 'rejected' | 'missing';
  let confidence: number;
  let reason: string;

  if (matchingLogs.length === 0) {
    status = 'rejected';
    // Confidence основан на количестве релевантных логов относительно минимума
    confidence = Math.min(1, filteredLogs.length / Math.max(hypothesis.minLogs, 1));
    reason = `No logs matched the expected pattern. Found ${filteredLogs.length} relevant logs but none matched.`;
  } else if (matchingLogs.length >= hypothesis.minLogs) {
    status = 'confirmed';
    // Улучшенное вычисление confidence: используем явную формулу
    const expectedLogs = hypothesis.maxLogs || hypothesis.minLogs * 2;
    const baseConfidence = matchingLogs.length / Math.max(expectedLogs, hypothesis.minLogs);
    // Дополнительный бонус если мы близки к ожидаемому количеству
    const bonus = hypothesis.maxLogs && matchingLogs.length <= hypothesis.maxLogs 
      ? 0.1 * (1 - Math.abs(matchingLogs.length - hypothesis.minLogs) / hypothesis.minLogs)
      : 0;
    confidence = Math.min(1, baseConfidence + bonus);
    reason = `Found ${matchingLogs.length} matching logs (minimum required: ${hypothesis.minLogs})`;
    
    // Проверяем maxLogs если указан
    if (hypothesis.maxLogs && matchingLogs.length > hypothesis.maxLogs) {
      reason += `. Warning: exceeded maximum expected logs (${hypothesis.maxLogs})`;
      // Снижаем confidence если превышен максимум
      confidence = Math.max(0.5, confidence - 0.2);
    }
  } else {
    status = 'rejected';
    // Confidence пропорционален количеству найденных логов относительно минимума
    confidence = matchingLogs.length / Math.max(hypothesis.minLogs, 1);
    reason = `Found only ${matchingLogs.length} matching logs, but minimum required is ${hypothesis.minLogs}`;
  }

  return {
    hypothesisId: hypothesis.hypothesisId,
    status,
    matchingLogs,
    totalLogs: filteredLogs.length,
    confidence,
    reason
  };
}

/**
 * Валидирует несколько гипотез одновременно
 * 
 * @param hypotheses - Массив конфигураций валидации
 * @param logs - Массив логов для анализа
 * @param sinceTimestamp - Timestamp начала анализа
 * @returns Массив результатов валидации
 */
export function validateHypotheses(
  hypotheses: HypothesisValidation[],
  logs: RuntimeLog[],
  sinceTimestamp: number
): HypothesisValidationResult[] {
  return hypotheses.map(hypothesis => 
    validateHypothesis(hypothesis, logs, sinceTimestamp)
  );
}

/**
 * Обрабатывает конфликты между гипотезами
 * 
 * Если несколько гипотез подтверждены одновременно, это может указывать на конфликт.
 * 
 * @param results - Результаты валидации гипотез
 * @returns Массив конфликтов (если есть)
 */
export interface HypothesisConflict {
  hypothesisIds: string[];
  reason: string;
  severity: 'low' | 'medium' | 'high';
}

export function detectConflicts(
  results: HypothesisValidationResult[]
): HypothesisConflict[] {
  const confirmed = results.filter(r => r.status === 'confirmed');
  const conflicts: HypothesisConflict[] = [];

  // Если подтверждено более 3 гипотез одновременно - возможен конфликт
  if (confirmed.length > 3) {
    conflicts.push({
      hypothesisIds: confirmed.map(r => r.hypothesisId),
      reason: `Too many hypotheses confirmed simultaneously (${confirmed.length}). This may indicate overlapping or conflicting root causes.`,
      severity: 'medium'
    });
  }

  // Проверяем гипотезы с высокой уверенностью (>0.8)
  const highConfidence = confirmed.filter(r => r.confidence > 0.8);
  if (highConfidence.length > 2) {
    conflicts.push({
      hypothesisIds: highConfidence.map(r => r.hypothesisId),
      reason: `Multiple high-confidence hypotheses (${highConfidence.length}). Review for potential conflicts.`,
      severity: 'high'
    });
  }

  return conflicts;
}
