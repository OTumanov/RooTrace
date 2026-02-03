/**
 * Менеджер серверов (HTTP + WebSocket)
 */

import * as vscode from 'vscode';
import * as http from 'http';
import { createHTTPServer, startHTTPServer, stopHTTPServer } from '../http-server/server';
import { PortManager } from './port-manager';
import { SharedLogStorage } from '../shared-log-storage';
import { getDiagnosticsForMCP } from '../diagnostics-handler';
import { metricsCollector } from '../metrics';
import { LogData, RuntimeLog } from '../types';
import { logInfo } from '../error-handler';

/**
 * Конфигурация сервера
 */
export interface ServerConfig {
    port: number;
    host: string;
    autoStart: boolean;
}

/**
 * Менеджер серверов
 */
export class ServerManager {
    private static instance: ServerManager;
    private server: http.Server | null = null;
    private port: number | null = null;
    
    private constructor() {}
    
    /**
     * Получить экземпляр менеджера (Singleton)
     */
    public static getInstance(): ServerManager {
        if (!ServerManager.instance) {
            ServerManager.instance = new ServerManager();
        }
        return ServerManager.instance;
    }
    
    /**
     * Запустить сервер
     */
    public async startServer(config?: Partial<ServerConfig>): Promise<number> {
        if (this.server) {
            console.log('Server is already running.');
            return this.port!;
        }
        
        // Create HTTP server with CORS support
        const sharedStorage = SharedLogStorage.getInstance();
        
        // Define the output channel mock or dependency injection
        const outputChannel = {
            appendLine: (msg: string) => console.log(msg)
            // In real implementation, this would be injected
        };
        
        this.server = createHTTPServer({
            onLog: async (hypothesisId: string, context: string, state: any) => {
                const runtimeLog: RuntimeLog = {
                    hypothesisId,
                    context,
                    data: state,
                    timestamp: new Date().toISOString()
                };
                
                await sharedStorage.addLog(runtimeLog);
            },
            getLogsCount: async () => (await sharedStorage.getLogs()).length,
            getLogs: async () => {
                const logs = await sharedStorage.getLogs();
                return logs.map(log => JSON.stringify(log));
            },
            outputChannel
        });
        
        // Get port from configuration or use default
        const portManager = PortManager.getInstance();
        const configuredPort = config?.port || 51234;
        
        // Try to get an available port
        const availablePort = await portManager.getAvailablePort(configuredPort);
        
        // Start the server
        return new Promise<number>((resolve, reject) => {
            if (!this.server) {
                reject(new Error('Server is not initialized'));
                return;
            }
            
            startHTTPServer(
                this.server,
                availablePort,
                (actualPort) => {
                    this.port = actualPort;
                    
                    // Save port to file
                    if (this.port !== null) {
                        portManager.savePortToFile(this.port);
                        
                        // Here you would typically create AI debug config too
                        // createAIDebugConfig(); // This would need to be implemented elsewhere
                        
                        logInfo(`Server started on port ${this.port}`, 'ServerManager.startServer');
                    }
                    
                    resolve(this.port!);
                },
                (error) => {
                    console.error('Failed to start server:', error);
                    reject(error);
                }
            );
        });
    }
    
    /**
     * Остановить сервер
     */
    public async stopServer(): Promise<void> {
        if (!this.server) {
            console.log('Server is not running.');
            return;
        }
        
        // Stop the HTTP server
        await stopHTTPServer(this.server);
        
        // Remove port file
        const portManager = PortManager.getInstance();
        portManager.removePortFile();
        
        // Reset internal state
        this.server = null;
        this.port = null;
    }
    
    /**
     * Получить порт сервера
     */
    public getPort(): number | null {
        return this.port;
    }
    
    /**
     * Проверить, запущен ли сервер
     */
    public isRunning(): boolean {
        return this.server !== null;
    }
    
    /**
     * Получить URL сервера
     */
    public getServerUrl(): string | null {
        if (this.port) {
            return `http://localhost:${this.port}/`;
        }
        return null;
    }
}