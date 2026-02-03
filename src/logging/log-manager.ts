/**
 * Менеджер логирования
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { getRootraceFilePath } from '../rootrace-dir-utils';
import { encryptObject, decryptObject, getEncryptionKey } from '../encryption-utils';
import { parseArrayOrDecrypt } from '../utils';
import { SharedLogStorage } from '../shared-log-storage';
import { RuntimeLog } from '../types';
import { LogData } from '../types';
import { LogExporter } from '../log-exporter';

/**
 * Менеджер логирования
 */
export class LogManager {
    private static instance: LogManager;
    
    private constructor() {}
    
    /**
     * Получить экземпляр менеджера (Singleton)
     */
    public static getInstance(): LogManager {
        if (!LogManager.instance) {
            LogManager.instance = new LogManager();
        }
        return LogManager.instance;
    }
    
    /**
     * Записать лог в output channel
     */
    public async logToOutputChannel(
        hypothesisId: string,
        context: string,
        data: LogData,
        outputChannel?: vscode.OutputChannel
    ): Promise<void> {
        const runtimeLog: RuntimeLog = {
            timestamp: new Date().toISOString(),
            hypothesisId,
            context,
            data
        };
        
        try {
            // Получаем экземпляр shared storage
            const sharedStorage = SharedLogStorage.getInstance();
            
            // Добавляем в shared storage
            await sharedStorage.addLog(runtimeLog);
            
            // Выводим в output channel
            if (outputChannel) {
                outputChannel.appendLine(`[DEBUG] logToOutputChannel called: hypothesisId=${hypothesisId}, context=${context}`);
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (outputChannel) {
                outputChannel.appendLine(`[ERROR] Failed to log to output channel: ${errorMsg}`);
            }
            throw error;
        }
    }
    
    /**
     * Добавить лог в файл
     */
    public async appendLogToFile(
        hypothesisId: string,
        context: string,
        data: LogData
    ): Promise<void> {
        try {
            const logFilePath = getRootraceFilePath('ai_debug_logs.json');
            
            // Create log entry object
            const logEntry = {
                hypothesisId,
                context,
                data,
                timestamp: new Date().toISOString()
            };
            
            // Read existing logs if file exists
            let existingLogs: any[] = [];
            if (fs.existsSync(logFilePath)) {
                const fileContent = fs.readFileSync(logFilePath, 'utf8');
                if (fileContent.trim()) {
                    // Используем общую утилиту для парсинга массива с fallback на дешифровку
                    existingLogs = parseArrayOrDecrypt(fileContent, []);
                }
            }
            
            // Append new log entry
            existingLogs.push(logEntry);
            
            // Encrypt and write updated logs back to file
            const encryptionKey = getEncryptionKey();
            const encryptedLogs = encryptObject(existingLogs, encryptionKey);
            fs.writeFileSync(logFilePath, encryptedLogs, 'utf8');
        } catch (error) {
            console.error(`[ERROR] Failed to write log to file: ${error}`);
        }
    }
    
    /**
     * Получить логи из памяти
     */
    public async getInMemoryLogs(): Promise<string[]> {
        // Получаем экземпляр shared storage
        const sharedStorage = SharedLogStorage.getInstance();
        
        // Конвертируем RuntimeLog[] в формат строк для обратной совместимости
        const logs = await sharedStorage.getLogs();
        return logs.map((log: RuntimeLog) => {
            const now = new Date();
            const time = now.toTimeString().split(' ')[0]; // HH:MM:SS format
            
            const lines: string[] = [];
            lines.push(`[LOG][Hypothesis: ${log.hypothesisId}][Time: ${time}]`);
            lines.push(`Context: "${log.context}"`);
            lines.push(`Data: ${JSON.stringify(log.data, null, 2)}`);
            lines.push('---');
            
            return lines.join('\n');
        });
    }
    
    /**
     * Очистить логи
     */
    public async clearLogs(): Promise<void> {
        // Получаем экземпляр shared storage
        const sharedStorage = SharedLogStorage.getInstance();
        
        // Очищаем shared storage
        await sharedStorage.clear();
    }
    
    /**
     * Экспортировать логи
     */
    public async exportLogs(format: 'json' | 'csv' | 'markdown' | 'html'): Promise<string> {
        try {
            // Используем LogExporter для экспорта логов
            const content = await LogExporter.exportLogs({
                format: format,
                includeMetadata: true
            });
            return content;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[ERROR] Failed to export logs: ${errorMsg}`);
            // Возвращаем пустую строку или можно бросить ошибку снова, если это критично
            throw new Error(`Failed to export logs: ${errorMsg}`);
        }
    }
}