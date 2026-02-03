// Shared log storage для синхронизации между HTTP и MCP серверами

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { decryptObject, getEncryptionKey } from './encryption-utils';
import { withFileLock } from './file-lock-utils';
import { atomicWriteFile } from './atomic-write';
import { RuntimeLog, Hypothesis, LogData, VersionedLogFile } from './types';
import { handleError, logDebug } from './error-handler';
import { parseArrayOrDecrypt } from './utils';
import { WATCHER_CONFIG, STORAGE_CONFIG } from './constants';
import { getRootraceFilePath } from './rootrace-dir-utils';
import { VersionedLogStore, ReadResult } from './versioned-logs';

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

  /**
   * Генерирует уникальный versionId (timestamp + random)
   */
  private generateVersionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `${timestamp}-${random}`;
  }

  /**
   * Объединяет два массива логов, удаляя дубликаты по timestamp и hypothesisId
   */
  private mergeLogs(existingLogs: RuntimeLog[], newLogs: RuntimeLog[]): RuntimeLog[] {
    const mergedMap = new Map<string, RuntimeLog>();
    
    // Добавляем существующие логи
    existingLogs.forEach(log => {
      const key = `${log.timestamp}-${log.hypothesisId}`;
      mergedMap.set(key, log);
    });
    
    // Добавляем новые логи (перезаписывают старые с тем же ключом)
    newLogs.forEach(log => {
      const key = `${log.timestamp}-${log.hypothesisId}`;
      mergedMap.set(key, log);
    });
    
    // Сортируем по timestamp
    return Array.from(mergedMap.values()).sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  /**
   * Получает метрики MVCC для мониторинга
   */
  getMvccMetrics(): { conflictCount: number; successfulMergeCount: number; currentVersionId: string | null } {
    return {
      conflictCount: this.conflictCount,
      successfulMergeCount: this.successfulMergeCount,
      currentVersionId: this.currentVersionId
    };
  }

  // Индексы для быстрого поиска
  private hypothesisIndex: Map<string, number[]> = new Map();
  private timestampIndex: Map<number, number[]> = new Map();
  
  // Кэш размера логов для оптимизации производительности
  private logsSizeCache: number | null = null;
  
  // Кэш размеров отдельных логов для оптимизации обрезки
  private logSizeCache: Map<number, number> = new Map();  // индекс лога -> размер в байтах
  
  // Флаг для отслеживания watcher'а файла
  private isWatcherActive: boolean = false;
  // FSWatcher хэндл (для корректной очистки)
  private watcherHandle: fs.FSWatcher | null = null;
  // Debounce таймер для watcher'а
  private watcherDebounceTimer: NodeJS.Timeout | null = null;

  // MVCC поля для версионирования
  private currentVersionId: string | null = null;
  private conflictCount: number = 0;
  private successfulMergeCount: number = 0;

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
   * Использует fs.watch() с корректной очисткой вместо fs.watchFile()
   */
  private startWatcher(): void {
    // КРИТИЧНО: Очищаем старый watcher перед созданием нового
    this.stopWatcher();
    
    const logFilePath = this.getLogFilePath();
    
    try {
      // БЕЗОТКАЗНОСТЬ: Используем fs.watch вместо fs.watchFile для правильной очистки ресурсов
      this.watcherHandle = fs.watch(logFilePath, { persistent: false }, (eventType, filename) => {
        if (eventType !== 'change') return;
        
        // Очищаем предыдущий таймер debounce
        if (this.watcherDebounceTimer) {
          clearTimeout(this.watcherDebounceTimer);
        }
        
        // Устанавливаем новый таймер с debounce для оптимизации производительности
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
      });
      
      this.isWatcherActive = true;
    } catch (error) {
      // Если fs.watch не сработал, логируем но не падаем
      handleError(error, 'SharedLogStorage.startWatcher', { filePath: logFilePath });
      this.isWatcherActive = false;
    }
  }

  /**
   * Останавливает watcher файла (для тестов и cleanup)
   * КРИТИЧНО: Очищает ВСЕ ресурсы явно для предотвращения утечек памяти
   */
  stopWatcher(): void {
    if (!this.isWatcherActive && !this.watcherHandle) return;
    
    // Очищаем debounce таймер
    if (this.watcherDebounceTimer) {
      clearTimeout(this.watcherDebounceTimer);
      this.watcherDebounceTimer = null;
    }
    
    // Закрываем fs.watch хэндл
    if (this.watcherHandle) {
      try {
        this.watcherHandle.close();
      } catch (e) {
        // ignore - иногда уже закрыт
      }
      this.watcherHandle = null;
    }
    
    this.isWatcherActive = false;
  }
  
  /**
   * Загружает логи из файла с использованием VersionedLogStore
   */
  private async loadFromFile(): Promise<void> {
    const logFilePath = this.getLogFilePath();
    
    try {
      const result = await VersionedLogStore.readLatestVersion(logFilePath, {
        validateHash: true,
        strictValidation: false,
        useLock: true,
        useStreaming: true
      });
      
      // Загружаем логи в память с валидацией типов
      this.logs = [];
      for (const logEntry of result.logs) {
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
      
      // Сохраняем versionId для оптимистичной блокировки
      this.currentVersionId = result.metadata.versionId;
      
      // Пересоздаем индексы и сбрасываем кэш размера
      this.rebuildIndexes();
      // Заполняем кэш размеров отдельных логов синхронно (для корректности расчёта)
      this.logSizeCache.clear();
      let totalSize = 0;
      this.logs.forEach((log, index) => {
        const size = JSON.stringify(log).length;
        this.logSizeCache.set(index, size);
        totalSize += size;
      });
      this.logsSizeCache = totalSize;
      
      logDebug(`Successfully loaded ${this.logs.length} logs from file, versionId: ${result.metadata.versionId}, version: ${result.metadata.version}, hash valid: ${result.isValid}`, 'SharedLogStorage.loadFromFile');
      
      if (!result.isValid && result.validationMessage) {
        logDebug(`Validation warning: ${result.validationMessage}`, 'SharedLogStorage.loadFromFile');
      }
    } catch (error) {
      handleError(error, 'SharedLogStorage.loadFromFile', { filePath: logFilePath });
      this.logs = [];
      this.currentVersionId = null;
      this.rebuildIndexes();
    }
  }
  
  /**
   * Сохраняет логи в файл с использованием блокировки и атомарной записи
   * (старая версия для обратной совместимости, использует VersionedLogStore)
   */
  private async saveToFile(logs: RuntimeLog[]): Promise<void> {
    const logFilePath = this.getLogFilePath();
    logDebug(`saveToFile called: saving ${logs.length} logs to ${logFilePath}`, 'SharedLogStorage.saveToFile');
    
    try {
      await VersionedLogStore.replaceLogs(logFilePath, logs, {
        incrementVersion: true,
        useLock: true,
        lockTimeout: 30000,
        lockPriority: 'normal',
        useStreaming: true
      });
      
      logDebug(`Successfully saved ${logs.length} logs to ${logFilePath} using VersionedLogStore`, 'SharedLogStorage.saveToFile');
    } catch (error) {
      handleError(error, 'SharedLogStorage.saveToFile', {
        filePath: logFilePath,
        logsCount: logs.length
      });
      throw error; // Пробрасываем ошибку дальше
    }
  }

  /**
   * Сохраняет логи в файл с использованием MVCC (оптимистичная блокировка)
   * @param logs - логи для сохранения
   * @param maxRetries - максимальное количество попыток при конфликте (по умолчанию 3)
   */
  private async saveToFileWithMvcc(logs: RuntimeLog[], maxRetries: number = 3): Promise<void> {
    const logFilePath = this.getLogFilePath();
    logDebug(`saveToFileWithMvcc called: saving ${logs.length} logs to ${logFilePath}, maxRetries=${maxRetries}`, 'SharedLogStorage.saveToFileWithMvcc');
    
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      try {
        // Используем mergeLogs из VersionedLogStore для обработки конфликтов с потоковой записью
        const result = await VersionedLogStore.mergeLogs(logFilePath, logs, 'smart', {
            useStreaming: true
        });
        
        // Обновляем локальное состояние
        this.logs = result.mergedLogs;
        
        if (result.conflictResolved) {
          this.conflictCount++;
          this.successfulMergeCount++;
          logDebug(`MVCC conflict resolved: merged logs, new version: ${result.version}, hash: ${result.hash.substring(0, 16)}...`, 'SharedLogStorage.saveToFileWithMvcc');
        } else {
          logDebug(`Successfully saved ${logs.length} logs with MVCC, version: ${result.version}, hash: ${result.hash.substring(0, 16)}...`, 'SharedLogStorage.saveToFileWithMvcc');
        }
        
        // Обновляем текущую версию
        this.currentVersionId = result.versionId;
        
        // Успешно сохранили, выходим из цикла
        return;
      } catch (error) {
        retryCount++;
        if (retryCount >= maxRetries) {
          handleError(error, 'SharedLogStorage.saveToFileWithMvcc', {
            filePath: logFilePath,
            logsCount: logs.length,
            retryCount,
            maxRetries
          });
          throw error;
        }
        
        // Ждем перед повторной попыткой (экспоненциальная backoff)
        const delay = Math.min(100 * Math.pow(2, retryCount), 1000);
        logDebug(`Retry ${retryCount}/${maxRetries} after error, waiting ${delay}ms`, 'SharedLogStorage.saveToFileWithMvcc');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Сохраняет логи в файл с ЗАМЕНОЙ всего содержимого (для операций clear)
   * В отличие от saveToFileWithMvcc, это не выполняет merge и не перезагружает логи из файла
   */
  private async saveToFileWithReplace(logs: RuntimeLog[]): Promise<void> {
    const logFilePath = this.getLogFilePath();
    
    try {
      const result = await VersionedLogStore.replaceLogs(logFilePath, logs, {
        incrementVersion: true,
        useLock: true,
        lockTimeout: 30000,
        lockPriority: 'normal',
        useStreaming: true
      });
      
      logDebug(`Successfully replaced logs in file with ${logs.length} entries, version: ${result.version}`, 'SharedLogStorage.saveToFileWithReplace');
      
      // Обновляем версию
      this.currentVersionId = result.versionId;
    } catch (error) {
      handleError(error, 'SharedLogStorage.saveToFileWithReplace', {
        filePath: logFilePath,
        logsCount: logs.length
      });
      throw error;
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
   * Синхронно вычисляет размер лога в байтах
   * Использует прямой расчет для оптимизации производительности
   */
  private calculateLogSize(log: RuntimeLog): number {
    return JSON.stringify(log).length;
  }

  /**
   * Асинхронно вычисляет общий размер всех логов в байтах
   * Использует setImmediate для предотвращения блокировки event loop
   */
  private async calculateLogsTotalSize(): Promise<number> {
    return new Promise((resolve) => {
      setImmediate(() => {
        const size = JSON.stringify(this.logs).length;
        resolve(size);
      });
    });
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
   * БЕЗОПАСНОСТЬ: Проверяет размер логов перед записью для предотвращения DoS атак.
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
      // Синхронизируемся перед добавлением только если не было инициализации
      if (this.logs.length === 0 && this.logSizeCache.size === 0) {
        await this.loadFromFile();
        logDebug(`After loadFromFile: ${this.logs.length} logs in memory`, 'SharedLogStorage.addLog');
      }
      
      // БЕЗОПАСНОСТЬ: Проверяем размер логов перед добавлением (оптимизированная версия)
      const maxLogs = this.getMaxLogs();
      const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB лимит
      
      // Вычисляем размер инкрементально для производительности
      const currentSize = this.logsSizeCache ?? 0;
      const newLogSize = this.calculateLogSize(log);
      const estimatedSize = currentSize + newLogSize;
      
      if (estimatedSize > MAX_LOG_SIZE_BYTES) {
        // Удаляем старые логи до достижения безопасного размера (оптимизированная версия)
        const targetSize = Math.floor(MAX_LOG_SIZE_BYTES * 0.8); // 80% от лимита
        
        // Вычисляем размер инкрементально вместо вызова JSON.stringify в цикле
        let removeCount = 0;
        let currentSizeAfterRemoval = currentSize;
        
        // Оптимизированный расчет: сначала вычисляем количество логов для удаления
        for (let i = 0; i < this.logs.length; i++) {
          const logSize = this.logSizeCache.get(i) ?? 0;
          // Удаляем лог, если текущий размер больше целевого
          if (currentSizeAfterRemoval > targetSize) {
            currentSizeAfterRemoval -= logSize;
            removeCount++;
          } else {
            break;
          }
        }
        
        if (removeCount > 0) {
          this.logs = this.logs.slice(removeCount);
          this.logsSizeCache = currentSizeAfterRemoval;
          // Пересоздаем кэш размеров для оставшихся логов
          this.rebuildIndexes(true); // Сохраняем кэш размеров, но пересчитываем его
          logDebug(`Logs trimmed due to size limit: removed ${removeCount} logs, ${this.logs.length} remaining`, 'SharedLogStorage.addLog');
        }
      }
      
      const index = this.logs.length;
      this.logs.push(log);
      
      // Сохраняем размер лога в кэш
      this.logSizeCache.set(index, newLogSize);
      
      // Обновляем кэш размера инкрементально (newLogSize уже вычислен выше)
      this.logsSizeCache = (this.logsSizeCache ?? 0) + newLogSize;
      
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
      if (this.logs.length > maxLogs) {
        const removedCount = this.logs.length - maxLogs;
        // Удаляем старые логи и пересчитываем размер
        this.logs = this.logs.slice(-maxLogs);
        
        // Пересоздаем кэш размеров для оставшихся логов (быстрее чем сдвиг)
        this.rebuildIndexes(false);
      }
      
      // БЕЗОТКАЗНОСТЬ: Сразу сбрасываем на диск (режим Extension - Writer) с MVCC
      await this.saveToFileWithMvcc(this.logs);
      
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
   * Сдвигает кэш размеров логов после удаления первых removeCount логов
   * Удаляет записи для индексов 0..removeCount-1 и сдвигает оставшиеся индексы вниз на removeCount
   */
  private shiftLogSizeCache(removeCount: number): void {
    if (removeCount <= 0) return;
    
    // Удаляем записи для удалённых логов
    for (let i = 0; i < removeCount; i++) {
      this.logSizeCache.delete(i);
    }
    
    // Создаём новый Map с сдвинутыми индексами
    const newCache = new Map<number, number>();
    for (let [oldIndex, size] of this.logSizeCache) {
      const newIndex = oldIndex - removeCount;
      if (newIndex >= 0) {
        newCache.set(newIndex, size);
      }
    }
    this.logSizeCache = newCache;
  }

  /**
   * Пересоздает индексы после обрезки логов
   * @param preserveLogSizeCache - если true, кэш размеров логов не очищается (используется когда логи не менялись, только индексы)
   */
  private rebuildIndexes(preserveLogSizeCache: boolean = false): void {
    this.hypothesisIndex.clear();
    this.timestampIndex.clear();
    
    if (!preserveLogSizeCache) {
      this.logSizeCache.clear();  // Очищаем кэш размеров
    }
    
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
    
    // Сбрасываем кэш размера при пересоздании индексов (будет пересчитан при следующем addLog)
    // Но если preserveLogSizeCache = true, то logsSizeCache должен остаться актуальным
    if (!preserveLogSizeCache) {
      this.logsSizeCache = null;
    }
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
   * Получает логи начиная с указанного timestamp
   * 
   * КРИТИЧНО для Phase 6: Фильтрует логи по timestamp (только после _run_request_timestamp).
   * Это предотвращает анализ устаревших данных из предыдущих запусков.
   * 
   * @param sinceTimestamp - Timestamp в миллисекундах или ISO строке
   * @returns Массив логов, отсортированных по времени (от старых к новым)
   * 
   * @example
   * ```typescript
   * // Получить логи после определенного времени
   * const since = new Date('2026-01-24T12:00:00Z').getTime();
   * const recentLogs = await storage.getLogsSince(since);
   * 
   * // Или использовать ISO строку
   * const recentLogs2 = await storage.getLogsSince('2026-01-24T12:00:00Z');
   * ```
   */
  async getLogsSince(sinceTimestamp: number | string): Promise<RuntimeLog[]>;
  getLogsSince(sinceTimestamp: number | string): RuntimeLog[];
  getLogsSince(sinceTimestamp: number | string): RuntimeLog[] | Promise<RuntimeLog[]> {
    // В MCP контексте загружаем логи из файла перед фильтрацией
    if (vscode === undefined) {
      return this.loadFromFile().then(() => {
        return this.filterLogsSince(sinceTimestamp);
      });
    }
    
    return this.filterLogsSince(sinceTimestamp);
  }

  /**
   * Внутренний метод для фильтрации логов по timestamp
   */
  private filterLogsSince(sinceTimestamp: number | string): RuntimeLog[] {
    const since = typeof sinceTimestamp === 'string' 
      ? new Date(sinceTimestamp).getTime() 
      : sinceTimestamp;
    
    // Валидация timestamp
    if (isNaN(since) || since < 0) {
      throw new Error(`Invalid timestamp: ${sinceTimestamp}. Expected a valid number (milliseconds) or ISO string.`);
    }
    
    return this.logs
      .filter(log => {
        const logTimestamp = new Date(log.timestamp).getTime();
        // Игнорируем логи с невалидными timestamp
        if (isNaN(logTimestamp)) {
          return false;
        }
        return logTimestamp >= since;
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  /**
   * Очищает все логи
   * Обнуляет JSON-файл логов через блокировку
   */
  async clear(): Promise<void> {
    const wasWatcherActive = this.isWatcherActive;
    
    // Временно останавливаем watcher
    if (wasWatcherActive) {
      this.stopWatcher();
    }
    
    // Очищаем память
    this.logs = [];
    // Очищаем индексы и кэш размера
    this.hypothesisIndex.clear();
    this.timestampIndex.clear();
    this.logSizeCache.clear();  // Очищаем кэш размеров отдельных логов
    this.logsSizeCache = 0;
    // Сохраняем определения гипотез, но сбрасываем их состояние
    this.hypotheses.forEach((hypothesis, key) => {
      this.hypotheses.set(key, { ...hypothesis, status: 'pending' });
    });
    
    // БЕЗОТКАЗНОСТЬ: Обнуляем файл через блокировку с ЗАМЕНОЙ (не merge!)
    try {
      await this.saveToFile([]);
    } catch (error) {
      handleError(error, 'SharedLogStorage.clear');
    }
    
    // Перезапускаем watcher
    if (wasWatcherActive) {
      this.startWatcher();
    }
    
    this.emit('logsCleared');
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

  /**
   * Полная очистка ресурсов при деактивации расширения
   * КРИТИЧНО: Вызывать при завершении работы расширения для предотвращения утечек памяти
   * 
   * Очищает:
   * - fs.watch хэндл (watcher файла)
   * - Все debounce таймеры
   * - EventEmitter слушатели
   * - Ссылки на логи и гипотезы
   */
  public dispose(): void {
    logDebug('SharedLogStorage.dispose() called', 'SharedLogStorage');
    
    // 1. Останавливаем watcher файла (закрывает fs.watch хэндл)
    this.stopWatcher();
    
    // 2. Удаляем ВСЕ EventEmitter слушатели для предотвращения утечек
    this.removeAllListeners();
    
    // 3. Очищаем логи (освобождаем память)
    this.logs = [];
    
    // 4. Очищаем гипотезы
    this.hypotheses.clear();
    
    // 5. Очищаем индексы
    this.hypothesisIndex.clear();
    this.timestampIndex.clear();
    
    // 6. Очищаем кэш размеров отдельных логов
    this.logSizeCache.clear();
    
    // 7. Сбрасываем кэш
    this.logsSizeCache = null;
    this.currentVersionId = null;
    
    logDebug('SharedLogStorage.dispose() completed', 'SharedLogStorage');
  }
}