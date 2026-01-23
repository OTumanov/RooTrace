import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { registerMcpServer, unregisterMcpServer } from './mcp-registration';
import { RoleManager } from './role-manager';
import { SharedLogStorage, RuntimeLog } from './shared-log-storage';
import { SessionManager } from './session-manager';
import { LogExporter, ExportFormat } from './log-exporter';
import { encryptObject, decryptObject, getEncryptionKey } from './encryption-utils';
import { initializeErrorHandler, handleError, logInfo, logDebug, handleWarning } from './error-handler';
import { parseArrayOrDecrypt, parseConfigOrDecrypt } from './utils';
import { metricsCollector } from './metrics';
import { SERVER_CONFIG, RATE_LIMIT_CONFIG } from './constants';
import { LogData } from './types';
import { getRootraceFilePath, ensureRootraceInGitignore } from './rootrace-dir-utils';
import { getDiagnosticsForMCP } from './diagnostics-handler';

// Интерфейсы для типизации
interface WebSocketClient {
  readyState: number;
  send(data: string): void;
  close(): void;
}

interface WebViewMessage {
  command?: string;
  type?: string;
  logs?: unknown;
  error?: string;
  hypothesisId?: string;
  context?: string;
  data?: LogData;
  probeCode?: string;
  timestamp?: string;
}

interface LogDataRequest {
  hypothesisId?: string;
  message?: string;
  state?: LogData;
}

let server: http.Server | null = null;
let port: number | null = null;
let outputChannel: vscode.OutputChannel;
let wsServer: WebSocketClient | null = null; // WebSocket server
const wsClients: Set<WebSocketClient> = new Set(); // WebSocket clients

// WebView Panel
let panel: vscode.WebviewPanel | undefined;

// Используем shared log storage вместо изолированного массива
const sharedStorage = SharedLogStorage.getInstance();

// Function to get log file path for current workspace
function getLogFilePath(): string {
    return getRootraceFilePath('ai_debug_logs.json');
}

function getReadLogsApprovalFilePath(): string {
    return getRootraceFilePath('allow-read-runtime-logs.json');
}

function getAutoDebugApprovalFilePath(): string {
    return getRootraceFilePath('allow-auto-debug.json');
}

/**
 * Копирует модули промптов из ресурсов расширения в рабочую область
 * Копирует только если файлы еще не существуют (не перезаписывает пользовательские изменения)
 */
async function copyPromptModules(context: vscode.ExtensionContext): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return; // Нет рабочей области
    }

    const extensionPath = context.extensionPath;
    // Пробуем несколько возможных путей к модулям в расширении
    // ИСПОЛЬЗУЕМ roo-trace-rules, чтобы Roo Code не загружал их автоматически
    const possibleSourceDirs = [
        path.join(extensionPath, '.roo', 'roo-trace-rules'),
        path.join(extensionPath, 'extension', '.roo', 'roo-trace-rules'), // Для упакованного расширения
        path.join(__dirname, '..', '.roo', 'roo-trace-rules') // Для разработки
    ];
    
    let sourceDir: string | null = null;
    for (const dir of possibleSourceDirs) {
        if (fs.existsSync(dir)) {
            sourceDir = dir;
            outputChannel.appendLine(`[RooTrace] Found prompt modules at: ${dir}`);
            break;
        }
    }
    
    // Проверяем, существует ли директория с модулями в расширении
    if (!sourceDir) {
        outputChannel.appendLine(`[RooTrace] Warning: Prompt modules directory not found. Tried: ${possibleSourceDirs.join(', ')}`);
        return;
    }

    // Копируем для каждой рабочей области
    // ИСПОЛЬЗУЕМ roo-trace-rules, чтобы Roo Code не загружал их автоматически
    for (const folder of workspaceFolders) {
        const workspacePath = folder.uri.fsPath;
        const targetDir = path.join(workspacePath, '.roo', 'roo-trace-rules');

        try {
            // Создаем целевую директорию, если её нет
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
                outputChannel.appendLine(`[RooTrace] Created directory: ${targetDir}`);
            }

            // Читаем все файлы из исходной директории
            const sourceFiles = fs.readdirSync(sourceDir, { withFileTypes: true });
            let copiedCount = 0;
            let skippedCount = 0;

            for (const file of sourceFiles) {
                if (file.isFile() && file.name.endsWith('.md')) {
                    const sourcePath = path.join(sourceDir, file.name);
                    const targetPath = path.join(targetDir, file.name);

                    // Копируем только если файл еще не существует
                    if (!fs.existsSync(targetPath)) {
                        fs.copyFileSync(sourcePath, targetPath);
                        copiedCount++;
                        outputChannel.appendLine(`[RooTrace] Copied: ${file.name}`);
                    } else {
                        skippedCount++;
                        outputChannel.appendLine(`[RooTrace] Skipped (exists): ${file.name}`);
                    }
                }
            }

            outputChannel.appendLine(`[RooTrace] Prompt modules: ${copiedCount} copied, ${skippedCount} skipped for workspace: ${workspacePath}`);
        } catch (error) {
            const errorMsg = `Failed to copy prompt modules to ${targetDir}: ${error}`;
            outputChannel.appendLine(`[RooTrace] ERROR: ${errorMsg}`);
            throw new Error(errorMsg);
        }
    }
}

// Function to append log entries to the persistent file
async function appendLogToFile(hypothesisId: string, context: string, data: LogData) {
    try {
        const logFilePath = getLogFilePath();
        
        // Create log entry object
        const logEntry = {
            hypothesisId,
            context,
            data,
            timestamp: new Date().toISOString()
        };

        // Read existing logs if file exists
        let existingLogs: any[] = [];
        if (fs.existsSync(logFilePath)) {
            const fileContent = fs.readFileSync(logFilePath, 'utf8');
            if (fileContent.trim()) {
                // Используем общую утилиту для парсинга массива с fallback на дешифровку
                existingLogs = parseArrayOrDecrypt(fileContent, []);
            }
        }

        // Append new log entry
        existingLogs.push(logEntry);

        // Encrypt and write updated logs back to file
        const encryptionKey = getEncryptionKey();
        const encryptedLogs = encryptObject(existingLogs, encryptionKey);
        fs.writeFileSync(logFilePath, encryptedLogs, 'utf8');
    } catch (error) {
        outputChannel.appendLine(`[ERROR] Failed to write log to file: ${error}`);
    }
}

// Configuration interface
interface AIDebugConfig {
    url: string;
    status: string;
    timestamp: number;
}

