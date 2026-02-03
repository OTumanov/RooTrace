/**
 * Управление глобальным состоянием расширения
 */

import * as vscode from 'vscode';

/**
 * Интерфейс глобального состояния расширения
 */
export interface ExtensionState {
    isActive: boolean;
    serverPort: number | null;
    outputChannel: vscode.OutputChannel | null;
    webviewPanel: vscode.WebviewPanel | undefined;
    activationTime: Date | null;
}

/**
 * Менеджер глобального состояния расширения
 */
export class ExtensionStateManager {
    private static instance: ExtensionStateManager;
    private state: ExtensionState;
    
    private constructor() {
        this.state = {
            isActive: false,
            serverPort: null,
            outputChannel: null,
            webviewPanel: undefined,
            activationTime: null
        };
    }
    
    /**
     * Получить экземпляр менеджера (Singleton)
     */
    public static getInstance(): ExtensionStateManager {
        if (!ExtensionStateManager.instance) {
            ExtensionStateManager.instance = new ExtensionStateManager();
        }
        return ExtensionStateManager.instance;
    }
    
    /**
     * Получить текущее состояние
     */
    public getState(): ExtensionState {
        return { ...this.state };
    }
    
    /**
     * Обновить состояние
     */
    public updateState(updates: Partial<ExtensionState>): void {
        this.state = { ...this.state, ...updates };
    }
    
    /**
     * Установить флаг активности
     */
    public setActive(isActive: boolean): void {
        this.state.isActive = isActive;
        if (isActive && !this.state.activationTime) {
            this.state.activationTime = new Date();
        }
    }
    
    /**
     * Установить порт сервера
     */
    public setServerPort(port: number | null): void {
        this.state.serverPort = port;
    }
    
    /**
     * Установить output channel
     */
    public setOutputChannel(channel: vscode.OutputChannel): void {
        this.state.outputChannel = channel;
    }
    
    /**
     * Установить webview panel
     */
    public setWebviewPanel(panel: vscode.WebviewPanel | undefined): void {
        this.state.webviewPanel = panel;
    }
    
    /**
     * Получить порт сервера
     */
    public getServerPort(): number | null {
        return this.state.serverPort;
    }
    
    /**
     * Получить output channel
     */
    public getOutputChannel(): vscode.OutputChannel | null {
        return this.state.outputChannel;
    }
    
    /**
     * Получить webview panel
     */
    public getWebviewPanel(): vscode.WebviewPanel | undefined {
        return this.state.webviewPanel;
    }
    
    /**
     * Проверить, активно ли расширение
     */
    public isActive(): boolean {
        return this.state.isActive;
    }
    
    /**
     * Сбросить состояние
     */
    public reset(): void {
        this.state = {
            isActive: false,
            serverPort: null,
            outputChannel: null,
            webviewPanel: undefined,
            activationTime: null
        };
    }
}