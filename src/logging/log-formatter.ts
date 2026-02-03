/**
 * Форматирование логов
 */

import { LogData } from '../types';

/**
 * Форматировать запись лога
 */
export function formatLogEntry(hypothesisId: string, context: string, data: LogData): string {
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
 * Создать RuntimeLog объект
 */
export function createRuntimeLog(hypothesisId: string, context: string, data: LogData) {
    return {
        timestamp: new Date().toISOString(),
        hypothesisId,
        context,
        data
    };
}

/**
 * Преобразовать логи в строковый формат
 */
export function logsToString(logs: any[]): string {
    return logs.map(log => {
        if (typeof log === 'string') {
            return log;
        } else if (log && typeof log === 'object') {
            return formatLogEntry(
                log.hypothesisId || 'UNKNOWN',
                log.context || '',
                log.data || {}
            );
        }
        return String(log);
    }).join('\n\n');
}

/**
 * Преобразовать логи в JSON формат
 */
export function logsToJson(logs: any[]): string {
    return JSON.stringify(logs, null, 2);
}

/**
 * Преобразовать логи в CSV формат
 */
export function logsToCsv(logs: any[]): string {
    const headers = ['timestamp', 'hypothesisId', 'context', 'data'];
    const rows = logs.map(log => {
        return [
            log.timestamp || '',
            log.hypothesisId || '',
            log.context || '',
            JSON.stringify(log.data || {})
        ].map(cell => `"${cell.replace(/"/g, '""')}"`).join(',');
    });
    
    return [headers.join(','), ...rows].join('\n');
}