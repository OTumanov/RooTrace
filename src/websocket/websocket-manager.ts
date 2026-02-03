/**
 * Менеджер WebSocket соединений
 */

import { RuntimeLog } from '../types';
import { SharedLogStorage } from '../shared-log-storage';
import { WebSocketBroadcaster } from './websocket-broadcaster';

/**
 * Интерфейс WebSocket клиента
 */
export interface WebSocketClient {
    readyState: number;
    send(data: string): void;
    close(): void;
}

/**
 * Менеджер WebSocket соединений
 */
export class WebSocketManager {
    private static instance: WebSocketManager;
    private wsClients: Set<WebSocketClient> = new Set();
    private wsServer: WebSocketClient | null = null;
    private logAddedListener: ((log: any) => void) | null = null;
    
    private constructor() {}
    
    /**
     * Получить экземпляр менеджера (Singleton)
     */
    public static getInstance(): WebSocketManager {
        if (!WebSocketManager.instance) {
            WebSocketManager.instance = new WebSocketManager();
        }
        return WebSocketManager.instance;
    }
    
    /**
     * Добавить клиента
     */
    public addClient(client: WebSocketClient): void {
        this.wsClients.add(client);
    }
    
    /**
     * Удалить клиента
     */
    public removeClient(client: WebSocketClient): boolean {
        return this.wsClients.delete(client);
    }
    
    /**
     * Установить WebSocket сервер
     */
    public setServer(server: WebSocketClient): void {
        this.wsServer = server;
    }
    
    /**
     * Отправить сообщение всем клиентам
     */
    public broadcast(message: any): void {
        const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
        
        const clientsToRemove: WebSocketClient[] = [];
        this.wsClients.forEach(client => {
            try {
                if (client.readyState === 1) { // WebSocket.OPEN
                    client.send(messageStr);
                } else {
                    // Клиент закрыт или закрывается - помечаем для удаления
                    clientsToRemove.push(client);
                }
            } catch (error) {
                // Ошибка при отправке - удаляем клиента
                clientsToRemove.push(client);
            }
        });
        
        // Удаляем неактивные клиенты
        clientsToRemove.forEach(client => this.removeClient(client));
    }
    
    /**
     * Отправить сообщение конкретному клиенту
     */
    public sendToClient(client: WebSocketClient, message: any): boolean {
        try {
            if (client.readyState === 1) {
                const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
                client.send(messageStr);
                return true;
            }
        } catch (error) {
            // Игнорируем ошибки отправки
        }
        return false;
    }
    
    /**
     * Получить количество подключенных клиентов
     */
    public getClientCount(): number {
        return this.wsClients.size;
    }
    
    /**
     * Очистить всех клиентов
     */
    public clearClients(): void {
        this.wsClients.forEach(client => {
            try {
                if (client.readyState === 1) {
                    client.close();
                }
            } catch (error) {
                // Игнорируем ошибки закрытия
            }
        });
        this.wsClients.clear();
    }
    
    /**
     * Настроить слушатели WebSocket
     */
    public setupWebSocketListeners(): void {
        const sharedStorage = SharedLogStorage.getInstance();
        const broadcaster = WebSocketBroadcaster.getInstance();

        // Удаляем предыдущую подписку, если она существует
        if (this.logAddedListener) {
            this.removeWebSocketListeners();
        }

        // Создаем обработчик с оберткой try-catch
        this.logAddedListener = (log: RuntimeLog) => {
            try {
                // Отправляем новый лог всем подключенным WebSocket клиентам через broadcaster
                broadcaster.broadcastLog({
                    timestamp: log.timestamp,
                    hypothesisId: log.hypothesisId,
                    context: log.context,
                    data: log.data
                });
            } catch (error) {
                console.error('[WebSocketManager] Error broadcasting log:', error);
            }
        };

        sharedStorage.on('logAdded', this.logAddedListener);

        console.log('[WebSocketManager] WebSocket listeners setup completed');
    }
    
    /**
     * Удалить слушатели WebSocket
     */
    public removeWebSocketListeners(): void {
        const sharedStorage = SharedLogStorage.getInstance();
        
        if (this.logAddedListener) {
            sharedStorage.removeListener('logAdded', this.logAddedListener);
            this.logAddedListener = null;
            console.log('[WebSocketManager] WebSocket listeners removed');
        }
    }
}