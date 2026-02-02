/**
 * Версионирование логов (MVCC) для синхронизации HTTP/MCP серверов
 * 
 * Реализует механизм Multi-Version Concurrency Control для предотвращения
 * потери данных при конкурентной записи в один файл.
 * 
 * Основные возможности:
 * - Атомарная запись с инкрементом версии
 * - SHA-256 хеш для проверки целостности данных
 * - Валидация хеша при чтении
 * - Оптимистичная блокировка через версионирование
 * - Совместимость с существующим API SharedLogStorage
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { withFileLock } from './file-lock-utils';
import { atomicWriteJson, readFileIfExists } from './atomic-write';
import { parseJSONStream, writeJSONStream } from './streaming-json';
import { RuntimeLog, VersionedLogFile } from './types';
import { handleError, logDebug } from './error-handler';

/**
 * Расширенный интерфейс версионированных логов с хешем для проверки целостности
 */
export interface VersionedLogs extends VersionedLogFile {
    /**
     * SHA-256 хеш содержимого логов для проверки целостности
     * Формат: hex строка
     */
    hash: string;
    
    /**
     * Номер версии (инкрементируется при каждой записи)
     */
    version: number;
    
    /**
     * Предыдущий хеш (для построения цепочки)
     */
    previousHash?: string;
}

/**
 * Опции для чтения версионированных логов
 */
export interface ReadOptions {
    /**
     * Проверять целостность хеша (по умолчанию true)
     */
    validateHash?: boolean;
    
    /**
     * Выбрасывать ошибку при несовпадении хеша (по умолчанию false)
     */
    strictValidation?: boolean;
    
    /**
     * Использовать блокировку файла при чтении (по умолчанию false)
     */
    useLock?: boolean;
    
    /**
     * Использовать потоковое чтение JSON (по умолчанию false для обратной совместимости)
     */
    useStreaming?: boolean;
}

/**
 * Опции для записи версионированных логов
 */
export interface WriteOptions {
    /**
     * Принудительно увеличить версию (по умолчанию true)
     */
    incrementVersion?: boolean;
    
    /**
     * Использовать блокировку файла (по умолчанию true)
     */
    useLock?: boolean;
    
    /**
     * Таймаут блокировки в миллисекундах (по умолчанию 30000)
     */
    lockTimeout?: number;
    
    /**
     * Приоритет операции блокировки (по умолчанию 'normal')
     */
    lockPriority?: 'high' | 'normal' | 'low';
    
    /**
     * Использовать потоковую запись JSON (по умолчанию false для обратной совместимости)
     */
    useStreaming?: boolean;
}

/**
 * Результат чтения логов
 */
export interface ReadResult {
    /**
     * Прочитанные логи
     */
    logs: RuntimeLog[];
    
    /**
     * Метаданные версии
     */
    metadata: {
        version: number;
        versionId: string;
        hash: string;
        timestamp: string;
    };
    
    /**
     * Флаг, указывающий что данные были успешно валидированы
     */
    isValid: boolean;
    
    /**
     * Сообщение валидации (если есть)
     */
    validationMessage?: string;
}

/**
 * Класс для управления версионированными логами с поддержкой MVCC
 */
