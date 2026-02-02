/**
 * RooTrace Extension - Главная точка входа
 * 
 * Координирует активацию расширения, инициализирует HTTP сервер,
 * WebSocket обработчики, и интеграцию с MCP сервером.
 */

import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

// Core modules
import { registerMcpServer, unregisterMcpServer } from './mcp-registration';
import { RoleManager } from './role-manager';
import { SharedLogStorage, RuntimeLog } from './shared-log-storage';
import { SessionManager } from './session-manager';
import { LogExporter, ExportFormat } from './log-exporter';
import { initializeErrorHandler, handleError, logInfo, logDebug } from './error-handler';
import { metricsCollector } from './metrics';

// New modular components
import { createHTTPServer, startHTTPServer, stopHTTPServer } from './http-server/server';
import { setupWebSocketListeners, broadcastToClients, closeAllWebSockets } from './websocket/server';
import { createDashboardPanel, sendLogsToWebview, getWebviewContent } from './ui-bridge/panel';

// Utilities
import { getRootraceFilePath } from './rootrace-dir-utils';
import { parseArrayOrDecrypt } from './utils';
import { getDiagnosticsForMCP } from './diagnostics-handler';
import { LogData } from './types';

// Global state
let server: http.Server | null = null;
let port: number | null = null;
let outputChannel: vscode.OutputChannel;
const wsClients = new Set<any>();
let panel: vscode.WebviewPanel | undefined;

const sharedStorage = SharedLogStorage.getInstance();
let roleManager: RoleManager | null = null;
let sessionManager: SessionManager | null = null;

/**
 * Активация расширения
 */
export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('RooTrace');
  
  try {
    initializeErrorHandler(outputChannel);
    logInfo('RooTrace activation started', 'Extension.activate');
    
    // Инициализируем компоненты
    roleManager = new RoleManager(outputChannel);
    sessionManager = new SessionManager(outputChannel);
    
    // Загружаем начальные логи
    await sharedStorage.initialize();
    
    // Настраиваем WebSocket слушатели
    setupWebSocketListeners(sharedStorage, wsClients, {
      autoCleanupInactiveClients: true,
      outputChannel
    });
    
    // Стартуем HTTP сервер
    await startHTTPServerInternal();
    
    // Регистрируем команды VS Code
    registerCommands(context);
    
    // Регистрируем MCP сервер
    await registerMcpServer();
    
    outputChannel.appendLine('[RooTrace] Extension activated successfully');
    
  } catch (error) {
    handleError(error, 'Extension.activate');
    vscode.window.showErrorMessage(`RooTrace activation failed: ${error}`);
  }
}

/**
 * Деактивация расширения
 */
export async function deactivate(): Promise<void> {
  try {
    outputChannel.appendLine('[RooTrace] Deactivating extension...');
    
    // Очищаем WebSocket соединения
    closeAllWebSockets(wsClients, { outputChannel });
    
    // Останавливаем HTTP сервер
    await stopHTTPServer(server);
    server = null;
    port = null;
    
    // Закрываем WebView панель
    panel?.dispose();
    panel = undefined;
    
    // Очищаем shared storage
    sharedStorage?.dispose();
    
    // Завершаем сессию
    await sessionManager?.endSession();
    
    // Отрегистрируем MCP сервер
    await unregisterMcpServer();
    
    outputChannel.appendLine('[RooTrace] Deactivation complete');
    outputChannel.dispose();
  } catch (error) {
    handleError(error, 'Extension.deactivate');
  }
}

/**
 * Запуск HTTP сервера
 */