export async function activate(context: vscode.ExtensionContext) {
    // Убеждаемся, что .rootrace существует и добавлен в .gitignore при активации
    ensureRootraceInGitignore();
    // КРИТИЧНО: Логируем в консоль ПЕРВЫМ делом, до создания output channel
    // Это поможет увидеть проблему даже если output channel не создастся
    console.error('='.repeat(60));
    console.error('[RooTrace] ===== EXTENSION ACTIVATING =====');
    console.error(`[RooTrace] Extension path: ${context.extensionPath}`);
    console.error(`[RooTrace] Extension ID: ${context.extension.id}`);
    console.error(`[RooTrace] Extension version: ${context.extension.packageJSON.version}`);
    console.error(`[RooTrace] Node version: ${process.version}`);
    console.error(`[RooTrace] Platform: ${process.platform}`);
    
    // Создаем Output Channel
    try {
        outputChannel = vscode.window.createOutputChannel('AI Debugger');
        // Инициализируем ErrorHandler с output channel
        initializeErrorHandler(outputChannel);
        
        outputChannel.appendLine('='.repeat(50));
        outputChannel.appendLine('[RooTrace] Extension ACTIVATING...');
        outputChannel.appendLine(`[RooTrace] Extension path: ${context.extensionPath}`);
        outputChannel.appendLine(`[RooTrace] Extension ID: ${context.extension.id}`);
        outputChannel.appendLine(`[RooTrace] Extension version: ${context.extension.packageJSON.version}`);
        outputChannel.show(true); // Показываем канал сразу
        
        logInfo('Output channel created successfully', 'Extension.activate');
    } catch (error) {
        handleError(error, 'Extension.activate', { action: 'createOutputChannel' });
    }
    
    const startCommand = vscode.commands.registerCommand('rooTrace.startServer', async () => {
        await startServer();
    });
    
    const stopCommand = vscode.commands.registerCommand('rooTrace.stopServer', async () => {
        await stopServer();
    });
    
    const clearLogsCommand = vscode.commands.registerCommand('rooTrace.clearLogs', async () => {
        await clearLogs();
    });

    // Re-register MCP server command (to update configuration without reloading extension)
    const reregisterMcpServerCommand = vscode.commands.registerCommand('rooTrace.reregisterMcpServer', async () => {
        try {
            outputChannel.appendLine('[RooTrace] Re-registering MCP server...');
            await registerMcpServer(context);
            outputChannel.appendLine('[RooTrace] MCP server re-registration completed');
            vscode.window.showInformationMessage('RooTrace: MCP server configuration updated. Please restart Roo Code to apply changes.');
        } catch (error) {
            const errorMsg = `Failed to re-register MCP server: ${error}`;
            outputChannel.appendLine(`[RooTrace] ERROR: ${errorMsg}`);
            vscode.window.showErrorMessage(`RooTrace: ${errorMsg}`);
            handleError(error, 'Extension.reregisterMcpServer', { action: 'reregisterMcpServer' });
        }
    });

    // WebView Dashboard command
    const openDashboardCommand = vscode.commands.registerCommand('ai-debugger.openDashboard', async () => {
        await openDashboard();
    });
    
    // MCP Commands for dashboard buttons
    const readRuntimeLogsCommand = vscode.commands.registerCommand('rooTrace.readRuntimeLogs', async () => {
        try {
            // USER GATE: allow read_runtime_logs ONLY when user pressed this button/command
            const approvalPath = getReadLogsApprovalFilePath();
            try {
                fs.writeFileSync(
                    approvalPath,
                    JSON.stringify({ approvedAt: new Date().toISOString(), approvedAtMs: Date.now() }, null, 2),
                    'utf8'
                );
            } catch (e) {
                outputChannel.appendLine(`[RooTrace] ERROR: Failed to write read-logs approval file: ${e}`);
            }

            // Call the MCP tool directly
            const result = await vscode.commands.executeCommand('mcp-roo-trace-read_runtime_logs');

            // Best-effort cleanup: prevent agent from reusing approval later
            try {
                if (fs.existsSync(approvalPath)) fs.unlinkSync(approvalPath);
            } catch {
                // ignore
            }
            return result;
        } catch (error) {
            handleError(error, 'Extension.readRuntimeLogs', { action: 'readRuntimeLogs' });
            throw error;
        }
    });
    
    const clearSessionCommand = vscode.commands.registerCommand('rooTrace.clearSession', async () => {
        try {
            // Call the MCP tool directly
            const result = await vscode.commands.executeCommand('mcp-roo-trace-clear_session');
            return result;
        } catch (error) {
            handleError(error, 'Extension.clearSession', { action: 'clearSession' });
            throw error;
        }
    });
    
    // Command to show user instructions - popup с кнопками (без таймеров)
    const showUserInstructionsCommand = vscode.commands.registerCommand('rooTrace.showUserInstructions', async (instructions: string, stepNumber?: number) => {
        const stepNum = stepNumber || 1;
        const message = `Шаг ${stepNum}: ${instructions}`;

        // Всегда дублируем в Output Channel (чтобы не потерялось)
        outputChannel.appendLine(`\n[USER INSTRUCTIONS] ${message}\n`);
        outputChannel.show(true);

        const choice = await vscode.window.showInformationMessage(
            message,
            { modal: true },
            'Открыть дашборд',
            'Прочитать логи (кнопка)',
            'Я выполнил (Logs ready)',
            'Разрешить авто-отладку (5 мин)',
            'Очистить сессию',
            'Закрыть'
        );

        if (choice === 'Открыть дашборд') {
            await openDashboard();
        } else if (choice === 'Прочитать логи (кнопка)') {
            // Это и есть “кнопка пользователя”: разрешаем и читаем логи через rooTrace.readRuntimeLogs
            await vscode.commands.executeCommand('rooTrace.readRuntimeLogs');
        } else if (choice === 'Я выполнил (Logs ready)') {
            await openDashboard();
            vscode.window.showInformationMessage('Ок. Теперь напишите в чат: "Logs ready".');
        } else if (choice === 'Очистить сессию') {
            try {
                await vscode.commands.executeCommand('rooTrace.clearSession');
                vscode.window.showInformationMessage('Сессия отладки очищена.');
            } catch (error) {
                vscode.window.showErrorMessage(`Ошибка при очистке сессии: ${error}`);
            }
        } else if (choice === 'Разрешить авто-отладку (5 мин)') {
            const autoPath = getAutoDebugApprovalFilePath();
            try {
                fs.writeFileSync(
                    autoPath,
                    JSON.stringify({ approvedAt: new Date().toISOString(), approvedAtMs: Date.now(), ttlMs: 5 * 60 * 1000 }, null, 2),
                    'utf8'
                );
                vscode.window.showInformationMessage('Авто-отладка разрешена на 5 минут: агент сможет сам читать логи.');
            } catch (e) {
                vscode.window.showErrorMessage(`Не удалось сохранить разрешение авто-отладки: ${e}`);
            }
        }

        return { action: 'instructions_shown', choice: choice || null };
    });
    
    // Commands for user instructions buttons (legacy, для обратной совместимости)
    const continueDebuggingCommand = vscode.commands.registerCommand('rooTrace.continueDebugging', async () => {
        // Показываем сообщение, что пользователь готов продолжить
        const action = await vscode.window.showInformationMessage(
            'Готовы продолжить анализ логов?',
            'Да, проанализировать логи',
            'Отмена'
        );
        
        if (action === 'Да, проанализировать логи') {
            // Открываем дашборд и показываем логи
            await openDashboard();
            outputChannel.appendLine('[USER ACTION] Пользователь готов к анализу логов');
        }
    });
    
    const markResolvedCommand = vscode.commands.registerCommand('rooTrace.markResolved', async () => {
        const action = await vscode.window.showInformationMessage(
            'Проблема устранена? Очистить сессию отладки?',
            'Да, очистить сессию',
            'Отмена'
        );
        
        if (action === 'Да, очистить сессию') {
            try {
                await vscode.commands.executeCommand('rooTrace.clearSession');
                vscode.window.showInformationMessage('Сессия отладки очищена. Проблема решена!');
            } catch (error) {
                vscode.window.showErrorMessage(`Ошибка при очистке сессии: ${error}`);
            }
        }
    });

    // Cleanup command
    const cleanupCommand = vscode.commands.registerCommand('ai-debugger.cleanup', async () => {
        await cleanupDebugCode();
    });

    // Export commands
    const exportJSONCommand = vscode.commands.registerCommand('rooTrace.exportJSON', async () => {
        await exportLogs('json');
    });

    const exportCSVCommand = vscode.commands.registerCommand('rooTrace.exportCSV', async () => {
        await exportLogs('csv');
    });

    const exportMarkdownCommand = vscode.commands.registerCommand('rooTrace.exportMarkdown', async () => {
        await exportLogs('markdown');
    });

    const exportHTMLCommand = vscode.commands.registerCommand('rooTrace.exportHTML', async () => {
        await exportLogs('html');
    });
    
    // Логируем активацию
    outputChannel.appendLine('[RooTrace] Extension activating...');
    outputChannel.show(true);
    
    // Проверяем наличие воркспейса
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        outputChannel.appendLine('[RooTrace] WARNING: No workspace opened. MCP server and role registration will be skipped.');
        outputChannel.appendLine('[RooTrace] Please open a workspace folder and reload the window.');
        vscode.window.showWarningMessage('RooTrace: Please open a workspace folder for full functionality.');
        return;
    }
    
    outputChannel.appendLine(`[RooTrace] Workspace detected: ${workspaceFolders.map(f => f.name).join(', ')}`);
    
    // Start server automatically on activation
    // Config file will be created after server assigns port (in startServer callback)
    try {
        outputChannel.appendLine('[RooTrace] Starting HTTP server...');
        await startServer();
        outputChannel.appendLine('[RooTrace] HTTP server started successfully');
    } catch (error) {
        outputChannel.appendLine(`[RooTrace] ERROR: Failed to start HTTP server: ${error}`);
        vscode.window.showErrorMessage(`RooTrace: Failed to start HTTP server: ${error}`);
    }
    
    // Register MCP server
    try {
        outputChannel.appendLine('[RooTrace] Registering MCP server...');
        await registerMcpServer(context);
        outputChannel.appendLine('[RooTrace] MCP server registration completed');
    } catch (error) {
        outputChannel.appendLine(`[RooTrace] ERROR: Failed to register MCP server: ${error}`);
        vscode.window.showErrorMessage(`RooTrace: Failed to register MCP server: ${error}`);
    }
    
    // Initialize session manager and create first session
    try {
        const sessionManager = SessionManager.getInstance();
        const sessionId = sessionManager.createSession('Initial session');
        outputChannel.appendLine(`[RooTrace] Session created: ${sessionId}`);
    } catch (error) {
        outputChannel.appendLine(`[RooTrace] ERROR: Failed to create session: ${error}`);
    }
    
    // Копируем модули промптов в рабочую область (если их еще нет)
    try {
        outputChannel.appendLine('[RooTrace] Copying prompt modules to workspace...');
        await copyPromptModules(context);
        outputChannel.appendLine('[RooTrace] Prompt modules copy completed');
    } catch (error) {
        outputChannel.appendLine(`[RooTrace] ERROR: Failed to copy prompt modules: ${error}`);
        handleError(error, 'Extension.activate', { action: 'copyPromptModules' });
    }
    
    // Синхронизируем роль с Roo Code
    try {
        outputChannel.appendLine('[RooTrace] Syncing role with Roo Code...');
        await RoleManager.syncRoleWithRoo(context);
        outputChannel.appendLine('[RooTrace] Role sync completed');
    } catch (error) {
        outputChannel.appendLine(`[RooTrace] ERROR: Failed to sync role: ${error}`);
        vscode.window.showErrorMessage(`RooTrace: Failed to sync role: ${error}`);
    }
    
    outputChannel.appendLine('[RooTrace] Extension activation completed');

    // Опционально: следим за открытием новых папок (для Multi-root воркспейсов)
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async () => {
            await RoleManager.syncRoleWithRoo(context);
        })
    );

    // УСТАРЕЛО: prompts/ больше не используется - все модули в .roo/roo-trace-rules/ с lazy loading
    // Watcher для prompts/ удален, так как файлы из prompts/ не загружаются в system prompt

    // UI bridge for MCP: .roo-trace-ui.json -> real VS Code popup with buttons + response file
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
        for (const folder of folders) {
            // Убеждаемся, что .rootrace существует и добавлен в .gitignore
            ensureRootraceInGitignore();
            const uiEventPath = getRootraceFilePath('ui.json');
            const uiResponsePath = getRootraceFilePath('ui-response.json');
            fs.watchFile(uiEventPath, { interval: 500 }, async (curr, prev) => {
                if (curr.mtime <= prev.mtime) return;
                try {
                    const raw = fs.readFileSync(uiEventPath, 'utf8');
                    const evt = JSON.parse(raw) as { type?: string; requestId?: string; instructions?: string; stepNumber?: number };
                    if (evt?.type === 'show_user_instructions' && typeof evt.instructions === 'string') {
                        const res = await vscode.commands.executeCommand(
                            'rooTrace.showUserInstructions',
                            evt.instructions,
                            evt.stepNumber
                        ) as any;

                        // Пишем ответ для MCP-сервера, чтобы он мог "остановиться" до клика пользователя
                        try {
                            fs.writeFileSync(
                                uiResponsePath,
                                JSON.stringify({ requestId: evt.requestId, choice: res?.choice ?? null, at: new Date().toISOString() }, null, 2),
                                'utf8'
                            );
                        } catch (e) {
                            outputChannel.appendLine(`[RooTrace] ERROR: Failed to write UI response: ${e}`);
                        }
                    }

                    // Чтобы не показывать popup повторно при случайных перезаписях — очищаем event-файл
                    try {
                        fs.writeFileSync(uiEventPath, '', 'utf8');
                    } catch {
                        // ignore
                    }
                } catch (e) {
                    outputChannel.appendLine(`[RooTrace] ERROR: Failed to process UI event: ${e}`);
                }
            });
            context.subscriptions.push({
                dispose: () => {
                    fs.unwatchFile(uiEventPath);
                }
            });
        }
    }
    
    context.subscriptions.push(
        startCommand,
        stopCommand,
        clearLogsCommand,
        reregisterMcpServerCommand,
        openDashboardCommand,
        cleanupCommand,
        exportJSONCommand,
        exportCSVCommand,
        exportMarkdownCommand,
        exportHTMLCommand,
        readRuntimeLogsCommand,
        clearSessionCommand,
        showUserInstructionsCommand,
        continueDebuggingCommand,
        markResolvedCommand
    );
    
    // Setup WebSocket listeners for real-time updates
    setupWebSocketListeners();
}


