/**
 * Менеджер dashboard панели
 */

import * as vscode from 'vscode';
import { SharedLogStorage } from '../shared-log-storage';
import { DashboardMessageHandler } from './dashboard-message-handler';
import { getWebviewContent } from './webview-content';
import { WebSocketManager } from '../websocket/websocket-manager';
import { WebSocketClient } from '../websocket/websocket-manager';

/**
 * Менеджер dashboard панели
 */
export class DashboardManager {
    private static instance: DashboardManager;
    private panel: vscode.WebviewPanel | undefined;
    private webSocketManager: WebSocketManager;
    private context: vscode.ExtensionContext | undefined;
    private webSocketClient: WebSocketClient | undefined;
    
    private constructor() {
        this.webSocketManager = WebSocketManager.getInstance();
    }
    
    /**
     * Инициализировать менеджер с контекстом расширения
     */
    public initialize(context: vscode.ExtensionContext): void {
        this.context = context;
    }
    
    /**
     * Получить URI расширения
     */
    private getExtensionUri(): vscode.Uri {
        if (!this.context) {
            throw new Error('DashboardManager not initialized with context');
        }
        return this.context.extensionUri;
    }
    
    /**
     * Получить экземпляр менеджера (Singleton)
     */
    public static getInstance(): DashboardManager {
        if (!DashboardManager.instance) {
            DashboardManager.instance = new DashboardManager();
        }
        return DashboardManager.instance;
    }
    
    /**
     * Открыть dashboard
     */
    public async openDashboard(): Promise<void> {
        const sharedStorage = SharedLogStorage.getInstance();
        
        // Если панель уже существует, просто показываем её
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Two);
            // Отправляем текущие логи при отображении существующей панели
            setTimeout(async () => {
                if (this.panel) {
                    const runtimeLogs = await sharedStorage.getLogs();
                    if (runtimeLogs.length > 0) {
                        const logsToSend = runtimeLogs.map(log => ({
                            hypothesisId: log.hypothesisId,
                            context: log.context,
                            data: log.data,
                            timestamp: log.timestamp
                        }));
                        this.panel.webview.postMessage({
                            type: 'initialLogs',
                            logs: logsToSend
                        });
                    }
                }
            }, 100);
            return;
        }

        // Создаём новую панель
        this.panel = vscode.window.createWebviewPanel(
            'aiDebuggerDashboard',
            'AI Debugger Dashboard',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(this.getExtensionUri(), 'media')]
            }
        );
        
        // Register the webview panel as a WebSocket client to receive log broadcasts
        this.webSocketClient = {
            readyState: 1, // WebSocket.OPEN
            send: (data: string) => {
                if (this.panel && this.panel.webview) {
                    // Convert the message to a format suitable for webview
                    try {
                        const messageObj = JSON.parse(data);
                        this.panel.webview.postMessage({
                            type: 'runtimeLogs',
                            logs: messageObj
                        });
                    } catch (error) {
                        console.error('[DashboardManager] Error sending WebSocket message to webview:', error);
                    }
                }
            },
            close: () => {
                if (this.panel) {
                    this.panel.dispose();
                }
            }
        };
        
        this.webSocketManager.addClient(this.webSocketClient);

        this.panel.webview.html = getWebviewContent([]);
        
        // Обрабатываем сообщения из WebView
        this.panel.webview.onDidReceiveMessage(async (message: any) => {
            console.log('[DashboardManager] Received message from webview:', message);
            
            const handler = DashboardMessageHandler.getInstance();
            const result = await handler.handleMessage(message, this.panel!);
            
            // Отправляем результат обратно в веб-панель
            if (result && this.panel) {
                this.panel.webview.postMessage({
                    type: `${message.command}Result`,
                    ...result
                });
            }
        });

        this.panel.onDidDispose(() => {
            // Remove the specific client when the panel is disposed
            if (this.webSocketClient) {
                this.webSocketManager.removeClient(this.webSocketClient);
                this.webSocketClient = undefined;
            }
            this.panel = undefined;
        });

        // Функция для отправки логов в dashboard
        const sendLogsToDashboard = async () => {
            if (!this.panel) return;
            
            const runtimeLogs = await sharedStorage.getLogs();
            
            if (runtimeLogs.length > 0) {
                const logsToSend = runtimeLogs.map(log => ({
                    hypothesisId: log.hypothesisId,
                    context: log.context,
                    data: log.data,
                    timestamp: log.timestamp
                }));
                
                this.panel.webview.postMessage({
                    type: 'initialLogs',
                    logs: logsToSend
                });
            }
        };
        
        // Отправляем логи после небольшой задержки для обеспечения готовности веб-панели
        setTimeout(sendLogsToDashboard, 300);
        setTimeout(sendLogsToDashboard, 800);
    }
    
    /**
     * Закрыть dashboard
     */
    public closeDashboard(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
        
        // Remove the specific WebSocket client associated with this dashboard
        if (this.webSocketClient) {
            this.webSocketManager.removeClient(this.webSocketClient);
            this.webSocketClient = undefined;
        }
    }
    
    /**
     * Проверить, открыт ли dashboard
     */
    public isDashboardOpen(): boolean {
        return !!this.panel;
    }
    
    /**
     * Получить текущую панель dashboard
     */
    public getPanel(): vscode.WebviewPanel | undefined {
        return this.panel;
    }
    
    /**
     * Отправить сообщение в dashboard
     */
    public sendMessage(message: any): boolean {
        if (this.panel) {
            this.panel.webview.postMessage(message);
            return true;
        }
        return false;
    }
}