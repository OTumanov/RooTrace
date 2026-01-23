// Shared log storage для синхронизации между HTTP и MCP серверами

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { decryptObject, getEncryptionKey } from './encryption-utils';
import { withFileLock } from './file-lock-utils';
import { RuntimeLog, Hypothesis, LogData } from './types';
import { handleError, logDebug } from './error-handler';
import { parseArrayOrDecrypt } from './utils';
import { WATCHER_CONFIG, STORAGE_CONFIG } from './constants';
import { getRootraceFilePath } from './rootrace-dir-utils';

// Re-export типы для обратной совместимости
export type { RuntimeLog, Hypothesis, LogData };

// Условный импорт vscode - доступен только в контексте VS Code расширения
let vscode: typeof import('vscode') | undefined;
try {
  vscode = require('vscode');
} catch (e) {
  // vscode недоступен (например, в MCP сервере) - это нормально
  vscode = undefined;
}

/**
 * Singleton класс для хранения логов отладки
 * Используется как HTTP сервером, так и MCP сервером
 */
export class SharedLogStorage extends EventEmitter {
  private static instance: SharedLogStorage;
  private logs: RuntimeLog[] = [];
  private hypotheses: Map<string, Hypothesis> = new Map();
  
  /**
   * Получает максимальное количество логов из конфигурации VS Code
   * @returns Максимальное количество логов (по умолчанию 1000)
   */
  private getMaxLogs(): number {
    if (vscode) {
      try {
        const config = vscode.workspace.getConfiguration('rooTrace');
        return config.get<number>('maxLogs', STORAGE_CONFIG.DEFAULT_MAX_LOGS);
      } catch (e) {
        // Игнорируем ошибки при доступе к конфигурации в MCP контексте
      }
    }
    return STORAGE_CONFIG.DEFAULT_MAX_LOGS;
  }
  // Индексы для быстрого поиска
  private hypothesisIndex: Map<string, number[]> = new Map();
  private timestampIndex: Map<number, number[]> = new Map();
  
  // Флаг для отслеживания watcher'а файла
  private isWatcherActive: boolean = false;
  // Debounce таймер для watcher'а
  private watcherDebounceTimer: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    // Инициализация предустановленных гипотез
    this.hypotheses.set('H1', { id: 'H1', status: 'active', description: 'Primary hypothesis' });
    this.hypotheses.set('H2', { id: 'H2', status: 'testing', description: 'Secondary hypothesis' });
    this.hypotheses.set('H3', { id: 'H3', status: 'pending', description: 'Tertiary hypothesis' });
    this.hypotheses.set('H4', { id: 'H4', status: 'pending', description: 'Fourth hypothesis' });
    this.hypotheses.set('H5', { id: 'H5', status: 'pending', description: 'Fifth hypothesis' });
    
