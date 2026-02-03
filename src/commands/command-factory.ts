/**
 * Фабрика команд VS Code
 */

import * as vscode from 'vscode';
import { ExtensionCommand } from '../extension-core/command-registry';
import {
    handleStartServerCommand,
    handleStopServerCommand,
    handleClearLogsCommand,
    handleOpenDashboardCommand,
    handleReregisterMcpServerCommand,
    handleReadRuntimeLogsCommand,
    handleClearSessionCommand,
    handleShowUserInstructionsCommand,
    handleCleanupCommand,
    handleRemoveFromGitignoreCommand,
    handleExportJSONCommand,
    handleExportCSVCommand,
    handleExportMarkdownCommand,
    handleExportHTMLCommand
} from './command-handlers';

/**
 * Фабрика команд расширения
 */
export class CommandFactory {
    /**
     * Создать команду запуска сервера
     */
    public static createStartServerCommand(): ExtensionCommand {
        return {
            id: 'rooTrace.startServer',
            handler: handleStartServerCommand,
            title: 'Start RooTrace Server',
            category: 'RooTrace'
        };
    }
    
    /**
     * Создать команду остановки сервера
     */
    public static createStopServerCommand(): ExtensionCommand {
        return {
            id: 'rooTrace.stopServer',
            handler: handleStopServerCommand,
            title: 'Stop RooTrace Server',
            category: 'RooTrace'
        };
    }
    
    /**
     * Создать команду очистки логов
     */
    public static createClearLogsCommand(): ExtensionCommand {
        return {
            id: 'rooTrace.clearLogs',
            handler: handleClearLogsCommand,
            title: 'Clear RooTrace Logs',
            category: 'RooTrace'
        };
    }
    
    /**
     * Создать команду открытия dashboard
     */
    public static createOpenDashboardCommand(): ExtensionCommand {
        return {
            id: 'ai-debugger.openDashboard',
            handler: handleOpenDashboardCommand,
            title: 'Open AI Debugger Dashboard',
            category: 'RooTrace'
        };
    }
    
    /**
     * Создать команду перерегистрации MCP сервера
     */
    public static createReregisterMcpServerCommand(): ExtensionCommand {
        return {
            id: 'rooTrace.reregisterMcpServer',
            handler: handleReregisterMcpServerCommand,
            title: 'Re-register MCP Server',
            category: 'RooTrace'
        };
    }
    
    /**
     * Создать команду чтения runtime логов
     */
    public static createReadRuntimeLogsCommand(): ExtensionCommand {
        return {
            id: 'rooTrace.readRuntimeLogs',
            handler: handleReadRuntimeLogsCommand,
            title: 'Read Runtime Logs',
            category: 'RooTrace'
        };
    }
    
    /**
     * Создать команду очистки сессии
     */
    public static createClearSessionCommand(): ExtensionCommand {
        return {
            id: 'rooTrace.clearSession',
            handler: handleClearSessionCommand,
            title: 'Clear Debug Session',
            category: 'RooTrace'
        };
    }
    
    /**
     * Создать команду показа инструкций пользователю
     */
    public static createShowUserInstructionsCommand(): ExtensionCommand {
        return {
            id: 'rooTrace.showUserInstructions',
            handler: handleShowUserInstructionsCommand,
            title: 'Show User Instructions',
            category: 'RooTrace'
        };
    }
    
    /**
     * Создать команду очистки debug кода
     */
    public static createCleanupCommand(): ExtensionCommand {
        return {
            id: 'ai-debugger.cleanup',
            handler: handleCleanupCommand,
            title: 'Cleanup AI Debug Code',
            category: 'RooTrace'
        };
    }
    
    /**
     * Создать команду удаления из .gitignore
     */
    public static createRemoveFromGitignoreCommand(): ExtensionCommand {
        return {
            id: 'rooTrace.removeFromGitignore',
            handler: handleRemoveFromGitignoreCommand,
            title: 'Remove RooTrace from .gitignore',
            category: 'RooTrace'
        };
    }
    
    /**
     * Создать команду экспорта логов в JSON
     */
    public static createExportJSONCommand(): ExtensionCommand {
        return {
            id: 'rooTrace.exportJSON',
            handler: handleExportJSONCommand,
            title: 'Export Logs as JSON',
            category: 'RooTrace'
        };
    }
    
    /**
     * Создать команду экспорта логов в CSV
     */
    public static createExportCSVCommand(): ExtensionCommand {
        return {
            id: 'rooTrace.exportCSV',
            handler: handleExportCSVCommand,
            title: 'Export Logs as CSV',
            category: 'RooTrace'
        };
    }
    
    /**
     * Создать команду экспорта логов в Markdown
     */
    public static createExportMarkdownCommand(): ExtensionCommand {
        return {
            id: 'rooTrace.exportMarkdown',
            handler: handleExportMarkdownCommand,
            title: 'Export Logs as Markdown',
            category: 'RooTrace'
        };
    }
    
    /**
     * Создать команду экспорта логов в HTML
     */
    public static createExportHTMLCommand(): ExtensionCommand {
        return {
            id: 'rooTrace.exportHTML',
            handler: handleExportHTMLCommand,
            title: 'Export Logs as HTML',
            category: 'RooTrace'
        };
    }
    
    /**
     * Получить все команды расширения
     */
    public static getAllCommands(): ExtensionCommand[] {
        return [
            this.createStartServerCommand(),
            this.createStopServerCommand(),
            this.createClearLogsCommand(),
            this.createOpenDashboardCommand(),
            this.createReregisterMcpServerCommand(),
            this.createReadRuntimeLogsCommand(),
            this.createClearSessionCommand(),
            this.createShowUserInstructionsCommand(),
            this.createCleanupCommand(),
            this.createRemoveFromGitignoreCommand(),
            this.createExportJSONCommand(),
            this.createExportCSVCommand(),
            this.createExportMarkdownCommand(),
            this.createExportHTMLCommand()
        ];
    }
}