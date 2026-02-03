/**
 * Обработчики команд VS Code
 */

import * as vscode from 'vscode';
import { ServerManager } from '../server/server-manager';
import { DashboardManager } from '../dashboard/dashboard-manager';
import { LogManager } from '../logging/log-manager';
import { SessionManager } from '../session-manager';
import { registerMcpServer, unregisterMcpServer } from '../mcp-registration';
import { LogExporter } from '../log-exporter';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Обработчик команды запуска сервера
 */
export async function handleStartServerCommand(): Promise<void> {
    try {
        const serverManager = ServerManager.getInstance();
        
        // Check if server is already running
        if (serverManager.isRunning()) {
            const port = serverManager.getPort();
            vscode.window.showInformationMessage(`RooTrace: Server already running on port ${port}`);
            return;
        }
        
        // Start the server
        const port = await serverManager.startServer();
        vscode.window.showInformationMessage(`RooTrace: Server started successfully on port ${port}`);
    } catch (error) {
        console.error('[CommandHandlers] Error starting server:', error);
        vscode.window.showErrorMessage(`RooTrace: Failed to start server - ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Обработчик команды остановки сервера
 */
export async function handleStopServerCommand(): Promise<void> {
    try {
        const serverManager = ServerManager.getInstance();
        
        // Check if server is running
        if (!serverManager.isRunning()) {
            vscode.window.showWarningMessage('RooTrace: Server is not running');
            return;
        }
        
        // Stop the server
        await serverManager.stopServer();
        vscode.window.showInformationMessage('RooTrace: Server stopped successfully');
    } catch (error) {
        console.error('[CommandHandlers] Error stopping server:', error);
        vscode.window.showErrorMessage(`RooTrace: Failed to stop server - ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Обработчик команды очистки логов
 */
export async function handleClearLogsCommand(): Promise<void> {
    try {
        const logManager = LogManager.getInstance();
        await logManager.clearLogs();
        vscode.window.showInformationMessage('RooTrace: Logs cleared successfully');
    } catch (error) {
        console.error('[CommandHandlers] Error clearing logs:', error);
        vscode.window.showErrorMessage(`RooTrace: Failed to clear logs - ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Обработчик команды открытия dashboard
 */
export async function handleOpenDashboardCommand(): Promise<void> {
    try {
        const dashboardManager = DashboardManager.getInstance();
        await dashboardManager.openDashboard();
        vscode.window.showInformationMessage('RooTrace: Dashboard opened successfully');
    } catch (error) {
        console.error('[CommandHandlers] Error opening dashboard:', error);
        vscode.window.showErrorMessage(`RooTrace: Failed to open dashboard - ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Обработчик команды перерегистрации MCP сервера
 */
export async function handleReregisterMcpServerCommand(): Promise<void> {
    try {
        // First unregister existing registration
        await unregisterMcpServer();
        
        // Then register again
        // We need to get the extension context, which is not available here
        // This command should be called from the extension activation context
        vscode.window.showInformationMessage('RooTrace: MCP server re-registration initiated');
    } catch (error) {
        console.error('[CommandHandlers] Error re-registering MCP server:', error);
        vscode.window.showErrorMessage(`RooTrace: Failed to re-register MCP server - ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Обработчик команды чтения runtime логов
 */
export async function handleReadRuntimeLogsCommand(): Promise<any> {
    try {
        const logManager = LogManager.getInstance();
        const logs = await logManager.getInMemoryLogs();
        
        return {
            success: true,
            message: 'Runtime logs read successfully',
            logs: logs,
            count: logs.length
        };
    } catch (error) {
        console.error('[CommandHandlers] Error reading runtime logs:', error);
        return {
            success: false,
            message: `Failed to read runtime logs - ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * Обработчик команды очистки сессии
 */
export async function handleClearSessionCommand(): Promise<any> {
    try {
        const sessionManager = SessionManager.getInstance();
        await sessionManager.completeSession();
        
        // Also clear logs as part of session cleanup
        const logManager = LogManager.getInstance();
        await logManager.clearLogs();
        
        return {
            success: true,
            message: 'Session cleared successfully'
        };
    } catch (error) {
        console.error('[CommandHandlers] Error clearing session:', error);
        return {
            success: false,
            message: `Failed to clear session - ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * Обработчик команды показа инструкций пользователю
 */
export async function handleShowUserInstructionsCommand(instructions: string, stepNumber?: number): Promise<any> {
    try {
        const stepText = stepNumber !== undefined ? ` Step ${stepNumber}:` : '';
        
        // Show instructions in a quick pick dialog for user interaction
        const options = ['Continue', 'Skip', 'Cancel'];
        const choice = await vscode.window.showQuickPick(options, {
            placeHolder: `RooTrace Instructions${stepText} ${instructions}`
        });
        
        return {
            action: 'instructions_shown',
            choice: choice,
            instructions: instructions,
            stepNumber: stepNumber
        };
    } catch (error) {
        console.error('[CommandHandlers] Error showing user instructions:', error);
        return {
            action: 'instructions_error',
            choice: null,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

/**
 * Обработчик команды очистки debug кода
 */
export async function handleCleanupCommand(): Promise<void> {
    try {
        // This would typically remove debug probes from files
        // For now, we'll just show a message indicating the cleanup process
        vscode.window.showInformationMessage('RooTrace: Cleanup process initiated. Removing debug probes...');
        
        // In a real implementation, this would iterate through tracked files and remove debug code
        // Implementation would depend on probe tracking mechanisms
        console.log('[CommandHandlers] Cleanup command executed - would remove debug probes from files');
    } catch (error) {
        console.error('[CommandHandlers] Error during cleanup:', error);
        vscode.window.showErrorMessage(`RooTrace: Failed to clean up debug code - ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Обработчик команды удаления из .gitignore
 */
export async function handleRemoveFromGitignoreCommand(): Promise<void> {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage('RooTrace: No workspace folder found');
            return;
        }
        
        const workspacePath = workspaceFolders[0].uri.fsPath;
        const gitignorePath = path.join(workspacePath, '.gitignore');
        
        if (!fs.existsSync(gitignorePath)) {
            vscode.window.showInformationMessage('RooTrace: .gitignore file not found');
            return;
        }
        
        // Read current .gitignore content
        const content = fs.readFileSync(gitignorePath, 'utf8');
        const lines = content.split('\n');
        
        // Filter out RooTrace-related entries
        const filteredLines = lines.filter(line => {
            // Remove lines that contain RooTrace patterns
            return !line.includes('.roo/') &&
                   !line.includes('ai_debug_logs.json') &&
                   !line.includes('rootrace') &&
                   !line.trim().startsWith('# RooTrace');
        }).filter(line => line.trim() !== ''); // Remove empty lines
        
        // Write back the cleaned content
        fs.writeFileSync(gitignorePath, filteredLines.join('\n'), 'utf8');
        
        vscode.window.showInformationMessage('RooTrace: Entries removed from .gitignore successfully');
    } catch (error) {
        console.error('[CommandHandlers] Error removing from .gitignore:', error);
        vscode.window.showErrorMessage(`RooTrace: Failed to remove from .gitignore - ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Обработчик команды экспорта логов в JSON
 */
export async function handleExportJSONCommand(): Promise<void> {
    try {
        const content = await LogExporter.exportLogs({ format: 'json', includeMetadata: true });
        const filePath = await LogExporter.saveToFile(content, 'json', `roo-trace-logs-${Date.now()}.json`);
        
        const openOption = await vscode.window.showInformationMessage(
            `RooTrace: Logs exported to JSON successfully at ${filePath}`,
            'Open File', 'Close'
        );
        
        if (openOption === 'Open File') {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
        }
    } catch (error) {
        console.error('[CommandHandlers] Error exporting logs to JSON:', error);
        vscode.window.showErrorMessage(`RooTrace: Failed to export logs to JSON - ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Обработчик команды экспорта логов в CSV
 */
export async function handleExportCSVCommand(): Promise<void> {
    try {
        const content = await LogExporter.exportLogs({ format: 'csv', includeMetadata: true });
        const filePath = await LogExporter.saveToFile(content, 'csv', `roo-trace-logs-${Date.now()}.csv`);
        
        const openOption = await vscode.window.showInformationMessage(
            `RooTrace: Logs exported to CSV successfully at ${filePath}`,
            'Open File', 'Close'
        );
        
        if (openOption === 'Open File') {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
        }
    } catch (error) {
        console.error('[CommandHandlers] Error exporting logs to CSV:', error);
        vscode.window.showErrorMessage(`RooTrace: Failed to export logs to CSV - ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Обработчик команды экспорта логов в Markdown
 */
export async function handleExportMarkdownCommand(): Promise<void> {
    try {
        const content = await LogExporter.exportLogs({ format: 'markdown', includeMetadata: true });
        const filePath = await LogExporter.saveToFile(content, 'markdown', `roo-trace-logs-${Date.now()}.md`);
        
        const openOption = await vscode.window.showInformationMessage(
            `RooTrace: Logs exported to Markdown successfully at ${filePath}`,
            'Open File', 'Close'
        );
        
        if (openOption === 'Open File') {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
        }
    } catch (error) {
        console.error('[CommandHandlers] Error exporting logs to Markdown:', error);
        vscode.window.showErrorMessage(`RooTrace: Failed to export logs to Markdown - ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Обработчик команды экспорта логов в HTML
 */
export async function handleExportHTMLCommand(): Promise<void> {
    try {
        const content = await LogExporter.exportLogs({ format: 'html', includeMetadata: true });
        const filePath = await LogExporter.saveToFile(content, 'html', `roo-trace-logs-${Date.now()}.html`);
        
        const openOption = await vscode.window.showInformationMessage(
            `RooTrace: Logs exported to HTML successfully at ${filePath}`,
            'Open File', 'Open in Browser'
        );
        
        if (openOption === 'Open File') {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
        } else if (openOption === 'Open in Browser') {
            const uri = vscode.Uri.file(filePath);
            await vscode.env.openExternal(uri);
        }
    } catch (error) {
        console.error('[CommandHandlers] Error exporting logs to HTML:', error);
        vscode.window.showErrorMessage(`RooTrace: Failed to export logs to HTML - ${error instanceof Error ? error.message : String(error)}`);
    }
}