async function createAIDebugConfig() {
    if (!port) {
        outputChannel.appendLine('[SYSTEM] Port not assigned yet, skipping .ai_debug_config creation');
        return;
    }
    
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        outputChannel.appendLine('[SYSTEM] No workspace folders, skipping .ai_debug_config creation');
        return;
    }
    
    // Убеждаемся, что .rootrace существует и добавлен в .gitignore
    ensureRootraceInGitignore();
    
    // Create config for each workspace folder
    for (const folder of workspaceFolders) {
        const configPath = getRootraceFilePath('ai_debug_config');
        const config: AIDebugConfig = {
            url: `http://localhost:${port}/`,
            status: "active",
            timestamp: Date.now()
        };
        
        try {
            // Encrypt the config before writing to file
            const encryptionKey = getEncryptionKey();
            const encryptedConfig = encryptObject(config, encryptionKey);
            fs.writeFileSync(configPath, encryptedConfig, 'utf8');
            outputChannel.appendLine(`[SYSTEM] Created encrypted .ai_debug_config in ${folder.name}`);
        } catch (error) {
            outputChannel.appendLine(`[SYSTEM] Error creating .ai_debug_config in ${folder.name}: ${error}`);
        }
    }
}

async function clearLogs() {
    // Очищаем shared storage
    await sharedStorage.clear();
    
    outputChannel.clear();
    outputChannel.appendLine('[SYSTEM] Logs cleared.');
    outputChannel.show(true);
    
    // Clear the persistent log file
    try {
        const logFilePath = getLogFilePath();
        if (fs.existsSync(logFilePath)) {
            // Пишем пустой массив через SharedLogStorage (единый формат/локи)
            // Файл уже очищен вызовом sharedStorage.clear(); оставляем этот блок как no-op на случай кастомных сценариев.
        }
    } catch (error) {
        outputChannel.appendLine(`[SYSTEM] Error clearing persistent log file: ${error}`);
    }
}

function loadAIDebugConfig(): AIDebugConfig | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        outputChannel.appendLine('[SYSTEM] No workspace opened. Cannot load .ai_debug_config.');
        return null;
    }
    
    // Try to load from first workspace folder
    const configPath = path.join(workspaceFolders[0].uri.fsPath, '.ai_debug_config');
    
    if (!fs.existsSync(configPath)) {
        outputChannel.appendLine('[SYSTEM] .ai_debug_config not found in workspace root.');
        return null;
    }
    
    try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        
        // Try to parse as JSON first (for backwards compatibility with unencrypted configs)
        let config: AIDebugConfig;
        try {
            config = JSON.parse(configContent);
        } catch (parseError) {
            // If JSON parsing fails, try to decrypt the content
            try {
                const encryptionKey = getEncryptionKey();
                config = decryptObject(configContent, encryptionKey);
            } catch (decryptError) {
                outputChannel.appendLine(`[SYSTEM] Error decrypting .ai_debug_config: ${decryptError}`);
                return null;
            }
        }
        
        return config;
    } catch (error) {
        outputChannel.appendLine(`[SYSTEM] Error reading .ai_debug_config: ${error}`);
        return null;
    }
}

function formatLogEntry(hypothesisId: string, context: string, data: LogData): string {
    const now = new Date();
    const time = now.toTimeString().split(' ')[0]; // HH:MM:SS format
    
    const lines: string[] = [];
    lines.push(`[LOG][Hypothesis: ${hypothesisId}][Time: ${time}]`);
    lines.push(`Context: "${context}"`);
    lines.push(`Data: ${JSON.stringify(data, null, 2)}`);
    lines.push('---');
    
    return lines.join('\n');
}

