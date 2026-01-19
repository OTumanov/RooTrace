/**
 * Централизованный обработчик ошибок для RooTrace
 */

import { LogLevel, StructuredLogMessage } from './types';

// Условный импорт vscode
let vscode: typeof import('vscode') | undefined;
try {
  vscode = require('vscode');
} catch (e) {
  vscode = undefined;
}

let outputChannel: any = null;

/**
 * Инициализирует output channel для логирования
 */
export function initializeErrorHandler(channel: any): void {
  outputChannel = channel;
}

/**
 * Класс для централизованной обработки ошибок
 */
export class ErrorHandler {
  private static instance: ErrorHandler;
  private errorCount: number = 0;
  private lastError: Error | null = null;

  private constructor() {}

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * Обрабатывает ошибку с логированием и метриками
   */
  handleError(
    error: Error | unknown,
    context?: string,
    metadata?: Record<string, unknown>
  ): void {
    this.errorCount++;
    
    const err = error instanceof Error ? error : new Error(String(error));
    this.lastError = err;

    const logMessage: StructuredLogMessage = {
      level: LogLevel.ERROR,
      message: err.message,
      timestamp: new Date().toISOString(),
      context: context || 'Unknown',
      error: err,
      metadata: {
        ...metadata,
        stack: err.stack,
        errorCount: this.errorCount
      }
    };

    this.logStructured(logMessage);

    // В VS Code контексте показываем уведомление для критических ошибок
    if (vscode && context?.includes('CRITICAL')) {
      vscode.window.showErrorMessage(`RooTrace Error: ${err.message}`);
    }
  }

  /**
   * Обрабатывает предупреждение
   */
  handleWarning(
    message: string,
    context?: string,
    metadata?: Record<string, unknown>
  ): void {
    const logMessage: StructuredLogMessage = {
      level: LogLevel.WARN,
      message,
      timestamp: new Date().toISOString(),
      context: context || 'Unknown',
      metadata
    };

    this.logStructured(logMessage);
  }

  /**
   * Логирует информационное сообщение
   */
  logInfo(
    message: string,
    context?: string,
    metadata?: Record<string, unknown>
  ): void {
    const logMessage: StructuredLogMessage = {
      level: LogLevel.INFO,
      message,
      timestamp: new Date().toISOString(),
      context: context || 'Unknown',
      metadata
    };

    this.logStructured(logMessage);
  }

  /**
   * Логирует отладочное сообщение
   */
  logDebug(
    message: string,
    context?: string,
    metadata?: Record<string, unknown>
  ): void {
    const logMessage: StructuredLogMessage = {
      level: LogLevel.DEBUG,
      message,
      timestamp: new Date().toISOString(),
      context: context || 'Unknown',
      metadata
    };

    this.logStructured(logMessage);
  }

  /**
   * Логирует структурированное сообщение
   */
  private logStructured(log: StructuredLogMessage): void {
    const logLine = this.formatStructuredLog(log);
    const formattedMessage = `[${log.level.toUpperCase()}] ${logLine}`;
    
    // Логируем в консоль для MCP сервера
    if (vscode === undefined) {
      // DEBUG и INFO идут в stdout, WARN и ERROR в stderr
      if (log.level === LogLevel.DEBUG || log.level === LogLevel.INFO) {
        console.log(formattedMessage);
      } else {
        console.error(formattedMessage);
      }
      return;
    }

    // Логируем в output channel для VS Code
    if (outputChannel) {
      outputChannel.appendLine(formattedMessage);
    } else {
      // DEBUG и INFO идут в stdout, WARN и ERROR в stderr
      if (log.level === LogLevel.DEBUG || log.level === LogLevel.INFO) {
        console.log(formattedMessage);
      } else {
        console.error(formattedMessage);
      }
    }
  }

  /**
   * Форматирует структурированный лог в строку
   */
  private formatStructuredLog(log: StructuredLogMessage): string {
    const parts: string[] = [];
    
    parts.push(`[${log.timestamp}]`);
    if (log.context) {
      parts.push(`[${log.context}]`);
    }
    parts.push(log.message);
    
    if (log.error) {
      parts.push(`\nError: ${log.error.message}`);
      if (log.error.stack) {
        parts.push(`\nStack: ${log.error.stack}`);
      }
    }
    
    if (log.metadata && Object.keys(log.metadata).length > 0) {
      parts.push(`\nMetadata: ${JSON.stringify(log.metadata, null, 2)}`);
    }
    
    return parts.join(' ');
  }

  /**
   * Получает статистику ошибок
   */
  getErrorStats(): { count: number; lastError: Error | null } {
    return {
      count: this.errorCount,
      lastError: this.lastError
    };
  }

  /**
   * Сбрасывает счетчик ошибок (для тестов)
   */
  reset(): void {
    this.errorCount = 0;
    this.lastError = null;
  }
}

/**
 * Вспомогательные функции для удобного использования
 */
export const errorHandler = ErrorHandler.getInstance();

export function handleError(
  error: Error | unknown,
  context?: string,
  metadata?: Record<string, unknown>
): void {
  errorHandler.handleError(error, context, metadata);
}

export function handleWarning(
  message: string,
  context?: string,
  metadata?: Record<string, unknown>
): void {
  errorHandler.handleWarning(message, context, metadata);
}

export function logInfo(
  message: string,
  context?: string,
  metadata?: Record<string, unknown>
): void {
  errorHandler.logInfo(message, context, metadata);
}

export function logDebug(
  message: string,
  context?: string,
  metadata?: Record<string, unknown>
): void {
  errorHandler.logDebug(message, context, metadata);
}
