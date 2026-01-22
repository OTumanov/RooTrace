/**
 * Мониторинг качества контекста в сессии
 * Отслеживает состояние сессии, подсчитывает аномалии и автоматически сбрасывает при превышении порога
 */

import { AnomalyDetector, Anomaly, AnomalyDetectionResult } from './anomaly-detector';
import { ContextValidator, ValidationResult } from './context-validator';
import { logInfo, logDebug, handleWarning } from './error-handler';

export interface SessionContext {
  sessionId: string;
  startTime: number;
  messageCount: number;
  toolCallCount: number;
  errorCount: number;
  anomalyScore: number;
  lastActivity: number;
  actions: string[];
}

export interface MonitoringConfig {
  maxAnomalyScore: number; // Порог для автоматического сброса (по умолчанию 50)
  maxMessages: number; // Максимальное количество сообщений в сессии (по умолчанию 1000)
  maxToolCalls: number; // Максимальное количество вызовов инструментов (по умолчанию 500)
  resetOnAnomalyThreshold: boolean; // Автоматически сбрасывать при превышении порога
}

export type ContextResetCallback = (reason: string, sessionId: string) => void;

export class ContextMonitor {
  private static instance: ContextMonitor;
  private detector: AnomalyDetector;
  private sessions: Map<string, SessionContext> = new Map();
  private config: MonitoringConfig;
  private resetCallback: ContextResetCallback | null = null;

  private constructor() {
    this.detector = new AnomalyDetector();
    this.config = {
      maxAnomalyScore: 50,
      maxMessages: 1000,
      maxToolCalls: 500,
      resetOnAnomalyThreshold: true
    };
  }

  static getInstance(): ContextMonitor {
    if (!ContextMonitor.instance) {
      ContextMonitor.instance = new ContextMonitor();
    }
    return ContextMonitor.instance;
  }

