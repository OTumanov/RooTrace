/**
 * Менеджер активации/деактивации расширения
 */

import * as vscode from 'vscode';
import { ServerManager } from '../server/server-manager';
import { DashboardManager } from '../dashboard/dashboard-manager';
import { SessionManager } from '../session-manager';
import { WebSocketManager } from '../websocket/websocket-manager';
import { CommandRegistry } from './command-registry';
import { ExtensionStateManager } from './extension-state';
import { CommandFactory } from '../commands/command-factory';
import { PromptService } from '../services/prompt-service';
import { RoleManager } from '../role-manager';
import { registerMcpServer, unregisterMcpServer } from '../mcp-registration';
import { SharedLogStorage } from '../shared-log-storage';
import { LogService } from '../services/log-service';
import { StorageService } from '../services/storage-service';
import { RoleService } from '../services/role-service';
import { ensureRootraceInGitignore } from '../rootrace-dir-utils';
import { validateEncryptionKey } from '../encryption-validator';

/**
 * Интерфейс для конфигурации активации
 */
export interface ActivationConfig {
    autoStartServer: boolean;
    registerCommands: boolean;
    initializeServices: boolean;
}

/**
 * Менеджер активации расширения
 */
export class ActivationManager {
    private static instance: ActivationManager;
    
    private constructor() {}
    
    /**
     * Получить экземпляр менеджера (Singleton)
     */
    public static getInstance(): ActivationManager {
        if (!ActivationManager.instance) {
            ActivationManager.instance = new ActivationManager();
        }
        return ActivationManager.instance;
    }
    
    /**
     * Активировать расширение
     */
    public async activate(context: vscode.ExtensionContext, config?: Partial<ActivationConfig>): Promise<void> {
        // Merge config with defaults
        const finalConfig: ActivationConfig = {
            autoStartServer: config?.autoStartServer ?? true,
            registerCommands: config?.registerCommands ?? true,
            initializeServices: config?.initializeServices ?? true,
        };

        console.log('[ActivationManager] Extension activating...');

        // ВАЖНО: Проверяем ключ шифрования ПЕРЕД инициализацией сервисов
        try {
            validateEncryptionKey();
            console.log('[ActivationManager] Encryption key validated successfully.');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[ActivationManager] Encryption key validation failed:', errorMessage);
            
            // Показываем пользователю понятное сообщение об ошибке
            vscode.window.showErrorMessage(
                'RooTrace: Ошибка конфигурации шифрования',
                {
                    modal: true,
                    detail: errorMessage
                }
            );
            
            // Предлагаем открыть документацию с инструкциями
            const action = await vscode.window.showWarningMessage(
                'Для продолжения необходимо настроить ключ шифрования. Открыть инструкции?',
                'Открыть документацию',
                'Отмена'
            );
            
            if (action === 'Открыть документацию') {
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/OTumanov/RooTrace#encryption'));
            }
            
            throw new Error(`Encryption key validation failed: ${errorMessage}`);
        }

        // Initialize managers
        if (finalConfig.initializeServices) {
            // Initialize DashboardManager with context
            const dashboardManager = DashboardManager.getInstance();
            try {
                dashboardManager.initialize(context);
            } catch (error) {
                console.error('[ActivationManager] Error initializing dashboard:', error);
                throw error;
            }

            // Initialize and start server if needed
            if (finalConfig.autoStartServer) {
                const serverManager = ServerManager.getInstance();
                try {
                    await serverManager.startServer();
                    
                    // Update extension state with server port
                    const extensionState = ExtensionStateManager.getInstance();
                    extensionState.updateState({
                        serverPort: serverManager.getPort() || null
                    });
                } catch (error) {
                    console.error('[ActivationManager] Error starting server:', error);
                    throw error;
                }
            }

            // Setup WebSocket listeners
            const webSocketManager = WebSocketManager.getInstance();
            webSocketManager.setupWebSocketListeners();

            // Initialize session
            const sessionManager = SessionManager.getInstance();
            try {
                const sessionId = await sessionManager.createSession('Initial session');
                console.log(`[ActivationManager] Created session: ${sessionId}`);
            } catch (error) {
                console.error('[ActivationManager] Error creating session:', error);
                throw error;
            }
        }

        // Register commands if needed
        if (finalConfig.registerCommands) {
            const commandRegistry = CommandRegistry.getInstance();
            const commands = CommandFactory.getAllCommands();
            try {
                commandRegistry.registerCommands(commands, context);
            } catch (error) {
                console.error('[ActivationManager] Error registering commands:', error);
                throw error;
            }
        }

        // Update activation status
        const extensionState = ExtensionStateManager.getInstance();
        extensionState.setActive(true);
        extensionState.setOutputChannel(vscode.window.createOutputChannel('AI Debugger'));
        
        // Additional initialization calls
        try {
            // Copy prompt modules
            const promptService = new PromptService(extensionState.getOutputChannel() || vscode.window.createOutputChannel('AI Debugger'));
            await promptService.copyPromptModules(context);
            
            // Initialize services
            const outputChannel = extensionState.getOutputChannel() || vscode.window.createOutputChannel('AI Debugger');
            const logService = new LogService(outputChannel);
            const storageService = new StorageService(outputChannel);
            const roleService = new RoleService(outputChannel);
            
            // Ensure .rootrace directory is added to .gitignore
            ensureRootraceInGitignore();
            
            // Sync role with Roo using the role service
            await roleService.syncRoleWithRoo(context);
            
            // Register MCP server
            await registerMcpServer(context);
        } catch (error) {
            console.error('[ActivationManager] Error in additional initialization:', error);
            throw error;
        }
        
        console.log('[ActivationManager] Extension activated successfully');
    }
    
    /**
     * Деактивировать расширение
     */
    public async deactivate(): Promise<void> {
        console.log('[ActivationManager] Extension deactivating...');

        // Stop WebSocket listeners
        const webSocketManager = WebSocketManager.getInstance();
        webSocketManager.removeWebSocketListeners();
        webSocketManager.clearClients();

        // Close dashboard if open
        const dashboardManager = DashboardManager.getInstance();
        dashboardManager.closeDashboard();

        // Complete current session
        const sessionManager = SessionManager.getInstance();
        try {
            await sessionManager.completeSession();
        } catch (error) {
            console.error('[ActivationManager] Error completing session:', error);
        }

        // Stop the server
        const serverManager = ServerManager.getInstance();
        try {
            await serverManager.stopServer();
        } catch (error) {
            console.error('[ActivationManager] Error stopping server:', error);
        }

        // Unregister all commands
        const commandRegistry = CommandRegistry.getInstance();
        commandRegistry.clear();

        // Update activation status
        const extensionState = ExtensionStateManager.getInstance();
        extensionState.setActive(false);

        // Clean up SharedLogStorage
        const sharedStorage = SharedLogStorage.getInstance();
        sharedStorage.dispose();

        // Unregister MCP server
        await unregisterMcpServer();

        console.log('[ActivationManager] Extension deactivated successfully');
    }
    
    /**
     * Проверить, активно ли расширение
     */
    public isActive(): boolean {
        const extensionState = ExtensionStateManager.getInstance();
        return extensionState.getState().isActive;
    }
}