async function logToOutputChannel(hypothesisId: string, context: string, data: LogData) {
    // Создаем RuntimeLog ДО try блока, чтобы он был доступен везде
    const runtimeLog: RuntimeLog = {
        timestamp: new Date().toISOString(),
        hypothesisId,
        context,
        data
    };
    
    try {
        outputChannel.appendLine(`[DEBUG] logToOutputChannel called: hypothesisId=${hypothesisId}, context=${context}`);
        
        const logEntry = formatLogEntry(hypothesisId, context, data);
        
        // Добавляем в shared storage
        // SharedLogStorage автоматически эмитит событие 'logAdded' для WebSocket клиентов
        outputChannel.appendLine(`[DEBUG] Calling sharedStorage.addLog...`);
        await sharedStorage.addLog(runtimeLog);
        outputChannel.appendLine(`[DEBUG] sharedStorage.addLog completed successfully`);
        
        // Проверяем, что лог действительно записался
        const logsAfter = await sharedStorage.getLogs();
        outputChannel.appendLine(`[DEBUG] Total logs in storage after add: ${logsAfter.length}`);
        
        // Output to channel
        outputChannel.appendLine(logEntry);
        outputChannel.show(true);
        
        // Debug: Log that we're sending to dashboard
        outputChannel.appendLine(`[DEBUG] Log added to storage: ${hypothesisId}, dashboard panel exists: ${!!panel}`);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`[ERROR] Failed to log to output channel: ${errorMsg}`);
        outputChannel.appendLine(`[ERROR] Stack: ${error instanceof Error ? error.stack : 'N/A'}`);
        handleError(error, 'Extension.logToOutputChannel', { hypothesisId, context });
        throw error;
    }

    // Send to WebView Dashboard if open, or open it automatically
    outputChannel.appendLine(`[DEBUG] Checking dashboard panel: exists=${!!panel}`);
    if (panel) {
        const logData = {
            hypothesisId,
            context,
            data,
            timestamp: runtimeLog.timestamp
        };
        outputChannel.appendLine(`[DEBUG] Sending log to dashboard: ${JSON.stringify({ hypothesisId, context })}`);
        try {
            panel.webview.postMessage(logData);
            outputChannel.appendLine(`[DEBUG] Sent log to existing dashboard: ${hypothesisId}`);
        } catch (error) {
            outputChannel.appendLine(`[ERROR] Failed to send log to dashboard: ${error}`);
            handleError(error, 'Extension.logToOutputChannel.dashboard', { hypothesisId });
        }
    } else {
        // НЕ открываем дашборд автоматически для тестовых логов (из get_debug_status)
        const isTestLog = typeof context === 'string' && context.startsWith('Server test:');
        if (isTestLog) {
            outputChannel.appendLine(`[DEBUG] Skipping auto-open dashboard for test log: ${hypothesisId}`);
            return; // Не открываем дашборд для тестовых логов
        }
        
        // Auto-open dashboard when first log arrives (только для реальных логов отладки)
        // Wait a bit to ensure log is saved to storage before opening dashboard
        await new Promise(resolve => setTimeout(resolve, 100));
        outputChannel.appendLine(`[DEBUG] Opening dashboard automatically for log: ${hypothesisId}`);
        openDashboard().then(() => {
            if (panel) {
                // The dashboard will receive initialLogs with all logs including this one
                // But also send this specific log as a separate message to ensure it's received
                setTimeout(() => {
                    if (panel) {
                        const logData = {
                            hypothesisId,
                            context,
                            data,
                            timestamp: runtimeLog.timestamp
                        };
                        panel.webview.postMessage(logData);
                        outputChannel.appendLine(`[DEBUG] Sent log to newly opened dashboard: ${hypothesisId}`);
                    }
                }, 500); // Longer delay to ensure dashboard is fully ready
            }
        }).catch((error) => {
            outputChannel.appendLine(`[ERROR] Failed to auto-open dashboard: ${error}`);
        });
    }
    
    // ⚠️ УБРАНО: appendLogToFile больше не используется
    // Логи записываются через sharedStorage.addLog -> saveToFile
    // Дублирование записи вызывало конфликты (шифрование vs JSON)
}

/**
 * Настраивает WebSocket слушатели для real-time обновлений
 */
function setupWebSocketListeners(): void {
    sharedStorage.on('logAdded', (log: RuntimeLog) => {
        // Отправляем новый лог всем подключенным WebSocket клиентам
        const message = JSON.stringify({
            type: 'newLog',
            log
        });
        
        // Очищаем неактивные клиенты и отправляем сообщение активным
        const config = vscode.workspace.getConfiguration('rooTrace');
        const autoCleanup = config.get<boolean>('autoCleanupInactiveClients', true);
        
        const clientsToRemove: WebSocketClient[] = [];
        wsClients.forEach(client => {
            try {
                if (client.readyState === 1) { // WebSocket.OPEN
                    client.send(message);
                } else {
                    // Клиент закрыт или закрывается - помечаем для удаления
                    if (autoCleanup) {
                        clientsToRemove.push(client);
                    }
                }
            } catch (error) {
                // Ошибка при отправке - удаляем клиента
                outputChannel.appendLine(`[WebSocket] Error sending to client: ${error}`);
                if (autoCleanup) {
                    clientsToRemove.push(client);
                }
            }
        });
        
        // Удаляем неактивные клиенты если включена автоматическая очистка
        if (autoCleanup) {
            clientsToRemove.forEach(client => wsClients.delete(client));
        }
    });
}

/**
 * Экспортирует логи в указанном формате
 */
async function exportLogs(format: ExportFormat): Promise<void> {
    try {
        const content = await LogExporter.exportLogs({
            format,
            includeMetadata: true
        });
        
        const filePath = await LogExporter.saveToFile(content, format);
        vscode.window.showInformationMessage(`Logs exported to ${path.basename(filePath)}`);
        outputChannel.appendLine(`[EXPORT] Logs exported to ${filePath}`);
    } catch (error) {
        const errorMessage = `Failed to export logs: ${error}`;
        vscode.window.showErrorMessage(errorMessage);
        outputChannel.appendLine(`[EXPORT] ${errorMessage}`);
    }
}

async function getInMemoryLogs(): Promise<string[]> {
    // Конвертируем RuntimeLog[] в формат строк для обратной совместимости
    const logs = await sharedStorage.getLogs();
    return logs.map(log => formatLogEntry(log.hypothesisId, log.context, log.data));
}

