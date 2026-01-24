/**
 * Утилиты для логирования MCP запросов, ответов и ошибок
 * 
 * Этот модуль предоставляет единообразное логирование для всех MCP операций.
 */

import { logDebug, handleError } from '../../error-handler';

/**
 * Логирует входящий MCP запрос
 * 
 * @param method - Название метода (например, 'initialize', 'call_tool:read_runtime_logs')
 * @param params - Параметры запроса
 */
export function logMCPRequest(method: string, params: any): void {
  logDebug(`Request: ${method}`, 'RooTraceMCPHandler', { method, params });
}

/**
 * Логирует успешный MCP ответ
 * 
 * @param method - Название метода
 * @param response - Ответ сервера
 * @param duration - Время выполнения в миллисекундах
 */
export function logMCPResponse(method: string, response: any, duration: number): void {
  logDebug(`Response: ${method} (${duration}ms)`, 'RooTraceMCPHandler', { method, duration });
}

/**
 * Логирует ошибку при обработке MCP запроса
 * 
 * @param method - Название метода
 * @param error - Ошибка
 * @param duration - Время выполнения до ошибки в миллисекундах
 */
export function logMCPError(method: string, error: any, duration: number): void {
  handleError(error, 'RooTraceMCPHandler', { 
    method, 
    duration,
    action: 'mcpRequest'
  });
}
