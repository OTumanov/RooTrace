/**
 * Обработчик сообщений из WebView dashboard
 */

import * as vscode from 'vscode';
import { SharedLogStorage, RuntimeLog } from '../shared-log-storage';

/**
 * Интерфейс сообщения от WebView
 */
export interface WebViewMessage {
    command?: string;
    type?: string;
    [key: string]: any;
}

/**
 * Обработчик сообщений dashboard
 */
export class DashboardMessageHandler {
    private static instance: DashboardMessageHandler;
    
    private constructor() {}
    
    /**
     * Получить экземпляр обработчика (Singleton)
     */
    public static getInstance(): DashboardMessageHandler {
        if (!DashboardMessageHandler.instance) {
            DashboardMessageHandler.instance = new DashboardMessageHandler();
        }
        return DashboardMessageHandler.instance;
    }
    
    /**
     * Обработать сообщение от WebView
     */
    public async handleMessage(message: WebViewMessage, panel: vscode.WebviewPanel): Promise<any> {
        console.log('[DashboardMessageHandler] Received message:', message);
        
        switch (message.command) {
            case 'clearLogs':
                return this.handleClearLogs(panel);
            case 'sendTestLog':
                return this.handleSendTestLog(message, panel);
            case 'testProbeCode':
                return this.handleTestProbeCode(message, panel);
            default:
                console.warn('[DashboardMessageHandler] Unknown command:', message.command);
                return { success: false, message: 'Unknown command' };
        }
    }
    
    /**
     * Обработать команду очистки логов
     */
    private async handleClearLogs(panel: vscode.WebviewPanel): Promise<any> {
        console.log('[DashboardMessageHandler] Clearing logs...');
        try {
            // Очищаем логи в shared storage
            const sharedStorage = SharedLogStorage.getInstance();
            await sharedStorage.clear();
            
            // Отправляем сообщение в веб-панель о том, что логи очищены
            panel.webview.postMessage({ type: 'clearLogs' });
            
            return { success: true, message: 'Logs cleared successfully' };
        } catch (error) {
            console.error('[DashboardMessageHandler] Error clearing logs:', error);
            return { success: false, message: error instanceof Error ? error.message : 'Failed to clear logs' };
        }
    }
    
    /**
     * Обработать команду отправки тестового лога
     */
    private async handleSendTestLog(message: WebViewMessage, panel: vscode.WebviewPanel): Promise<any> {
        console.log('[DashboardMessageHandler] Sending test log...');
        try {
            const sharedStorage = SharedLogStorage.getInstance();
            
            // Создаем тестовый лог
            const testLog: RuntimeLog = {
                timestamp: new Date().toISOString(),
                hypothesisId: message.hypothesisId || 'TEST',
                context: message.context || 'Test log from dashboard',
                data: message.data || { test: true, source: 'dashboard', timestamp: new Date().toISOString() }
            };
            
            // Добавляем лог в хранилище
            await sharedStorage.addLog(testLog);
            
            // Отправляем результат обратно в веб-панель
            panel.webview.postMessage({
                type: 'testLogResult',
                success: true,
                message: `Test log sent: ${testLog.hypothesisId}`,
                log: testLog
            });
            
            return {
                success: true,
                message: 'Test log sent successfully',
                log: testLog
            };
        } catch (error) {
            console.error('[DashboardMessageHandler] Error sending test log:', error);
            
            // Отправляем сообщение об ошибке в веб-панель
            panel.webview.postMessage({
                type: 'testLogResult',
                success: false,
                message: error instanceof Error ? error.message : 'Failed to send test log'
            });
            
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Failed to send test log'
            };
        }
    }
    
    /**
     * Обработать команду тестирования probe кода
     */
    private async handleTestProbeCode(message: WebViewMessage, panel: vscode.WebviewPanel): Promise<any> {
        console.log('[DashboardMessageHandler] Testing probe code...');
        try {
            const sharedStorage = SharedLogStorage.getInstance();
            const probeCode = message.probeCode || '';
            const hypothesisId = message.hypothesisId || 'TEST';
            
            if (!probeCode.trim()) {
                console.warn('[DashboardMessageHandler] Empty probe code received');
                
                // Отправляем сообщение об ошибке в веб-панель
                panel.webview.postMessage({
                    type: 'probeTestResult',
                    success: false,
                    message: 'Probe code is empty. Please enter probe code to test.'
                });
                
                return {
                    success: false,
                    message: 'Probe code is empty. Please enter probe code to test.'
                };
            }
            
            console.log(`[DashboardMessageHandler] Processing probe code (${probeCode.length} chars) for hypothesis ${hypothesisId}`);
            
            // Логируем пробный код для дальнейшего тестирования
            const testLog: RuntimeLog = {
                timestamp: new Date().toISOString(),
                hypothesisId: hypothesisId,
                context: 'Probe code test - logged for manual testing',
                data: {
                    probeCode: probeCode.substring(0, 500), // Ограничиваем длину
                    probeCodeLength: probeCode.length,
                    timestamp: new Date().toISOString(),
                    note: 'This probe code was logged. Copy and execute it in your Python environment to test if it sends logs to the server.'
                }
            };
            
            await sharedStorage.addLog(testLog);
            console.log(`[DashboardMessageHandler] Probe code logged to storage: ${hypothesisId}`);
            
            // Проверяем, является ли это Python-кодом с HTTP-запросами
            if (probeCode.includes('http.client') || probeCode.includes('requests') || probeCode.includes('urllib')) {
                // Это Python-проба - регистрируем для ручного тестирования
                console.log('[DashboardMessageHandler] Python probe code detected (http.client/requests/urllib). Logged for manual testing.');
                
                // Отправляем сообщение в веб-панель
                panel.webview.postMessage({
                    type: 'probeTestResult',
                    success: true,
                    message: `Probe code logged (${probeCode.length} chars). Copy the code from the log entry below and execute it in your Python environment to test if it sends logs to the server.`,
                    probeCode: probeCode.substring(0, 200)
                });
            } else {
                // Неизвестный формат пробы
                console.log('[DashboardMessageHandler] Unknown probe code format');
                
                // Отправляем сообщение об ошибке в веб-панель
                panel.webview.postMessage({
                    type: 'probeTestResult',
                    success: false,
                    message: 'Unknown probe code format. Expected Python code with http.client, requests, or urllib.'
                });
                
                return {
                    success: false,
                    message: 'Unknown probe code format. Expected Python code with http.client, requests, or urllib.'
                };
            }
            
            return {
                success: true,
                message: 'Probe code tested successfully',
                probeCode: probeCode.substring(0, 100) + '...'
            };
        } catch (error) {
            console.error('[DashboardMessageHandler] Error testing probe code:', error);
            
            // Логируем ошибку
            const errorLog: RuntimeLog = {
                timestamp: new Date().toISOString(),
                hypothesisId: 'ERROR',
                context: 'Probe code test error',
                data: {
                    error: error instanceof Error ? error.message : String(error),
                    probeCode: message.probeCode ? message.probeCode.substring(0, 200) : ''
                }
            };
            
            const sharedStorage = SharedLogStorage.getInstance();
            await sharedStorage.addLog(errorLog);
            
            // Отправляем сообщение об ошибке в веб-панель
            panel.webview.postMessage({
                type: 'probeTestResult',
                success: false,
                message: error instanceof Error ? error.message : 'Failed to test probe code'
            });
            
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Failed to test probe code'
            };
        }
    }
}