// WebView Dashboard Functions
async function openDashboard() {
    try {
        if (panel) {
            panel.reveal(vscode.ViewColumn.Two);
            // Send current logs when revealing existing panel
            setTimeout(async () => {
                if (panel) {
                    const runtimeLogs = await sharedStorage.getLogs();
                    if (runtimeLogs.length > 0) {
                        const logsToSend = runtimeLogs.map(log => ({
                            hypothesisId: log.hypothesisId,
                            context: log.context,
                            data: log.data,
                            timestamp: log.timestamp
                        }));
                        panel.webview.postMessage({ 
                            type: 'initialLogs', 
                            logs: logsToSend
                        });
                        outputChannel.appendLine(`[DEBUG] Sent ${logsToSend.length} logs to existing dashboard`);
                    }
                }
            }, 100);
            return;
        }

        panel = vscode.window.createWebviewPanel(
            'aiDebuggerDashboard',
            'AI Debugger Dashboard',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = getWebviewContent([]);
        
        // Handle messages from the WebView
        panel.webview.onDidReceiveMessage(async (message: WebViewMessage) => {
            outputChannel.appendLine(`[Dashboard] Received message from webview: ${JSON.stringify(message)}`);
            console.log('[Dashboard] Received message from webview:', message);
            
            if (message.command === 'clearLogs') {
                // Clear logs from shared storage
                sharedStorage.clear();
                panel?.webview.postMessage({ type: 'clearLogs' });
            } else if (message.command === 'sendTestLog') {
                // Send test log to server
                outputChannel.appendLine(`[Dashboard] Received sendTestLog command: ${JSON.stringify(message)}`);
                const testLog: RuntimeLog = {
                    timestamp: new Date().toISOString(),
                    hypothesisId: message.hypothesisId || 'TEST',
                    context: message.context || 'Test log from dashboard',
                    data: message.data || { test: true, source: 'dashboard', timestamp: new Date().toISOString() }
                };
                outputChannel.appendLine(`[Dashboard] Creating test log: ${JSON.stringify(testLog)}`);
                try {
                    await sharedStorage.addLog(testLog);
                    outputChannel.appendLine(`[Dashboard] Test log added to storage: ${testLog.hypothesisId} - ${testLog.context}`);
                    // Send confirmation back to dashboard
                    panel?.webview.postMessage({
                        type: 'testLogResult',
                        success: true,
                        message: `Test log sent: ${testLog.hypothesisId}`,
                        log: testLog
                    });
                } catch (error) {
                    outputChannel.appendLine(`[Dashboard] ERROR adding test log: ${error}`);
                    handleError(error, 'Extension.sendTestLog', { testLog });
                    panel?.webview.postMessage({
                        type: 'testLogResult',
                        success: false,
                        message: error instanceof Error ? error.message : String(error)
                    });
                }
            } else if (message.command === 'testProbeCode') {
                // Execute probe code and send result
                outputChannel.appendLine(`[Dashboard] Received testProbeCode command: ${JSON.stringify({ hypothesisId: message.hypothesisId, probeCodeLength: (message.probeCode || '').length })}`);
                const probeCode = message.probeCode || '';
                const hypothesisId = message.hypothesisId || 'TEST';
                
                try {
                    if (probeCode.trim()) {
                        outputChannel.appendLine(`[Dashboard] Processing probe code (${probeCode.length} chars) for hypothesis ${hypothesisId}`);
                        
                        // Log that we're testing the probe code
                        const testLog: RuntimeLog = {
                            timestamp: new Date().toISOString(),
                            hypothesisId: hypothesisId,
                            context: 'Probe code test - logged for manual testing',
                            data: {
                                probeCode: probeCode.substring(0, 500), // Limit length
                                probeCodeLength: probeCode.length,
                                timestamp: new Date().toISOString(),
                                note: 'This probe code was logged. Copy and execute it in your Python environment to test if it sends logs to the server.'
                            }
                        };
                        await sharedStorage.addLog(testLog);
                        outputChannel.appendLine(`[Dashboard] Probe code logged to storage: ${hypothesisId}`);
                        
                        // Try to execute Python probe code via HTTP request to server
                        // The probe code should send HTTP POST to localhost:51234
                        // We'll create a temporary Python script and execute it
                        if (probeCode.includes('http.client') || probeCode.includes('requests') || probeCode.includes('urllib')) {
                            // This is a Python probe - we need to execute it
                            outputChannel.appendLine(`[Dashboard] Python probe code detected (http.client/requests/urllib). Logged for manual testing.`);
                            
                            // Send a message back to dashboard
                            panel?.webview.postMessage({
                                type: 'probeTestResult',
                                success: true,
                                message: `Probe code logged (${probeCode.length} chars). Copy the code from the log entry below and execute it in your Python environment to test if it sends logs to the server.`,
                                probeCode: probeCode.substring(0, 200)
                            });
                        } else {
                            // Not a recognized probe format
                            outputChannel.appendLine(`[Dashboard] Unknown probe code format`);
                            panel?.webview.postMessage({
                                type: 'probeTestResult',
                                success: false,
                                message: 'Unknown probe code format. Expected Python code with http.client, requests, or urllib.'
                            });
                        }
                    } else {
                        outputChannel.appendLine(`[Dashboard] Empty probe code received`);
                        panel?.webview.postMessage({
                            type: 'probeTestResult',
                            success: false,
                            message: 'Probe code is empty. Please enter probe code to test.'
                        });
                    }
                } catch (error) {
                    const errorLog: RuntimeLog = {
                        timestamp: new Date().toISOString(),
                        hypothesisId: 'ERROR',
                        context: 'Probe code test error',
                        data: {
                            error: error instanceof Error ? error.message : String(error),
                            probeCode: probeCode.substring(0, 200)
                        }
                    };
                    await sharedStorage.addLog(errorLog);
                    handleError(error, 'Extension.testProbeCode', { probeCode: probeCode.substring(0, 100) });
                    
                    panel?.webview.postMessage({
                        type: 'probeTestResult',
                        success: false,
                        message: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        });
        
        panel.onDidDispose(() => {
            panel = undefined;
        });
        
        // Function to send logs to dashboard
        const sendLogsToDashboard = async () => {
            if (!panel) return;
            
            const runtimeLogs = await sharedStorage.getLogs();
            outputChannel.appendLine(`[DEBUG] Dashboard opened, sending ${runtimeLogs.length} logs to dashboard`);
            
            if (runtimeLogs.length > 0) {
                const logsToSend = runtimeLogs.map(log => ({
                    hypothesisId: log.hypothesisId,
                    context: log.context,
                    data: log.data,
                    timestamp: log.timestamp
                }));
                
                panel.webview.postMessage({ 
                    type: 'initialLogs', 
                    logs: logsToSend
                });
                outputChannel.appendLine(`[DEBUG] Sent initialLogs message with ${logsToSend.length} logs`);
            } else {
                outputChannel.appendLine(`[DEBUG] No logs found in storage to send to dashboard`);
            }
        };
        
        // Wait a bit for the webview to be ready before sending logs
        // This ensures the message listener is set up
        // Try multiple times to ensure logs are delivered
        setTimeout(sendLogsToDashboard, 300); // First attempt after 300ms
        setTimeout(sendLogsToDashboard, 800); // Second attempt after 800ms (fallback)

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to open dashboard: ${error}`);
    }
}

/**
 * Экранирует HTML символы для безопасности
 */
function escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function getWebviewContent(logs: string[]): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Debugger Dashboard</title>
    <style>
        :root {
            --vscode-font-family: var(--vscode-font-family);
            --vscode-font-size: var(--vscode-font-size);
            --vscode-editor-background: var(--vscode-editor-background);
            --vscode-editor-foreground: var(--vscode-editor-foreground);
            --vscode-editorLineNumber-foreground: var(--vscode-editorLineNumber-foreground);
            --vscode-textLink-foreground: var(--vscode-textLink-foreground);
            --vscode-textLink-activeForeground: var(--vscode-textLink-activeForeground);
            --vscode-editor-selectionBackground: var(--vscode-editor-selectionBackground);
            --vscode-editor-selectionHighlightBackground: var(--vscode-editor-selectionHighlightBackground);
            --vscode-editor-inactiveSelectionBackground: var(--vscode-editor-inactiveSelectionBackground);
            --vscode-input-background: var(--vscode-input-background);
            --vscode-input-foreground: var(--vscode-input-foreground);
            --vscode-input-border: var(--vscode-input-border);
            --vscode-editor-lineHighlightBackground: var(--vscode-editor-lineHighlightBackground);
            --vscode-widget-shadow: var(--vscode-widget-shadow);
            --vscode-editorInfo-foreground: var(--vscode-editorInfo-foreground);
            --vscode-editorWarning-foreground: var(--vscode-editorWarning-foreground);
            --vscode-editorError-foreground: var(--vscode-editorError-foreground);
            --vscode-button-background: var(--vscode-button-background);
            --vscode-button-foreground: var(--vscode-button-foreground);
            --vscode-button-hoverBackground: var(--vscode-button-hoverBackground);
        }
        
        .control-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            margin-right: 8px;
            cursor: pointer;
            font-family: inherit;
            font-size: 12px;
            border-radius: 4px;
        }
        
        .control-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .run-btn {
            background-color: #007acc;
        }
        
        .analyze-btn {
            background-color: #0066cc;
        }
        
        .confirm-btn {
            background-color: #28a745;
        }

        * {
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            margin: 0;
            padding: 16px;
            line-height: 1.5;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-editor-selectionBackground);
        }

        .header h1 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
        }

        .clear-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            cursor: pointer;
            font-family: inherit;
            font-size: 12px;
        }

        .clear-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .logs-container {
            max-height: calc(100vh - 80px);
            overflow-y: auto;
        }

        .log-entry {
            background-color: var(--vscode-editor-selectionBackground);
            padding: 12px;
            margin-bottom: 8px;
            border-radius: 4px;
            border-left: 4px solid transparent;
        }

        .log-entry.H1 {
            border-left-color: #ff4d4d;
        }

        .log-entry.H2 {
            border-left-color: #4dff4d;
        }

        .log-entry.H3 {
            border-left-color: #4d4dff;
        }

        .log-entry.H4 {
            border-left-color: #ffff4d;
        }

        .log-entry.H5 {
            border-left-color: #ff4dff;
        }

        .log-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 12px;
            color: var(--vscode-editorLineNumber-foreground);
        }

        .hypothesis-tag {
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 2px;
            font-size: 11px;
        }

        .hypothesis-tag.H1 {
            background-color: rgba(255, 77, 77, 0.2);
            color: #ff4d4d;
        }

        .hypothesis-tag.H2 {
            background-color: rgba(77, 255, 77, 0.2);
            color: #4dff4d;
        }

        .hypothesis-tag.H3 {
            background-color: rgba(77, 77, 255, 0.2);
            color: #4d4dff;
        }

        .hypothesis-tag.H4 {
            background-color: rgba(255, 255, 77, 0.2);
            color: #ffff4d;
        }

        .hypothesis-tag.H5 {
            background-color: rgba(255, 77, 255, 0.2);
            color: #ff4dff;
        }

        .log-context {
            font-style: italic;
            margin-bottom: 8px;
            color: var(--vscode-editor-foreground);
        }

        .log-data {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 8px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow-x: auto;
        }

        .timestamp {
            font-size: 11px;
            color: var(--vscode-editorLineNumber-foreground);
        }

        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-editorLineNumber-foreground);
        }

        .empty-state svg {
            width: 64px;
            height: 64px;
            margin-bottom: 16px;
            opacity: 0.5;
        }

        .test-section {
            margin-bottom: 16px;
            padding: 12px;
            background-color: var(--vscode-editor-selectionBackground);
            border-radius: 4px;
        }

        .test-section h3 {
            margin-top: 0;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 600;
        }

        .probe-code-input {
            width: 100%;
            min-height: 80px;
            padding: 8px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            resize: vertical;
            margin-bottom: 8px;
        }

        .test-controls {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .test-controls select {
            padding: 6px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-family: inherit;
            font-size: 12px;
        }
    </style>
  </head>
  <body>
    <div class="header">
        <h1>AI Debugger Dashboard</h1>
        <div>
            <button class="control-btn" onclick="sendTestLog()">Send Test Log</button>
            <button class="clear-btn" onclick="clearLogs()">Clear Logs</button>
        </div>
    </div>
    
    <div class="test-section">
        <h3>Test Probe Code</h3>
        <textarea id="probeCodeInput" class="probe-code-input" placeholder="Paste probe code here (e.g., try: import http.client, json, socket; conn = http.client.HTTPConnection(&quot;localhost&quot;, 51234); conn.sock = socket.create_connection((&quot;localhost&quot;, 51234), timeout=5.0); conn.request(&quot;POST&quot;, &quot;/&quot;, json.dumps({'hypothesisId': 'H1', 'message': 'test', 'state': {}}), {'Content-Type': 'application/json'}); conn.getresponse(); conn.close() except: pass"></textarea>
        <div class="test-controls">
            <select id="hypothesisSelect">
                <option value="H1">H1</option>
                <option value="H2">H2</option>
                <option value="H3">H3</option>
                <option value="H4">H4</option>
                <option value="H5">H5</option>
                <option value="TEST">TEST</option>
            </select>
            <button class="control-btn run-btn" onclick="testProbeCode()">Test Probe Code</button>
        </div>
    </div>
    
    <div class="logs-container" id="logsContainer">
        <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <p>Waiting for debug logs...</p>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const logsContainer = document.getElementById('logsContainer');
        let hasLogs = false;

        console.log('[Dashboard] Dashboard script loaded, vscode API:', !!vscode);

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            console.log('[Dashboard] Received message:', message.type || 'direct log', message);
            
            if (message.type === 'initialLogs') {
                if (Array.isArray(message.logs)) {
                    message.logs.forEach(log => {
                        // Handle both string format (legacy) and object format
                        if (typeof log === 'string') {
                            // Legacy format - parse string log
                            const hypothesisMatch = log.match(/Hypothesis: (H\d+)/);
                            const contextMatch = log.match(/Context: "([^"]+)"/);
                            const dataMatch = log.match(/Data: ({[^}]*})/);
                            if (hypothesisMatch && contextMatch) {
                                try {
                                    addLogEntry({
                                        hypothesisId: hypothesisMatch[1],
                                        context: contextMatch[1],
                                        data: dataMatch ? JSON.parse(dataMatch[1]) : {},
                                        timestamp: new Date().toISOString()
                                    });
                                } catch (e) {
                                    console.error('Error parsing legacy log:', e);
                                }
                            }
                        } else if (log && typeof log === 'object') {
                            // Object format - use directly
                            addLogEntry({
                                hypothesisId: log.hypothesisId || 'UNKNOWN',
                                context: log.context || '',
                                data: log.data || {},
                                timestamp: log.timestamp || new Date().toISOString()
                            });
                        }
                    });
                }
            } else if (message.type === 'clearLogs') {
                logsContainer.innerHTML = \`
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <p>Waiting for debug logs...</p>
                    </div>
                \`;
                hasLogs = false;
            } else if (message.type === 'runtimeLogs') {
                // Handle runtime logs from MCP tool
                if (message.logs && message.logs.logs) {
                    // Parse the logs from MCP response
                    try {
                        const parsedLogs = JSON.parse(message.logs.logs);
                        if (parsedLogs.logs && Array.isArray(parsedLogs.logs)) {
                            parsedLogs.logs.forEach(log => {
                                addLogEntry({
                                    hypothesisId: log.hypothesisId,
                                    context: log.context,
                                    data: log.data,
                                    timestamp: log.timestamp
                                });
                            });
                        } else {
                            // If logs format is different, try to add as single log
                            addLogEntry({
                                hypothesisId: 'SYSTEM',
                                context: 'Runtime Logs Response',
                                data: parsedLogs,
                                timestamp: new Date().toISOString()
                            });
                        }
                    } catch (e) {
                        // If parsing fails, add as single log entry
                        addLogEntry({
                            hypothesisId: 'SYSTEM',
                            context: 'Raw Runtime Logs',
                            data: message.logs,
                            timestamp: new Date().toISOString()
                        });
                    }
                } else {
                    // If no structured logs, add the raw response
                    addLogEntry({
                        hypothesisId: 'SYSTEM',
                        context: 'Runtime Logs Response',
                        data: message.logs,
                        timestamp: new Date().toISOString()
                    });
                }
                
                if (message.error) {
                    addLogEntry({
                        hypothesisId: 'ERROR',
                        context: 'Runtime Logs Error',
                        data: message.error,
                        timestamp: new Date().toISOString()
                    });
                }
            } else if (message.type === 'probeTestResult') {
                // Show probe test result
                addLogEntry({
                    hypothesisId: message.success ? 'TEST' : 'ERROR',
                    context: message.success ? 'Probe code test result' : 'Probe code test error',
                    data: {
                        success: message.success,
                        message: message.message,
                        probeCode: message.probeCode || ''
                    },
                    timestamp: new Date().toISOString()
                });
            } else if (message.type === 'testLogResult') {
                // Show test log result
                addLogEntry({
                    hypothesisId: message.success ? (message.log?.hypothesisId || 'TEST') : 'ERROR',
                    context: message.success ? 'Test log sent successfully' : 'Test log error',
                    data: {
                        success: message.success,
                        message: message.message,
                        log: message.log || {}
                    },
                    timestamp: new Date().toISOString()
                });
            } else if (message.hypothesisId !== undefined) {
                // New log entry
                addLogEntry({
                    hypothesisId: message.hypothesisId,
                    context: message.context,
                    data: message.data,
                    timestamp: message.timestamp
                });
            }
        });

        function addLogEntry(log) {
            console.log('[Dashboard] Adding log entry:', log.hypothesisId, log.context);
            
            // Remove empty state if first log
            if (!hasLogs) {
                logsContainer.innerHTML = '';
                hasLogs = true;
            }

            const entry = document.createElement('div');
            entry.className = 'log-entry ' + log.hypothesisId;

            const timestamp = new Date(log.timestamp).toLocaleTimeString();

            // Экранируем пользовательские данные для безопасности
            const safeHypothesisId = log.hypothesisId.replace(/[&<>"']/g, m => {
                const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'};
                return map[m];
            });
            const safeContext = log.context.replace(/[&<>"']/g, m => {
                const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'};
                return map[m];
            });
            const safeData = JSON.stringify(log.data, null, 2).replace(/[&<>"']/g, m => {
                const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'};
                return map[m];
            });
            
            entry.innerHTML = \`
                <div class="log-header">
                    <span class="hypothesis-tag \${safeHypothesisId}">\${safeHypothesisId}</span>
                    <span class="timestamp">\${timestamp}</span>
                </div>
                <div class="log-context">\${safeContext}</div>
                <div class="log-data">\${safeData}</div>
            \`;

            // Prepend to show newest first
            logsContainer.insertBefore(entry, logsContainer.firstChild);
        }

        function clearLogs() {
            console.log('[Dashboard] clearLogs called');
            try {
                vscode.postMessage({ command: 'clearLogs' });
                console.log('[Dashboard] clearLogs message sent');
            } catch (error) {
                console.error('[Dashboard] ERROR in clearLogs:', error);
            }
            logsContainer.innerHTML = \`
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    <p>Waiting for debug logs...</p>
                </div>
            \`;
            hasLogs = false;
        }

        function sendTestLog() {
            console.log('[Dashboard] sendTestLog called');
            try {
                const hypothesisSelect = document.getElementById('hypothesisSelect');
                console.log('[Dashboard] hypothesisSelect element:', !!hypothesisSelect);
                
                const hypothesisId = hypothesisSelect ? hypothesisSelect.value : 'TEST';
                console.log('[Dashboard] Sending test log with hypothesisId:', hypothesisId);
                
                const message = {
                    command: 'sendTestLog',
                    hypothesisId: hypothesisId,
                    context: 'Test log from dashboard',
                    data: { test: true, source: 'dashboard', timestamp: new Date().toISOString() }
                };
                console.log('[Dashboard] Posting message:', JSON.stringify(message));
                
                vscode.postMessage(message);
                console.log('[Dashboard] Message posted successfully');
            } catch (error) {
                console.error('[Dashboard] ERROR in sendTestLog:', error);
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error('[Dashboard] Error details:', errorMsg);
                // Show error in dashboard
                const logsContainer = document.getElementById('logsContainer');
                if (logsContainer) {
                    const errorDiv = document.createElement('div');
                    errorDiv.style.cssText = 'padding: 8px; background-color: var(--vscode-editorError-foreground); color: var(--vscode-editor-background); border-radius: 4px; margin-bottom: 8px;';
                    errorDiv.textContent = 'Error sending test log: ' + errorMsg;
                    logsContainer.insertBefore(errorDiv, logsContainer.firstChild);
                    setTimeout(() => errorDiv.remove(), 5000);
                }
            }
        }

        function testProbeCode() {
            console.log('[Dashboard] testProbeCode called');
            try {
                const probeCodeInput = document.getElementById('probeCodeInput');
                const hypothesisSelect = document.getElementById('hypothesisSelect');
                
                if (!probeCodeInput) {
                    console.error('[Dashboard] probeCodeInput not found');
                    return;
                }
                
                const probeCode = probeCodeInput.value;
                const hypothesisId = hypothesisSelect ? hypothesisSelect.value : 'TEST';
                
                console.log('[Dashboard] Probe code length:', probeCode.length, 'hypothesisId:', hypothesisId);
            
                if (!probeCode.trim()) {
                    console.warn('[Dashboard] Probe code is empty');
                    // Show message in dashboard instead of alert
                    const logsContainer = document.getElementById('logsContainer');
                    if (logsContainer) {
                        const errorMsg = document.createElement('div');
                        errorMsg.style.cssText = 'padding: 8px; background-color: var(--vscode-editorError-foreground); color: var(--vscode-editor-background); border-radius: 4px; margin-bottom: 8px;';
                        errorMsg.textContent = 'Please enter probe code to test';
                        logsContainer.insertBefore(errorMsg, logsContainer.firstChild);
                        setTimeout(() => errorMsg.remove(), 3000);
                    }
                    return;
                }
            
                // Send probe code to extension for testing
                const message = {
                    command: 'testProbeCode',
                    probeCode: probeCode,
                    hypothesisId: hypothesisId
                };
                
                console.log('[Dashboard] Posting probe test message:', JSON.stringify({ ...message, probeCode: probeCode.substring(0, 100) + '...' }));
                vscode.postMessage(message);
                console.log('[Dashboard] Probe test message posted');
            
                // Also try to execute Python probe code directly via HTTP (if it's a simple HTTP request)
                // This allows testing if the probe code actually sends data to server
                if (probeCode.includes('http.client') || probeCode.includes('requests') || probeCode.includes('urllib')) {
                    // Extract the HTTP request part and try to execute it
                    // For Python code, we can't execute it in browser, but we can show a message
                    console.log('[Dashboard] Python probe code detected. Extension will log it. Execute in your Python environment to test.');
                }
            } catch (error) {
                console.error('[Dashboard] ERROR in testProbeCode:', error);
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error('[Dashboard] Error details:', errorMsg);
                // Show error in dashboard
                const logsContainer = document.getElementById('logsContainer');
                if (logsContainer) {
                    const errorDiv = document.createElement('div');
                    errorDiv.style.cssText = 'padding: 8px; background-color: var(--vscode-editorError-foreground); color: var(--vscode-editor-background); border-radius: 4px; margin-bottom: 8px;';
                    errorDiv.textContent = 'Error testing probe code: ' + errorMsg;
                    logsContainer.insertBefore(errorDiv, logsContainer.firstChild);
                    setTimeout(() => errorDiv.remove(), 5000);
                }
            }
        }
    </script>
</body>
</html>`;
}

// Cleanup Functions
async function cleanupDebugCode() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('No workspace opened. Cannot cleanup.');
        return;
    }

    const progress = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Cleaning up AI debug code...',
        cancellable: false
    }, async (progress) => {
        try {
            progress.report({ increment: 10, message: 'Searching for debug markers...' });

            // Find all relevant files
            const files = await vscode.workspace.findFiles(
                '**/*.{ts,js,tsx,jsx}',
                '**/node_modules/**'
            );

            progress.report({ increment: 20, message: `Found ${files.length} files to check...` });

            const edit = new vscode.WorkspaceEdit();
            let filesModified = 0;
            let markersRemoved = 0;

            // Regular expression for AI_DEBUG_START ... AI_DEBUG_END blocks
            const debugMarkerRegex = /\/\/\s*AI_DEBUG_START[\s\S]*?AI_DEBUG_END/g;

            for (let i = 0; i < files.length; i++) {
                const fileUri = files[i];
                progress.report({
                    increment: (70 / files.length),
                    message: `Processing ${i + 1}/${files.length}...`
                });

                try {
                    const document = await vscode.workspace.openTextDocument(fileUri);
                    
                    // Save document first to ensure latest content
                    await document.save();
                    
                    const content = document.getText();
                    const newContent = content.replace(debugMarkerRegex, '');

                    if (newContent !== content) {
                        const fullRange = new vscode.Range(
                            document.positionAt(0),
                            document.positionAt(content.length)
                        );
                        edit.replace(fileUri, fullRange, newContent);
                        filesModified++;
                        // Count how many markers were removed
                        const matches = content.match(debugMarkerRegex);
                        markersRemoved += matches ? matches.length : 0;
                    }
                } catch (error) {
                    outputChannel.appendLine(`[CLEANUP] Error processing ${fileUri.path}: ${error}`);
                }
            }

            progress.report({ increment: 90, message: 'Applying changes...' });

            // Apply the workspace edit
            const success = await vscode.workspace.applyEdit(edit);

            if (success) {
                progress.report({ increment: 100, message: 'Cleaning config files...' });

                // Remove .ai_debug_config and .ai_debug_logs.json files from .rootrace directory
                const configPath = getRootraceFilePath('ai_debug_config');
                if (fs.existsSync(configPath)) {
                    fs.unlinkSync(configPath);
                    outputChannel.appendLine(`[CLEANUP] Removed .ai_debug_config`);
                }
                
                const logsPath = getRootraceFilePath('ai_debug_logs.json');
                if (fs.existsSync(logsPath)) {
                    fs.unlinkSync(logsPath);
                    outputChannel.appendLine(`[CLEANUP] Removed .ai_debug_logs.json`);
                }

                const message = `Cleanup complete! Modified ${filesModified} files, removed ${markersRemoved} debug markers.`;
                vscode.window.showInformationMessage(message);
                outputChannel.appendLine(`[CLEANUP] ${message}`);
            } else {
                vscode.window.showErrorMessage('Failed to apply cleanup changes.');
                outputChannel.appendLine('[CLEANUP] Failed to apply workspace edit.');
            }

        } catch (error) {
            const errorMessage = `Cleanup failed: ${error}`;
            vscode.window.showErrorMessage(errorMessage);
            outputChannel.appendLine(`[CLEANUP] ${errorMessage}`);
        }
    });
}

// Rate limiting для защиты от злоупотреблений
const rateLimitMap: Map<string, { count: number; resetTime: number }> = new Map();

/**
 * Получает настройки rate limiting из конфигурации VS Code
 * @returns Объект с настройками rate limiting
 */
function getRateLimitConfig(): { maxRequests: number; windowMs: number } {
    const config = vscode.workspace.getConfiguration('rooTrace');
    return {
        maxRequests: config.get<number>('rateLimitMaxRequests', RATE_LIMIT_CONFIG.DEFAULT_MAX_REQUESTS),
        windowMs: config.get<number>('rateLimitWindowMs', RATE_LIMIT_CONFIG.DEFAULT_WINDOW_MS)
    };
}

/**
 * Проверяет rate limit для указанного IP адреса
 * @param ip - IP адрес клиента
 * @returns true если запрос разрешен, false если превышен лимит
 */
function checkRateLimit(ip: string): boolean {
    const config = getRateLimitConfig();
    const now = Date.now();
    const limit = rateLimitMap.get(ip);
    
    if (!limit || now > limit.resetTime) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + config.windowMs });
        return true;
    }
    
    if (limit.count >= config.maxRequests) {
        return false;
    }
    
    limit.count++;
    return true;
}