  /**
   * Устанавливает конфигурацию мониторинга
   */
  setConfig(config: Partial<MonitoringConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Устанавливает callback для сброса контекста
   */
  setResetCallback(callback: ContextResetCallback): void {
    this.resetCallback = callback;
  }

  /**
   * Начинает мониторинг новой сессии
   */
  startSession(sessionId: string): void {
    const context: SessionContext = {
      sessionId,
      startTime: Date.now(),
      messageCount: 0,
      toolCallCount: 0,
      errorCount: 0,
      anomalyScore: 0,
      lastActivity: Date.now(),
      actions: []
    };
    this.sessions.set(sessionId, context);
    this.detector.clearHistory();
    logDebug(`[ContextMonitor] Started monitoring session: ${sessionId}`);
  }

  /**
   * Завершает мониторинг сессии
   */
  endSession(sessionId: string): void {
    const context = this.sessions.get(sessionId);
    if (context) {
      const duration = Date.now() - context.startTime;
      logInfo(
        `[ContextMonitor] Session ${sessionId} ended. Duration: ${duration}ms, Messages: ${context.messageCount}, Tool calls: ${context.toolCallCount}, Anomaly score: ${context.anomalyScore}`
      );
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Валидирует и мониторит входящее сообщение
   */
  validateAndMonitorMessage(
    sessionId: string,
    message: string,
    source: 'user' | 'agent' | 'tool'
  ): { valid: boolean; validation: ValidationResult; shouldReset: boolean } {
    const context = this.getOrCreateSession(sessionId);

    // Валидация текста
    const validation = ContextValidator.validateText(message, {
      maxLength: 200000,
      checkSuspiciousPatterns: true
    });

    if (!validation.valid) {
      context.errorCount++;
      logDebug(
        `[ContextMonitor] Message validation failed for session ${sessionId}: ${validation.errors.join(', ')}`
      );
    }

    // Детекция аномалий
    const detection = this.detector.detectAnomalies(message, undefined, undefined, context.actions);

    // Обновляем контекст
    context.messageCount++;
    context.lastActivity = Date.now();
    context.anomalyScore = Math.max(context.anomalyScore, detection.score);
    if (source === 'agent') {
      context.actions.push(`message:${message.substring(0, 50)}`);
    }

    // Проверяем, нужно ли сбросить сессию
    const shouldReset = this.checkResetCondition(context, detection);

    if (shouldReset && this.resetCallback) {
      const reason = `Anomaly score exceeded threshold: ${detection.score} > ${this.config.maxAnomalyScore}`;
      logWarning(
        `[ContextMonitor] Resetting session ${sessionId} due to: ${reason}`
      );
      this.resetCallback(reason, sessionId);
    }

    return {
      valid: validation.valid,
      validation,
      shouldReset
    };
  }

  /**
   * Валидирует и мониторит вызов инструмента
   */
  validateAndMonitorToolCall(
    sessionId: string,
    toolName: string,
    args: any,
    isError: boolean = false
  ): { valid: boolean; validation: ValidationResult; shouldReset: boolean } {
    const context = this.getOrCreateSession(sessionId);

    // Валидация вызова инструмента
    const validation = ContextValidator.validateToolCall(toolName, args);

    if (!validation.valid) {
      context.errorCount++;
      logDebug(
        `[ContextMonitor] Tool call validation failed for session ${sessionId}: ${validation.errors.join(', ')}`
      );
    }

    // Детекция аномалий
    const detection = this.detector.detectAnomalies(undefined, toolName, isError, context.actions);

    // Обновляем контекст
    context.toolCallCount++;
    context.lastActivity = Date.now();
    if (isError) {
      context.errorCount++;
    }
    context.anomalyScore = Math.max(context.anomalyScore, detection.score);
    context.actions.push(`tool:${toolName}`);

    // Проверяем лимиты
    if (context.toolCallCount > this.config.maxToolCalls) {
      const reason = `Tool call limit exceeded: ${context.toolCallCount} > ${this.config.maxToolCalls}`;
      logWarning(`[ContextMonitor] Tool call limit exceeded for session ${sessionId}`);
      if (this.resetCallback) {
        this.resetCallback(reason, sessionId);
      }
      return { valid: false, validation, shouldReset: true };
    }

    // Проверяем, нужно ли сбросить сессию
    const shouldReset = this.checkResetCondition(context, detection);

    if (shouldReset && this.resetCallback) {
      const reason = `Anomaly score exceeded threshold: ${detection.score} > ${this.config.maxAnomalyScore}`;
      logWarning(
        `[ContextMonitor] Resetting session ${sessionId} due to: ${reason}`
      );
      this.resetCallback(reason, sessionId);
    }

    return {
      valid: validation.valid,
      validation,
      shouldReset
    };
  }

  /**
   * Валидирует ответ инструмента
   */
  validateToolResponse(sessionId: string, response: any): ValidationResult {
    const validation = ContextValidator.validateToolResponse(response);

    if (!validation.valid) {
      const context = this.getOrCreateSession(sessionId);
      context.errorCount++;
      logDebug(
        `[ContextMonitor] Tool response validation failed for session ${sessionId}: ${validation.errors.join(', ')}`
      );
    }

    return validation;
  }

  /**
   * Получает или создает контекст сессии
   */
  private getOrCreateSession(sessionId: string): SessionContext {
    let context = this.sessions.get(sessionId);
    if (!context) {
      this.startSession(sessionId);
      context = this.sessions.get(sessionId)!;
    }
    return context;
  }

  /**
   * Проверяет условия для сброса сессии
   */
  private checkResetCondition(
    context: SessionContext,
    detection: AnomalyDetectionResult
  ): boolean {
    if (!this.config.resetOnAnomalyThreshold) {
      return false;
    }

    // Проверка на превышение порога аномалий
    if (detection.score > this.config.maxAnomalyScore) {
      return true;
    }

    // Проверка на превышение лимита сообщений
    if (context.messageCount > this.config.maxMessages) {
      return true;
    }

    // Проверка на критичные аномалии
    const criticalAnomalies = detection.anomalies.filter(
      (a) => a.severity === 'critical'
    );
    if (criticalAnomalies.length >= 3) {
      return true;
    }

    return false;
  }

  /**
   * Получает статистику сессии
   */
  getSessionStats(sessionId: string): SessionContext | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Получает историю аномалий для сессии
   */
  getAnomalyHistory(sessionId: string): Anomaly[] {
    return this.detector.getAnomalyHistory();
  }

  /**
   * Сбрасывает мониторинг сессии (без вызова callback)
   */
  resetSession(sessionId: string): void {
    const context = this.sessions.get(sessionId);
    if (context) {
      this.detector.clearHistory();
      context.messageCount = 0;
      context.toolCallCount = 0;
      context.errorCount = 0;
      context.anomalyScore = 0;
      context.actions = [];
      context.lastActivity = Date.now();
      logDebug(`[ContextMonitor] Reset monitoring for session: ${sessionId}`);
    }
  }
}

// Helper function для логирования предупреждений
function logWarning(message: string): void {
  console.warn(`[ContextMonitor] ${message}`);
  // handleWarning ожидает Error, но мы можем просто логировать
}
