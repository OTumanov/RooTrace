/**
 * Метрики производительности для RooTrace
 */

import { PerformanceMetrics, HealthStatus } from './types';
import { SharedLogStorage } from './shared-log-storage';
import * as fs from 'fs';
import * as path from 'path';
import { getRootraceFilePath } from './rootrace-dir-utils';

// Условный импорт vscode
let vscode: typeof import('vscode') | undefined;
try {
  vscode = require('vscode');
} catch (e) {
  vscode = undefined;
}

/**
 * Класс для сбора и хранения метрик производительности
 */
export class MetricsCollector {
  private static instance: MetricsCollector;
  private startTime: number = Date.now();
  private requestCount: number = 0;
  private errorCount: number = 0;
  private responseTimes: number[] = [];
  private lastRequestTime: number = 0;
  private readonly maxResponseTimeWindow: number = 100;

  private constructor() {}

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  /**
   * Регистрирует выполненный запрос
   */
  recordRequest(responseTime: number): void {
    this.requestCount++;
    this.lastRequestTime = Date.now();
    
    // Храним только последние N значений для расчета среднего
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > this.maxResponseTimeWindow) {
      this.responseTimes.shift();
    }
  }

  /**
   * Регистрирует ошибку
   */
  recordError(): void {
    this.errorCount++;
  }

  /**
   * Получает текущие метрики
   */
  getMetrics(): PerformanceMetrics {
    const averageResponseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
      : 0;

    return {
      requestCount: this.requestCount,
      averageResponseTime: Math.round(averageResponseTime),
      errorCount: this.errorCount,
      lastRequestTime: this.lastRequestTime,
      uptime: Date.now() - this.startTime
    };
  }

  /**
   * Получает статус здоровья системы
   */
  async getHealthStatus(serverPort: number | null, serverRunning: boolean): Promise<HealthStatus> {
    const storage = SharedLogStorage.getInstance();
    const logCount = storage.getLogCount();
    
    // Получаем максимальное количество логов из конфигурации
    let maxLogs = 1000;
    if (vscode) {
      try {
        const config = vscode.workspace.getConfiguration('rooTrace');
        maxLogs = config.get<number>('maxLogs', 1000);
      } catch (e) {
        // Игнорируем ошибки
      }
    }

    // Проверяем существование файла логов
    let fileExists = false;
    try {
      const logFilePath = getRootraceFilePath('ai_debug_logs.json');
      fileExists = fs.existsSync(logFilePath);
    } catch (e) {
      // Игнорируем ошибки
    }

    const metrics = this.getMetrics();
    
    // Определяем статус здоровья
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (!serverRunning) {
      status = 'unhealthy';
    } else if (metrics.errorCount > 10 || metrics.averageResponseTime > 1000) {
      status = 'degraded';
    }

    return {
      status,
      uptime: metrics.uptime,
      metrics,
      storage: {
        logCount,
        maxLogs,
        fileExists
      },
      server: {
        port: serverPort,
        running: serverRunning
      }
    };
  }

  /**
   * Сбрасывает метрики (для тестов)
   */
  reset(): void {
    this.requestCount = 0;
    this.errorCount = 0;
    this.responseTimes = [];
    this.lastRequestTime = 0;
    this.startTime = Date.now();
  }
}

export const metricsCollector = MetricsCollector.getInstance();