function getClientIP(req: http.IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
}

/**
 * Получает порт сервера из конфигурации VS Code
 * @returns Порт сервера (по умолчанию 51234, 0 для случайного порта)
 */
function getServerPort(): number {
    const config = vscode.workspace.getConfiguration('rooTrace');
    return config.get<number>('serverPort', SERVER_CONFIG.DEFAULT_PORT);
}

async function startServer() {
    if (server) {
        outputChannel.appendLine('Debug sidecar server is already running.');
        return;
    }
    
    // Create HTTP server with CORS support
    server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
        const startTime = Date.now();
        
        // Rate limiting
        const clientIP = getClientIP(req);
        if (!checkRateLimit(clientIP)) {
            metricsCollector.recordError();
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: 'Rate limit exceeded' }));
            return;
        }
        
        // Add CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        // Handle preflight OPTIONS request
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        
        // Health check endpoint
        if (req.method === 'GET' && req.url === '/health') {
            try {
                const healthStatus = await metricsCollector.getHealthStatus(port, server !== null);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(healthStatus));
                metricsCollector.recordRequest(Date.now() - startTime);
            } catch (error) {
                handleError(error, 'Extension.startServer', { endpoint: '/health' });
                metricsCollector.recordError();
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Health check failed' }));
            }
            return;
        }
        
        // Log all incoming requests for debugging
        outputChannel.appendLine(`[HTTP SERVER] ${req.method} ${req.url} from ${req.socket.remoteAddress || 'unknown'}`);
        
        if (req.method === 'POST' && req.url === '/') {
            outputChannel.appendLine(`[HTTP SERVER] POST request received on /`);
            console.log(`[HTTP SERVER] POST request received on /`);
            let body = '';
            
            req.on('data', (chunk: Buffer | string) => {
                body += chunk.toString();
            });
            
            req.on('end', async () => {
                try {
                    outputChannel.appendLine(`[HTTP SERVER] Request body received: ${body.length} bytes`);
                    
                    const data = JSON.parse(body) as LogDataRequest;
                    outputChannel.appendLine(`[HTTP SERVER] Parsed JSON: hypothesisId=${data.hypothesisId}, message=${data.message}`);
                    
                    // Check if this is a hypothesis-driven debug request
                    if (data.hypothesisId && data.message) {
                        // Format as hypothesis-driven log entry
                        const context = data.message || 'Debug data received';
                        const state = data.state || {};
                        
                        // КРИТИЧЕСКИ ВАЖНО: Логируем в output channel для диагностики
                        outputChannel.appendLine(`[HTTP SERVER] Received log: hypothesisId=${data.hypothesisId}, message=${context}`);
                        console.log(`[HTTP SERVER] Received log: hypothesisId=${data.hypothesisId}, message=${context}`);
                        
                        await logToOutputChannel(data.hypothesisId, context, state);
                        
                        // Дополнительная диагностика: проверяем, что лог записался
                        const logsAfter = await sharedStorage.getLogs();
                        outputChannel.appendLine(`[HTTP SERVER] Logs count after write: ${logsAfter.length}`);
                        console.log(`[HTTP SERVER] Logs count after write: ${logsAfter.length}`);
                    } else {
                        // Legacy format - log as-is
                        logInfo('Received debug data (legacy format)', 'Extension.startServer', { data });
                    }
                    
                    // Send success response
                    // Special handling for SMOKE_TEST: return identifiable response
                    if (data.hypothesisId === 'SMOKE_TEST' || (data.message && data.message.includes('SMOKE_TEST'))) {
                        // Return identifiable response for smoke test verification
                        const smokeTestResponse = {
                            status: 'success',
                            message: 'SMOKE_TEST_VERIFIED',
                            received: true,
                            hypothesisId: data.hypothesisId || 'SMOKE_TEST',
                            timestamp: new Date().toISOString(),
                            serverInfo: {
                                port: port || 'unknown',
                                host: 'localhost',
                                rooTraceVersion: '1.0.0'
                            }
                        };
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(smokeTestResponse));
                        outputChannel.appendLine(`[HTTP SERVER] SMOKE_TEST verified - returned identifiable response`);
                        console.log(`[HTTP SERVER] SMOKE_TEST verified - returned identifiable response`);
                    } else {
                        // Regular log response
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'success', message: 'Data received' }));
                    }
                    metricsCollector.recordRequest(Date.now() - startTime);
                } catch (error) {
                    handleError(error, 'Extension.startServer', { endpoint: '/', action: 'parseJSON' });
                    metricsCollector.recordError();
                    
                    // Send error response
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
                }
            });
        } else if (req.method === 'GET' && req.url === '/logs') {
            // Return in-memory logs
            getInMemoryLogs().then(logs => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success', logs: logs }));
                metricsCollector.recordRequest(Date.now() - startTime);
            }).catch(error => {
                handleError(error, 'Extension.startServer', { endpoint: '/logs' });
                metricsCollector.recordError();
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Failed to get logs' }));
            });
        } else if (req.method === 'GET' && req.url?.startsWith('/diagnostics')) {
            // Diagnostics endpoint - returns VS Code diagnostics
            try {
                // Parse query parameters
                const url = new URL(req.url, `http://${req.headers.host}`);
                const filePath = url.searchParams.get('file');
                
                const diagnostics = getDiagnosticsForMCP(filePath || undefined);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'success',
                    diagnostics: diagnostics,
                    count: diagnostics.length
                }));
                metricsCollector.recordRequest(Date.now() - startTime);
            } catch (error) {
                handleError(error, 'Extension.startServer', { endpoint: '/diagnostics' });
                metricsCollector.recordError();
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Failed to get diagnostics' }));
            }
        } else {
            // Send 404 for other routes
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: 'Route not found' }));
            metricsCollector.recordRequest(Date.now() - startTime);
        }
    });
    
    // Get port from configuration (default: 51234)
    const configuredPort = getServerPort();
    const listenPort = configuredPort === 0 ? 0 : configuredPort; // 0 means random port
    
    // Try to listen on configured port, fallback to random if busy
    const tryListen = (attemptPort: number) => {
        server!.listen(attemptPort, 'localhost', () => {
            const address = server?.address();
            if (address && typeof address !== 'string') {
                port = address.port;
                const message = `Debug sidecar server started on port ${port}${attemptPort !== port ? ` (configured port ${attemptPort} was busy)` : ''}`;
                logInfo(message, 'Extension.startServer');
                outputChannel.appendLine(`[HTTP SERVER] ${message}`);
                outputChannel.appendLine(`[HTTP SERVER] Server listening on http://localhost:${port}/`);
                console.log(`[HTTP SERVER] Server started on port ${port}`);
                
                // Save port to file in workspace root (for backwards compatibility)
                if (port !== null) {
                    savePortToFile(port);
                    
                    // Create the AI debug config file
                    createAIDebugConfig();
                    
                    outputChannel.appendLine(`[HTTP SERVER] Port ${port} saved to .debug_port file`);
                    outputChannel.appendLine(`[HTTP SERVER] Config saved to .ai_debug_config with URL: http://localhost:${port}/`);
                }
            } else {
                handleWarning('Failed to get server address', 'Extension.startServer');
            }
        });
    };
    
    // Try configured port first, fallback to random if busy
    if (listenPort === 0) {
        // Random port
        tryListen(0);
    } else {
        // Try configured port first
        tryListen(listenPort);
    }
    
    server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && listenPort !== 0) {
            // Port is busy, try random port
            handleWarning(`Port ${listenPort} is busy, trying random port...`, 'Extension.startServer');
            tryListen(0);
        } else {
            handleError(err, 'Extension.startServer', { action: 'serverError' });
        }
    });
}

