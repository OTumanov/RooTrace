import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SharedLogStorage, RuntimeLog } from '../shared-log-storage';
import { encryptObject, getEncryptionKey } from '../encryption-utils';
import { parseArrayOrDecrypt } from '../utils';
import { LogData } from '../types';
import { getRootraceFilePath } from '../rootrace-dir-utils';

export class LogService {
    private outputChannel: vscode.OutputChannel;
    private sharedStorage: SharedLogStorage;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.sharedStorage = SharedLogStorage.getInstance();
    }

    /**
     * Получить путь к файлу логов
     */
    private getLogFilePath(): string {
        return getRootraceFilePath('ai_debug_logs.json');
    }

    /**
     * Добавить запись лога в файл
     */
    async appendLogToFile(hypothesisId: string, context: string, data: LogData): Promise<void> {
        try {
            const logFilePath = this.getLogFilePath();
            
            // Создать объект записи лога
            const logEntry = {
                hypothesisId,
                context,
                data,
                timestamp: new Date().toISOString()
            };

            // Читаем существующие логи, если файл существует
            let existingLogs: any[] = [];
            if (fs.existsSync(logFilePath)) {
                const fileContent = fs.readFileSync(logFilePath, 'utf8');
                if (fileContent.trim()) {
                    // Используем общую утилиту для парсинга массива с fallback на дешифровку
                    existingLogs = parseArrayOrDecrypt(fileContent, []);
                }
            }

            // Добавляем новую запись
            existingLogs.push(logEntry);

            // Шифруем и записываем обновленные логи обратно в файл
            const encryptionKey = getEncryptionKey();
            const encryptedLogs = encryptObject(existingLogs, encryptionKey);
            fs.writeFileSync(logFilePath, encryptedLogs, 'utf8');
        } catch (error) {
            this.outputChannel.appendLine(`[ERROR] Failed to write log to file: ${error}`);
        }
    }

    /**
     * Форматировать запись лога для вывода
     */
    formatLogEntry(hypothesisId: string, context: string, data: LogData): string {
        const now = new Date();
        const time = now.toTimeString().split(' ')[0]; // HH:MM:SS format
        
        const lines: string[] = [];
        lines.push(`[LOG][Hypothesis: ${hypothesisId}][Time: ${time}]`);
        lines.push(`Context: "${context}"`);
        lines.push(`Data: ${JSON.stringify(data, null, 2)}`);
        lines.push('---');
        
        return lines.join('\n');
    }

    /**
     * Логировать в Output Channel и shared storage
     */
    async logToOutputChannel(hypothesisId: string, context: string, data: LogData): Promise<void> {
        // Создаем RuntimeLog ДО try блока, чтобы он был доступен везде
        const runtimeLog: RuntimeLog = {
            timestamp: new Date().toISOString(),
            hypothesisId,
            context,
            data
        };
        
        try {
            this.outputChannel.appendLine(`[DEBUG] logToOutputChannel called: hypothesisId=${hypothesisId}, context=${context}`);
            
            const logEntry = this.formatLogEntry(hypothesisId, context, data);
            
            // Добавляем в shared storage
            // SharedLogStorage автоматически эмитит событие 'logAdded' для WebSocket клиентов
            this.outputChannel.appendLine(`[DEBUG] Calling sharedStorage.addLog...`);
            await this.sharedStorage.addLog(runtimeLog);
            this.outputChannel.appendLine(`[DEBUG] sharedStorage.addLog completed successfully`);
            
            // Проверяем, что лог действительно записался
            const logsAfter = await this.sharedStorage.getLogs();
            this.outputChannel.appendLine(`[DEBUG] Total logs in storage after add: ${logsAfter.length}`);
            
            // Output to channel
            this.outputChannel.appendLine(logEntry);
            this.outputChannel.show(true);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`[ERROR] Failed to log to output channel: ${errorMsg}`);
            this.outputChannel.appendLine(`[ERROR] Stack: ${error instanceof Error ? error.stack : 'N/A'}`);
            throw error;
        }
    }

    /**
     * Получить логи из памяти в виде строк
     */
    async getInMemoryLogs(): Promise<string[]> {
        // Конвертируем RuntimeLog[] в формат строк для обратной совместимости
        const logs = await this.sharedStorage.getLogs();
        return logs.map(log => this.formatLogEntry(log.hypothesisId, log.context, log.data));
    }

    /**
     * Очистить логи (очистка shared storage и output channel)
     */
    async clearLogs(): Promise<void> {
        // Очищаем shared storage
        await this.sharedStorage.clear();
        
        this.outputChannel.clear();
        this.outputChannel.appendLine('[SYSTEM] Logs cleared.');
        this.outputChannel.show(true);
        
        // Очищаем постоянный файл логов
        try {
            const logFilePath = this.getLogFilePath();
            if (fs.existsSync(logFilePath)) {
                // Пишем пустой массив через SharedLogStorage (единый формат/локи)
                // Файл уже очищен вызовом sharedStorage.clear(); оставляем этот блок как no-op на случай кастомных сценариев.
            }
        } catch (error) {
            this.outputChannel.appendLine(`[SYSTEM] Error clearing persistent log file: ${error}`);
        }
    }
}