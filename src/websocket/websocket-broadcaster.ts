/**
 * Вещатель сообщений через WebSocket
 */

import { WebSocketManager } from './websocket-manager';

/**
 * Интерфейс лога для вещания
 */
export interface BroadcastLog {
    timestamp: string;
    hypothesisId: string;
    context: string;
    data: any;
}

/**
 * Вещатель WebSocket сообщений
 */
export class WebSocketBroadcaster {
    private static instance: WebSocketBroadcaster;
    private webSocketManager: WebSocketManager;
    
    private constructor() {
        this.webSocketManager = WebSocketManager.getInstance();
    }
    
    /**
     * Получить экземпляр вещателя (Singleton)
     */
    public static getInstance(): WebSocketBroadcaster {
        if (!WebSocketBroadcaster.instance) {
            WebSocketBroadcaster.instance = new WebSocketBroadcaster();
        }
        return WebSocketBroadcaster.instance;
    }
    
    /**
     * Вещать новый лог
     */
    public broadcastLog(log: BroadcastLog): void {
        const message = {
            type: 'newLog',
            log
        };
        
        this.webSocketManager.broadcast(message);
    }
    
    /**
     * Вещать системное сообщение
     */
    public broadcastSystemMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
        const systemMessage = {
            type: 'system',
            level,
            message,
            timestamp: new Date().toISOString()
        };
        
        this.webSocketManager.broadcast(systemMessage);
    }
    
    /**
     * Вещать обновление состояния
     */
    public broadcastStateUpdate(state: any): void {
        const stateMessage = {
            type: 'stateUpdate',
            state,
            timestamp: new Date().toISOString()
        };
        
        this.webSocketManager.broadcast(stateMessage);
    }
    
    /**
     * Вещать команду
     */
    public broadcastCommand(command: string, data?: any): void {
        const commandMessage = {
            type: 'command',
            command,
            data,
            timestamp: new Date().toISOString()
        };
        
        this.webSocketManager.broadcast(commandMessage);
    }
    
    /**
     * Проверить, есть ли активные клиенты
     */
    public hasActiveClients(): boolean {
        return this.webSocketManager.getClientCount() > 0;
    }
    
    /**
     * Получить статистику вещания
     */
    public getStats(): { activeClients: number } {
        return {
            activeClients: this.webSocketManager.getClientCount()
        };
    }
}