async function stopServer() {
    if (!server) {
        outputChannel.appendLine('Debug sidecar server is not running.');
        return;
    }
    
    server.close(() => {
        outputChannel.appendLine('Debug sidecar server stopped.');
        server = null;
        port = null;
        
        // Remove the port file
        removePortFile();
        
        // Remove the config file
        removeAIDebugConfig();
    });
}

function savePortToFile(port: number) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        outputChannel.appendLine('No workspace opened. Cannot save port file.');
        return;
    }
    
    // Убеждаемся, что .rootrace существует и добавлен в .gitignore
    ensureRootraceInGitignore();
    
    // Save port file to .rootrace directory
    const portFilePath = getRootraceFilePath('debug_port');
    try {
        fs.writeFileSync(portFilePath, port.toString(), 'utf8');
        outputChannel.appendLine(`Port ${port} saved to ${portFilePath}`);
    } catch (error) {
        outputChannel.appendLine(`Error saving port file: ${error}`);
    }
}

function removePortFile() {
    const portFilePath = getRootraceFilePath('debug_port');
    if (fs.existsSync(portFilePath)) {
        try {
            fs.unlinkSync(portFilePath);
            outputChannel.appendLine(`Removed port file: ${portFilePath}`);
        } catch (error) {
            outputChannel.appendLine(`Error removing port file: ${error}`);
        }
    }
}