export class VersionedLogStore {
    /**
     * Читает последнюю версию логов из файла с валидацией хеша
     * 
     * @param filePath Путь к файлу логов
     * @param options Опции чтения
     * @returns Результат чтения с метаданными
     */
    static async readLatestVersion(
        filePath: string,
        options: ReadOptions = {}
    ): Promise<ReadResult> {
        const {
            validateHash = true,
            strictValidation = false,
            useLock = false,
            useStreaming = false
        } = options;
        
        const readOperation = async (): Promise<ReadResult> => {
            try {
                let parsed: any;
                
                if (useStreaming) {
                    // Используем потоковое чтение JSON
                    try {
                        parsed = await parseJSONStream(filePath, {
                            maxFileSize: 100 * 1024 * 1024, // 100MB
                            encoding: 'utf-8',
                            validateJson: true
                        });
                    } catch (streamError) {
                        logDebug(`Failed to parse JSON via streaming from ${filePath}: ${streamError}`, 'VersionedLogStore.readLatestVersion');
                        
                        if (strictValidation) {
                            throw new Error(`Invalid JSON format in log file (streaming): ${streamError instanceof Error ? streamError.message : String(streamError)}`);
                        }
                        
                        // Возвращаем пустые логи при невалидном JSON
                        return {
                            logs: [],
                            metadata: {
                                version: 0,
                                versionId: this.generateVersionId(),
                                hash: this.calculateHash([]),
                                timestamp: new Date().toISOString()
                            },
                            isValid: false,
                            validationMessage: `Streaming parse failed: ${streamError instanceof Error ? streamError.message : String(streamError)}`
                        };
                    }
                } else {
                    // Используем традиционное чтение файла
                    const content = await readFileIfExists(filePath, 'utf-8');
                    
                    if (!content) {
                        // Файл не существует или пуст
                        return {
                            logs: [],
                            metadata: {
                                version: 0,
                                versionId: this.generateVersionId(),
                                hash: this.calculateHash([]),
                                timestamp: new Date().toISOString()
                            },
                            isValid: true,
                            validationMessage: 'File does not exist, returning empty logs'
                        };
                    }
                    
                    // Парсим JSON
                    try {
                        parsed = JSON.parse(content);
                    } catch (parseError) {
                        logDebug(`Failed to parse JSON from ${filePath}: ${parseError}`, 'VersionedLogStore.readLatestVersion');
                        
                        if (strictValidation) {
                            throw new Error(`Invalid JSON format in log file: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
                        }
                        
                        // Возвращаем пустые логи при невалидном JSON
                        return {
                            logs: [],
                            metadata: {
                                version: 0,
                                versionId: this.generateVersionId(),
                                hash: this.calculateHash([]),
                                timestamp: new Date().toISOString()
                            },
                            isValid: false,
                            validationMessage: 'Invalid JSON format'
                        };
                    }
                }
                
                // Проверяем формат данных
                if (this.isVersionedLogs(parsed)) {
                    // Это версионированный формат с хешем
                    const versionedLogs = parsed as VersionedLogs;
                    const logs = versionedLogs.logs || [];
                    
                    // Валидируем хеш если требуется
                    let isValid = true;
                    let validationMessage: string | undefined;
                    
                    if (validateHash) {
                        const expectedHash = this.calculateHash(logs);
                        if (versionedLogs.hash !== expectedHash) {
                            isValid = false;
                            validationMessage = `Hash mismatch: expected ${expectedHash}, got ${versionedLogs.hash}`;
                            
                            logDebug(`Hash validation failed for ${filePath}: ${validationMessage}`, 'VersionedLogStore.readLatestVersion');
                            
                            if (strictValidation) {
                                throw new Error(`Data integrity check failed: ${validationMessage}`);
                            }
                        }
                    }
                    
                    return {
                        logs,
                        metadata: {
                            version: versionedLogs.version,
                            versionId: versionedLogs.versionId,
                            hash: versionedLogs.hash,
                            timestamp: versionedLogs.timestamp
                        },
                        isValid,
                        validationMessage
                    };
                } else if (this.isLegacyFormat(parsed)) {
                    // Старый формат (просто массив логов)
                    const logs = parsed as RuntimeLog[];
                    const versionId = this.generateVersionId();
                    const hash = this.calculateHash(logs);
                    
                    logDebug(`Loaded legacy format from ${filePath}, converting to versioned format`, 'VersionedLogStore.readLatestVersion');
                    
                    return {
                        logs,
                        metadata: {
                            version: 1,
                            versionId,
                            hash,
                            timestamp: new Date().toISOString()
                        },
                        isValid: true,
                        validationMessage: 'Legacy format converted to versioned'
                    };
                } else {
                    // Неизвестный формат
                    logDebug(`Unknown format in ${filePath}, returning empty logs`, 'VersionedLogStore.readLatestVersion');
                    
                    if (strictValidation) {
                        throw new Error(`Unknown log file format in ${filePath}`);
                    }
                    
                    return {
                        logs: [],
                        metadata: {
                            version: 0,
                            versionId: this.generateVersionId(),
                            hash: this.calculateHash([]),
                            timestamp: new Date().toISOString()
                        },
                        isValid: false,
                        validationMessage: 'Unknown file format'
                    };
                }
            } catch (error) {
                handleError(error, 'VersionedLogStore.readLatestVersion', { filePath });
                throw error;
            }
        };
        
        if (useLock) {
            return withFileLock(filePath, readOperation, {
                timeout: 30000,
                priority: 'normal'
            });
        }
        
        return readOperation();
    }
    
    /**
     * Добавляет лог в файл с атомарной записью и инкрементом версии
     * 
     * @param filePath Путь к файлу логов
     * @param log Лог для добавления
     * @param options Опции записи
     * @returns Метаданные новой версии
     */
    static async appendLog(
        filePath: string,
        log: RuntimeLog,
        options: WriteOptions = {}
    ): Promise<{ version: number; versionId: string; hash: string }> {
        const {
            incrementVersion = true,
            useLock = true,
            lockTimeout = 30000,
            lockPriority = 'normal'
        } = options;
        
        const writeOperation = async (): Promise<{ version: number; versionId: string; hash: string }> => {
            try {
                // Читаем текущее состояние
                const currentResult = await this.readLatestVersion(filePath, {
                    validateHash: true,
                    strictValidation: false,
                    useLock: false // Уже внутри блокировки
                });
                
                // Добавляем новый лог
                const newLogs = [...currentResult.logs, log];
                
                // Генерируем новую версию
                const newVersion = incrementVersion ? currentResult.metadata.version + 1 : currentResult.metadata.version;
                const newVersionId = this.generateVersionId();
                const newHash = this.calculateHash(newLogs);
                
                // Создаем версионированный объект
                const versionedLogs: VersionedLogs = {
                    versionId: newVersionId,
                    timestamp: new Date().toISOString(),
                    logs: newLogs,
                    hash: newHash,
                    version: newVersion,
                    previousHash: currentResult.metadata.hash
                };
                
                // Атомарно записываем в файл
                await atomicWriteJson(filePath, versionedLogs, {
                    encoding: 'utf-8',
                    cleanupOldTempFiles: 3600000,
                    mode: 0o644
                });
                
                logDebug(`Appended log to ${filePath}, new version: ${newVersion}, hash: ${newHash.substring(0, 16)}...`, 'VersionedLogStore.appendLog');
                
                return {
                    version: newVersion,
                    versionId: newVersionId,
                    hash: newHash
                };
            } catch (error) {
                handleError(error, 'VersionedLogStore.appendLog', { filePath, hypothesisId: log.hypothesisId });
                throw error;
            }
        };
        
        if (useLock) {
            return withFileLock(filePath, writeOperation, {
                timeout: lockTimeout,
                priority: lockPriority
            });
        }
        
        return writeOperation();
    }
    
    /**
     * Заменяет все логи в файле новой версией
     * 
     * @param filePath Путь к файлу логов
     * @param logs Новые логи
     * @param options Опции записи
     * @returns Метаданные новой версии
     */
    static async replaceLogs(
        filePath: string,
        logs: RuntimeLog[],
        options: WriteOptions = {}
    ): Promise<{ version: number; versionId: string; hash: string }> {
        const {
            incrementVersion = true,
            useLock = true,
            lockTimeout = 30000,
            lockPriority = 'normal',
            useStreaming = false
        } = options;
        
        const writeOperation = async (): Promise<{ version: number; versionId: string; hash: string }> => {
            try {
                // Читаем текущую версию для инкремента
                const currentResult = await this.readLatestVersion(filePath, {
                    validateHash: false,
                    strictValidation: false,
                    useLock: false
                }).catch(() => ({
                    metadata: { version: 0, versionId: this.generateVersionId(), hash: '', timestamp: '' },
                    logs: [],
                    isValid: false
                }));
                
                // Генерируем новую версию
                const newVersion = incrementVersion ? currentResult.metadata.version + 1 : currentResult.metadata.version;
                const newVersionId = this.generateVersionId();
                const newHash = this.calculateHash(logs);
                
                // Создаем версионированный объект
                const versionedLogs: VersionedLogs = {
                    versionId: newVersionId,
                    timestamp: new Date().toISOString(),
                    logs,
                    hash: newHash,
                    version: newVersion,
                    previousHash: currentResult.metadata.hash
                };
                
                // Записываем в файл с использованием потоков или атомарной записи
                if (useStreaming) {
                    await writeJSONStream(filePath, versionedLogs, {
                        pretty: true,
                        encoding: 'utf-8',
                        mode: 0o644
                    });
                } else {
                    // Атомарно записываем в файл
                    await atomicWriteJson(filePath, versionedLogs, {
                        encoding: 'utf-8',
                        cleanupOldTempFiles: 3600000,
                        mode: 0o644
                    });
                }
                
                logDebug(`Replaced logs in ${filePath}, new version: ${newVersion}, logs: ${logs.length}, hash: ${newHash.substring(0, 16)}..., streaming: ${useStreaming}`, 'VersionedLogStore.replaceLogs');
                
                return {
                    version: newVersion,
                    versionId: newVersionId,
                    hash: newHash
                };
            } catch (error) {
                handleError(error, 'VersionedLogStore.replaceLogs', { filePath, logsCount: logs.length });
                throw error;
            }
        };
        
        if (useLock) {
            return withFileLock(filePath, writeOperation, {
                timeout: lockTimeout,
                priority: lockPriority
            });
        }
        
        return writeOperation();
    }
    
    /**
     * Объединяет существующие логи с новыми (MVCC merge)
     * 
     * @param filePath Путь к файлу логов
     * @param newLogs Новые логи для объединения
     * @param mergeStrategy Стратегия объединения (по умолчанию 'append')
     * @returns Результат объединения
     */
    static async mergeLogs(
        filePath: string,
        newLogs: RuntimeLog[],
        mergeStrategy: 'append' | 'replace' | 'smart' = 'smart',
        options: WriteOptions = {}
    ): Promise<{
        mergedLogs: RuntimeLog[];
        version: number;
        versionId: string;
        hash: string;
        conflictResolved: boolean;
    }> {
        const {
            useStreaming = false
        } = options;
        return withFileLock(filePath, async () => {
            try {
                // Читаем текущие логи с использованием потокового чтения если нужно
                const currentResult = await this.readLatestVersion(filePath, {
                    validateHash: true,
                    strictValidation: false,
                    useLock: false,
                    useStreaming
                });
                
                let mergedLogs: RuntimeLog[];
                let conflictResolved = false;
                
                switch (mergeStrategy) {
                    case 'append':
                        // Просто добавляем новые логи в конец
                        mergedLogs = [...currentResult.logs, ...newLogs];
                        break;
                        
                    case 'replace':
                        // Заменяем все логи новыми
                        mergedLogs = newLogs;
                        conflictResolved = true;
                        break;
                        
                    case 'smart':
                    default:
                        // Умное объединение: удаляем дубликаты по timestamp и hypothesisId
                        const logMap = new Map<string, RuntimeLog>();
                        
                        // Добавляем существующие логи
                        currentResult.logs.forEach(log => {
                            const key = `${log.timestamp}-${log.hypothesisId}`;
                            logMap.set(key, log);
                        });
                        
                        // Добавляем новые логи (перезаписывают старые с тем же ключом)
                        newLogs.forEach(log => {
                            const key = `${log.timestamp}-${log.hypothesisId}`;
                            logMap.set(key, log);
                        });
                        
                        mergedLogs = Array.from(logMap.values()).sort((a, b) =>
                            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
                        );
                        
                        conflictResolved = logMap.size < (currentResult.logs.length + newLogs.length);
                        break;
                }
                
                // Генерируем новую версию
                const newVersion = currentResult.metadata.version + 1;
                const newVersionId = this.generateVersionId();
                const newHash = this.calculateHash(mergedLogs);
                
                // Создаем версионированный объект
                const versionedLogs: VersionedLogs = {
                    versionId: newVersionId,
                    timestamp: new Date().toISOString(),
                    logs: mergedLogs,
                    hash: newHash,
                    version: newVersion,
                    previousHash: currentResult.metadata.hash
                };
                
                // Записываем в файл с использованием потоков или атомарной записи
                if (useStreaming) {
                    await writeJSONStream(filePath, versionedLogs, {
                        pretty: true,
                        encoding: 'utf-8',
                        mode: 0o644
                    });
                } else {
                    // Атомарно записываем в файл
                    await atomicWriteJson(filePath, versionedLogs, {
                        encoding: 'utf-8',
                        cleanupOldTempFiles: 3600000,
                        mode: 0o644
                    });
                }
                
                logDebug(`Merged logs in ${filePath}, strategy: ${mergeStrategy}, merged: ${mergedLogs.length} logs, conflict resolved: ${conflictResolved}, streaming: ${useStreaming}`, 'VersionedLogStore.mergeLogs');
                
                return {
                    mergedLogs,
                    version: newVersion,
                    versionId: newVersionId,
                    hash: newHash,
                    conflictResolved
                };
            } catch (error) {
                handleError(error, 'VersionedLogStore.mergeLogs', { filePath, newLogsCount: newLogs.length });
                throw error;
            }
        }, {
            timeout: 30000,
            priority: 'normal'
        });
    }
    
    /**
     * Проверяет целостность файла логов
     * 
     * @param filePath Путь к файлу логов
     * @returns Результат проверки целостности
     */
    static async verifyIntegrity(filePath: string): Promise<{
        isValid: boolean;
        version: number;
        hashMatches: boolean;
        jsonValid: boolean;
        error?: string;
    }> {
        try {
            const content = await readFileIfExists(filePath, 'utf-8');
            
            if (!content) {
                return {
                    isValid: true, // Пустой файл считается валидным
                    version: 0,
                    hashMatches: true,
                    jsonValid: true
                };
            }
            
            // Проверяем JSON
            let parsed: any;
            try {
                parsed = JSON.parse(content);
            } catch (error) {
                return {
                    isValid: false,
                    version: 0,
                    hashMatches: false,
                    jsonValid: false,
                    error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`
                };
            }
            
            // Проверяем формат
            if (!this.isVersionedLogs(parsed)) {
                return {
                    isValid: false,
                    version: 0,
                    hashMatches: false,
                    jsonValid: true,
                    error: 'Not a versioned logs format'
                };
            }
            
            const versionedLogs = parsed as VersionedLogs;
            const expectedHash = this.calculateHash(versionedLogs.logs || []);
            const hashMatches = versionedLogs.hash === expectedHash;
            
            return {
                isValid: hashMatches,
                version: versionedLogs.version,
                hashMatches,
                jsonValid: true,
                error: hashMatches ? undefined : `Hash mismatch: expected ${expectedHash}, got ${versionedLogs.hash}`
            };
        } catch (error) {
            return {
                isValid: false,
                version: 0,
                hashMatches: false,
                jsonValid: false,
                error: `Verification failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    
    /**
     * Генерирует уникальный ID версии
     */
    private static generateVersionId(): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 10);
        return `${timestamp}-${random}`;
    }
    
    /**
     * Вычисляет SHA-256 хеш для массива логов
     */
    private static calculateHash(logs: RuntimeLog[]): string {
        const jsonString = JSON.stringify(logs);
        return crypto
            .createHash('sha256')
            .update(jsonString)
            .digest('hex');
    }
    
    /**
     * Проверяет, является ли объект версионированными логами
     */
    private static isVersionedLogs(obj: any): obj is VersionedLogs {
        return (
            obj &&
            typeof obj === 'object' &&
            'versionId' in obj &&
            'timestamp' in obj &&
            'logs' in obj &&
            'hash' in obj &&
            'version' in obj &&
            Array.isArray(obj.logs)
        );
    }
    
    /**
     * Проверяет, является ли объект legacy форматом (просто массив логов)
     */
    private static isLegacyFormat(obj: any): obj is RuntimeLog[] {
        return Array.isArray(obj) && (
            obj.length === 0 ||
            obj.every(item => 
                item &&
                typeof item === 'object' &&
                'timestamp' in item &&
                'hypothesisId' in item &&
                'context' in item
            )
        );
    }
}