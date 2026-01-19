/**
 * Типы данных для RooTrace
 */

/**
 * Типы данных, которые могут быть в логе
 * Используем рекурсивный тип для поддержки вложенных структур
 */
export type LogDataValue = 
  | string 
  | number 
  | boolean 
  | null 
  | undefined
  | LogDataArray
  | LogDataObject;

/**
 * Массив данных лога
 */
export interface LogDataArray extends Array<LogDataValue> {}

/**
 * Объект данных лога
 */
export interface LogDataObject {
  [key: string]: LogDataValue;
}

/**
 * Данные лога - может быть объектом, массивом или примитивом
 */
export type LogData = LogDataValue;

/**
 * Лог выполнения с типизированными данными
 */
export interface RuntimeLog {
  timestamp: string;
  hypothesisId: string;
  context: string;
  data: LogData;
}

/**
 * Гипотеза для отладки
 */
export interface Hypothesis {
  id: string;
  status: 'active' | 'testing' | 'pending' | 'resolved' | 'rejected';
  description: string;
}

/**
 * Уровни логирования
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

/**
 * Структурированное сообщение лога
 */
export interface StructuredLogMessage {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: string;
  error?: Error;
  metadata?: Record<string, unknown>;
}

/**
 * Метрики производительности
 */
export interface PerformanceMetrics {
  requestCount: number;
  averageResponseTime: number;
  errorCount: number;
  lastRequestTime: number;
  uptime: number;
}

/**
 * Статус здоровья системы
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  metrics: PerformanceMetrics;
  storage: {
    logCount: number;
    maxLogs: number;
    fileExists: boolean;
  };
  server: {
    port: number | null;
    running: boolean;
  };
}