// Updated function to remove AI debug config files
function removeAIDebugConfig() {
    const configPath = getRootraceFilePath('ai_debug_config');
    if (fs.existsSync(configPath)) {
        try {
            fs.unlinkSync(configPath);
            outputChannel.appendLine(`Removed config file: ${configPath}`);
        } catch (error) {
            outputChannel.appendLine(`Error removing config file: ${error}`);
        }
    }
}

export function deactivate() {
    console.error('[RooTrace] Extension DEACTIVATING...');
    // Graceful degradation: завершаем сессию если есть активная
    try {
        const sessionManager = SessionManager.getInstance();
        sessionManager.completeSession();
    } catch (error) {
        outputChannel.appendLine(`[DEACTIVATE] Error completing session: ${error}`);
    }

    // Закрываем WebSocket соединения
    wsClients.forEach(client => {
        try {
            if (client.readyState === 1) {
                client.close();
            }
        } catch (error) {
            outputChannel.appendLine(`[DEACTIVATE] Error closing WebSocket client: ${error}`);
        }
    });
    wsClients.clear();

    if (server) {
        server.close();
        server = null;
        port = null;
        
        // Remove the port file
        removePortFile();
        
        // Remove the config file
        removeAIDebugConfig();
    }
    
    // Unregister MCP server (graceful degradation - не падаем если ошибка)
    try {
        unregisterMcpServer();
    } catch (error) {
        outputChannel.appendLine(`[DEACTIVATE] Error unregistering MCP server: ${error}`);
    }
}