    // Инициализация хранилища и запуск watcher'а
    this.initStorage();
  }
  
  /**
   * Инициализирует хранилище: создает файл если нужно, запускает watcher
   */
  private async initStorage(): Promise<void> {
    const logFilePath = this.getLogFilePath();
    
    // Создаем файл если его нет
    if (!fs.existsSync(logFilePath)) {
      await this.saveToFile([]);
    }
    
    // Запускаем watcher для отслеживания изменений файла
    this.startWatcher();
  }
  
  /**
   * Запускает watcher для отслеживания изменений файла логов
   * Используется в MCP контексте для синхронизации с HTTP сервером
   * Использует debounce для оптимизации производительности
   */
  private startWatcher(): void {
    if (this.isWatcherActive) return;
    
    const logFilePath = this.getLogFilePath();
    
    // БЕЗОТКАЗНОСТЬ: Следим за изменениями файла, чтобы MCP всегда был в курсе
    // Оптимизация: используем debounce для уменьшения количества операций чтения
    fs.watchFile(logFilePath, { interval: WATCHER_CONFIG.CHECK_INTERVAL_MS }, async (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        // Очищаем предыдущий таймер debounce
        if (this.watcherDebounceTimer) {
          clearTimeout(this.watcherDebounceTimer);
        }
        
        // Устанавливаем новый таймер с debounce
        this.watcherDebounceTimer = setTimeout(async () => {
          try {
            await this.loadFromFile();
            this.emit('logsUpdated', this.logs);
            logDebug('File watcher: logs reloaded', 'SharedLogStorage');
          } catch (error) {
            handleError(error, 'SharedLogStorage.watcher', { filePath: logFilePath });
          }
          this.watcherDebounceTimer = null;
        }, WATCHER_CONFIG.DEBOUNCE_DELAY_MS);
      }
    });
    
    this.isWatcherActive = true;
  }

  /**
   * Останавливает watcher файла (для тестов и cleanup)
   */
  stopWatcher(): void {
    if (!this.isWatcherActive) return;
    
    // Очищаем debounce таймер
    if (this.watcherDebounceTimer) {
      clearTimeout(this.watcherDebounceTimer);
      this.watcherDebounceTimer = null;
    }
    
    const logFilePath = this.getLogFilePath();
    try {
      fs.unwatchFile(logFilePath);
      this.isWatcherActive = false;
    } catch (e) {
      handleError(e, 'SharedLogStorage.stopWatcher', { filePath: logFilePath });
    }
  }
  
  /**
   * Загружает логи из файла с использованием блокировки
   */
  private async loadFromFile(): Promise<void> {
    const logFilePath = this.getLogFilePath();
    
    try {
      await withFileLock(logFilePath, async () => {
        if (!fs.existsSync(logFilePath)) {
          logDebug(`File does not exist: ${logFilePath}, initializing empty logs`, 'SharedLogStorage.loadFromFile');
          this.logs = [];
          this.rebuildIndexes();
          return;
        }
        
        const fileContent = fs.readFileSync(logFilePath, 'utf8');
        logDebug(`Loaded file content (${fileContent.length} chars): ${fileContent.substring(0, 100)}...`, 'SharedLogStorage.loadFromFile');
        
        if (!fileContent.trim()) {
          logDebug('File is empty or whitespace only, initializing empty logs', 'SharedLogStorage.loadFromFile');
          this.logs = [];
          this.rebuildIndexes();
          return;
        }
        
        let logs: RuntimeLog[] = [];
        
        // Используем общую утилиту для парсинга массива с fallback на дешифровку
        logs = parseArrayOrDecrypt<any>(fileContent, []);
        if (logs.length > 0) {
          logDebug(`Loaded ${logs.length} logs from file`, 'SharedLogStorage.loadFromFile');
        }
        
        // Проверяем, что это массив
        if (!Array.isArray(logs)) {
          this.logs = [];
          this.rebuildIndexes();
          return;
        }
        
        // Загружаем логи в память с валидацией типов
        this.logs = [];
        for (const logEntry of logs) {
          // Проверяем формат лога
          if (logEntry && typeof logEntry === 'object' && 
              'timestamp' in logEntry && 
              'hypothesisId' in logEntry && 
              'context' in logEntry) {
            const log: RuntimeLog = {
              timestamp: String(logEntry.timestamp),
              hypothesisId: String(logEntry.hypothesisId),
              context: String(logEntry.context || ''),
              data: (logEntry.data as LogData) || {}
            };
            
            this.logs.push(log);
          }
        }
        
        // Ограничиваем размер логов
        const maxLogs = this.getMaxLogs();
        if (this.logs.length > maxLogs) {
          this.logs = this.logs.slice(-maxLogs);
        }
        
        // Пересоздаем индексы
        this.rebuildIndexes();
        logDebug(`Successfully loaded ${this.logs.length} logs from file`, 'SharedLogStorage.loadFromFile');
      });
    } catch (error) {
      handleError(error, 'SharedLogStorage.loadFromFile', { filePath: logFilePath });
      this.logs = [];
      this.rebuildIndexes();
    }
  }
  
  /**
   * Сохраняет логи в файл с использованием блокировки
   */
  private async saveToFile(logs: RuntimeLog[]): Promise<void> {
    const logFilePath = this.getLogFilePath();
    logDebug(`saveToFile called: saving ${logs.length} logs to ${logFilePath}`, 'SharedLogStorage.saveToFile');
    
    try {
      await withFileLock(logFilePath, async () => {
        // Создаем директорию если её нет
        const dir = path.dirname(logFilePath);
        if (!fs.existsSync(dir)) {
          logDebug(`Creating directory: ${dir}`, 'SharedLogStorage.saveToFile');
          fs.mkdirSync(dir, { recursive: true });
        }
        const jsonContent = JSON.stringify(logs, null, 2);
        logDebug(`Writing ${jsonContent.length} bytes to file`, 'SharedLogStorage.saveToFile');
        fs.writeFileSync(logFilePath, jsonContent, 'utf8');
        logDebug(`Successfully saved ${logs.length} logs to ${logFilePath}`, 'SharedLogStorage.saveToFile');
      });
    } catch (error) {
      handleError(error, 'SharedLogStorage.saveToFile', { 
        filePath: logFilePath,
        logsCount: logs.length 
      });
      throw error; // Пробрасываем ошибку дальше
    }
  }
  
  /**
   * Получает путь к файлу логов
   */
  private getLogFilePath(): string {
    // Используем .rootrace директорию для всех файлов
    const filePath = getRootraceFilePath('ai_debug_logs.json');
    logDebug(`Using .rootrace log file path: ${filePath}`, 'SharedLogStorage.getLogFilePath');
    return filePath;
  }
  
  /**
   * Принудительно перезагружает логи из файла
   * Используется когда нужно синхронизироваться с файлом после изменений
   */
  async reloadLogsFromFile(): Promise<void> {
    await this.loadFromFile();
  }

  /**
   * Получает единственный экземпляр SharedLogStorage (Singleton pattern)
   * 
   * @returns Экземпляр SharedLogStorage
   */
  static getInstance(): SharedLogStorage {
    if (!SharedLogStorage.instance) {
      SharedLogStorage.instance = new SharedLogStorage();
    }
    return SharedLogStorage.instance;
  }

  /**
   * Добавляет лог в хранилище
   * 
   * Автоматически обновляет индексы для быстрого поиска и ограничивает размер
   * хранилища согласно настройкам конфигурации. Эмитит событие 'logAdded' для
   * уведомления подписчиков (например, WebSocket клиентов).
   * 
   * В режиме Extension (Writer) - сразу сбрасывает данные на диск.
   * 
   * @param log - Объект RuntimeLog с данными лога
   * 
   * @example
   * ```typescript
   * await storage.addLog({
   *   timestamp: new Date().toISOString(),
   *   hypothesisId: 'H1',
   *   context: 'Function execution',
   *   data: { result: 42 }
   * });
   * ```
   */
  async addLog(log: RuntimeLog): Promise<void> {
    logDebug(`addLog called: hypothesisId=${log.hypothesisId}, context=${log.context}`, 'SharedLogStorage.addLog');
    try {
      // Синхронизируемся перед добавлением (на случай параллельных записей)
      await this.loadFromFile();
      logDebug(`After loadFromFile: ${this.logs.length} logs in memory`, 'SharedLogStorage.addLog');
      
      const index = this.logs.length;
      this.logs.push(log);
      logDebug(`Added log at index ${index}, total logs: ${this.logs.length}`, 'SharedLogStorage.addLog');
      
      // Обновляем индексы
      if (!this.hypothesisIndex.has(log.hypothesisId)) {
        this.hypothesisIndex.set(log.hypothesisId, []);
      }
      this.hypothesisIndex.get(log.hypothesisId)!.push(index);
      
      const timestamp = new Date(log.timestamp).getTime();
      const dayKey = Math.floor(timestamp / (24 * 60 * 60 * 1000));
      if (!this.timestampIndex.has(dayKey)) {
        this.timestampIndex.set(dayKey, []);
      }
      this.timestampIndex.get(dayKey)!.push(index);
      
      // Ограничиваем размер логов последними MAX_LOGS записями
      const maxLogs = this.getMaxLogs();
      if (this.logs.length > maxLogs) {
        const removedCount = this.logs.length - maxLogs;
        this.logs = this.logs.slice(-maxLogs);
        // Пересоздаем индексы после обрезки
        this.rebuildIndexes();
      }
      
      // БЕЗОТКАЗНОСТЬ: Сразу сбрасываем на диск (режим Extension - Writer)
      await this.saveToFile(this.logs);
      
      logDebug(`Added log: ${log.hypothesisId} - ${log.context}`, 'SharedLogStorage.addLog');
      
      // Эмитим событие для WebSocket клиентов
      this.emit('logAdded', log);
    } catch (error) {
      handleError(error, 'SharedLogStorage.addLog', { 
        hypothesisId: log.hypothesisId,
        context: log.context 
      });
      throw error; // Пробрасываем ошибку дальше
    }
  }
  
  /**
   * Пересоздает индексы после обрезки логов
   */
  private rebuildIndexes(): void {
    this.hypothesisIndex.clear();
    this.timestampIndex.clear();
    
    this.logs.forEach((log, index) => {
      if (!this.hypothesisIndex.has(log.hypothesisId)) {
        this.hypothesisIndex.set(log.hypothesisId, []);
      }
      this.hypothesisIndex.get(log.hypothesisId)!.push(index);
      
      const timestamp = new Date(log.timestamp).getTime();
      const dayKey = Math.floor(timestamp / (24 * 60 * 60 * 1000));
      if (!this.timestampIndex.has(dayKey)) {
        this.timestampIndex.set(dayKey, []);
      }
      this.timestampIndex.get(dayKey)!.push(index);
    });
  }

  /**
   * Получает все логи
   * В MCP контексте делает loadFromFile непосредственно перед отдачей боту
   */
  async getLogs(): Promise<RuntimeLog[]>;
  getLogs(): RuntimeLog[];
  getLogs(): RuntimeLog[] | Promise<RuntimeLog[]> {
    // В MCP контексте делаем loadFromFile непосредственно перед отдачей
    if (vscode === undefined) {
      // Возвращаем Promise для асинхронной загрузки
      return this.loadFromFile().then(() => [...this.logs]);
    }
    // В Extension контексте возвращаем синхронно (данные уже в памяти)
    return [...this.logs];
  }

  /**
   * Получает логи по ID гипотезы (использует индекс для быстрого поиска)
   * В MCP контексте автоматически загружает логи из файла перед поиском
   */
  async getLogsByHypothesis(hypothesisId: string): Promise<RuntimeLog[]>;
  getLogsByHypothesis(hypothesisId: string): RuntimeLog[];
  getLogsByHypothesis(hypothesisId: string): RuntimeLog[] | Promise<RuntimeLog[]> {
    // В MCP контексте загружаем логи из файла перед поиском
    if (vscode === undefined) {
      return this.loadFromFile().then(() => {
        const indices = this.hypothesisIndex.get(hypothesisId);
        if (!indices || indices.length === 0) {
          return [];
        }
        return indices.map(index => this.logs[index]).filter(log => log !== undefined);
      });
    }
    
    const indices = this.hypothesisIndex.get(hypothesisId);
    if (!indices || indices.length === 0) {
      return [];
    }
    return indices.map(index => this.logs[index]).filter(log => log !== undefined);
  }
  
  /**
   * Получает логи за определенный период (использует индекс)
   * 
   * Эффективно находит логи в указанном временном диапазоне, используя
   * индекс по датам для оптимизации производительности.
   * 
   * @param startDate - Начальная дата диапазона
   * @param endDate - Конечная дата диапазона
   * @returns Массив логов, отсортированных по времени (от старых к новым)
   * 
   * @example
   * ```typescript
   * const today = new Date();
   * const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
   * const recentLogs = storage.getLogsByDateRange(yesterday, today);
   * ```
   */
  getLogsByDateRange(startDate: Date, endDate: Date): RuntimeLog[] {
    const startDay = Math.floor(startDate.getTime() / (24 * 60 * 60 * 1000));
    const endDay = Math.floor(endDate.getTime() / (24 * 60 * 60 * 1000));
    const indices = new Set<number>();
    
    for (let day = startDay; day <= endDay; day++) {
      const dayIndices = this.timestampIndex.get(day);
      if (dayIndices) {
        dayIndices.forEach(idx => indices.add(idx));
      }
    }
    
    return Array.from(indices)
      .map(index => this.logs[index])
      .filter(log => {
        const logDate = new Date(log.timestamp);
        return logDate >= startDate && logDate <= endDate;
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  /**
   * Очищает все логи
   * Обнуляет JSON-файл логов через блокировку
   */
  async clear(): Promise<void> {
    this.logs = [];
    // Очищаем индексы
    this.hypothesisIndex.clear();
    this.timestampIndex.clear();
    // Сохраняем определения гипотез, но сбрасываем их состояние
    this.hypotheses.forEach((hypothesis, key) => {
      this.hypotheses.set(key, { ...hypothesis, status: 'pending' });
    });
    // БЕЗОТКАЗНОСТЬ: Обнуляем файл через блокировку
    await this.saveToFile([]);
  }

  /**
   * Получает все гипотезы
   */
  getHypotheses(): Hypothesis[] {
    return Array.from(this.hypotheses.values());
  }

  /**
   * Получает гипотезу по ID
   */
  getHypothesis(id: string): Hypothesis | undefined {
    return this.hypotheses.get(id);
  }

  /**
   * Получает количество логов
   */
  getLogCount(): number {
    return this.logs.length;
  }
}