async function startHTTPServerInternal(): Promise<void> {
  if (server) {
    outputChannel.appendLine('[HTTP] Server already running');
    return;
  }
  
  // Создаём сервер
  server = createHTTPServer({
    onLog: async (hypothesisId: string, context: string, state: any) => {
      const log: RuntimeLog = {
        timestamp: new Date().toISOString(),
        hypothesisId,
        context,
        data: state || {}
      };
      await sharedStorage.addLog(log);
    },
    getLogsCount: async () => (await sharedStorage.getLogs()).length,
    getLogs: async () => {
      const logs = await sharedStorage.getLogs();
      return logs.map(l => JSON.stringify({
        hypothesisId: l.hypothesisId,
        context: l.context,
        data: l.data,
        timestamp: l.timestamp
      }));
    },
    outputChannel
  });
  
  // Запускаем на порту
  const configPort = vscode.workspace.getConfiguration('rooTrace').get<number>('serverPort', 51234);
  
  startHTTPServer(server, configPort, 
    (actualPort) => {
      port = actualPort;
      outputChannel.appendLine(`[HTTP] Server listening on http://localhost:${port}`);
      savePortToFile(actualPort);
    },
    (error) => {
      handleError(error, 'Extension.startHTTPServer');
    }
  );
}

/**
 * Сохранить порт в файл
 */
function savePortToFile(portNum: number): void {
  try {
    const portFilePath = getRootraceFilePath('.debug_port');
    const dir = path.dirname(portFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(portFilePath, portNum.toString(), 'utf8');
  } catch (error) {
    handleError(error, 'Extension.savePortToFile');
  }
}

/**
 * Регистрирует VS Code команды
 */
function registerCommands(context: vscode.ExtensionContext): void {
  // Command: Open Dashboard
  context.subscriptions.push(
    vscode.commands.registerCommand('rooTrace.openDashboard', async () => {
      try {
        if (panel) {
          panel.reveal(vscode.ViewColumn.Two);
        } else {
          panel = await createDashboardPanel(context, {
            getLogs: async () => sharedStorage.getLogs(),
            addLog: async (log) => sharedStorage.addLog(log),
            clearLogs: () => sharedStorage.clear(),
            outputChannel
          });
          
          panel.onDidDispose(() => {
            panel = undefined;
          });
        }
        
        // Send logs to webview
        setTimeout(async () => {
          await sendLogsToWebview(panel, async () => sharedStorage.getLogs(), outputChannel);
        }, 300);
        
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to open dashboard: ${error}`);
      }
    })
  );
  
  // Command: Clear Logs
  context.subscriptions.push(
    vscode.commands.registerCommand('rooTrace.clearLogs', async () => {
      sharedStorage.clear();
      vscode.window.showInformationMessage('Logs cleared');
    })
  );
  
  // Command: Export Logs
  context.subscriptions.push(
    vscode.commands.registerCommand('rooTrace.exportLogs', async () => {
      try {
        const exporter = new LogExporter();
        const logs = await sharedStorage.getLogs();
        
        const format = await vscode.window.showQuickPick(
          ['json', 'csv', 'markdown'],
          { placeHolder: 'Select export format' }
        );
        
        if (!format) return;
        
        const exported = exporter.export(logs, format as ExportFormat);
        
        const folder = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          title: 'Select export folder'
        });
        
        if (folder) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `rootrace-logs-${timestamp}.${format === 'markdown' ? 'md' : format}`;
          const filepath = path.join(folder[0].fsPath, filename);
          
          fs.writeFileSync(filepath, exported, 'utf8');
          vscode.window.showInformationMessage(`Logs exported to ${filepath}`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Export failed: ${error}`);
      }
    })
  );
  
  // Command: Show Server Status
  context.subscriptions.push(
    vscode.commands.registerCommand('rooTrace.showStatus', async () => {
      const status = {
        serverRunning: server !== null,
        port: port || 'not running',
        logsCount: (await sharedStorage.getLogs()).length,
        wsClientsCount: wsClients.size,
        timestamp: new Date().toISOString()
      };
      
      vscode.window.showInformationMessage(
        `RooTrace Status:\n${JSON.stringify(status, null, 2)}`
      );
    })
  );
}
