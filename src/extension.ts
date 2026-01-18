import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { registerMcpServer, unregisterMcpServer } from './mcp-registration';
import { startRooTraceMCP } from './mcp-handler';

let server: http.Server | null = null;
let port: number | null = null;
let outputChannel: vscode.OutputChannel;

// WebView Panel
let panel: vscode.WebviewPanel | undefined;

// In-memory log storage for quick access
let inMemoryLogs: string[] = [];

// Path to the persistent log file
const logFilePath = path.join(vscode.workspace.rootPath || '.', '.ai_debug_logs.json');

// Function to append log entries to the persistent file
async function appendLogToFile(hypothesisId: string, context: string, data: any) {
    try {
        // Create log entry object
        const logEntry = {
            hypothesisId,
            context,
            data,
            timestamp: new Date().toISOString()
        };

        // Read existing logs if file exists
        let existingLogs = [];
        if (fs.existsSync(logFilePath)) {
            const fileContent = fs.readFileSync(logFilePath, 'utf8');
            if (fileContent.trim()) {
                existingLogs = JSON.parse(fileContent);
            }
        }

        // Append new log entry
        existingLogs.push(logEntry);

        // Write updated logs back to file
        fs.writeFileSync(logFilePath, JSON.stringify(existingLogs, null, 2));
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
    outputChannel = vscode.window.createOutputChannel('AI Debugger');
    
    const startCommand = vscode.commands.registerCommand('rooTrace.startServer', async () => {
        await startServer();
    });
    
    const stopCommand = vscode.commands.registerCommand('rooTrace.stopServer', async () => {
        await stopServer();
    });
    
    const clearLogsCommand = vscode.commands.registerCommand('rooTrace.clearLogs', async () => {
        await clearLogs();
    });

    // WebView Dashboard command
    const openDashboardCommand = vscode.commands.registerCommand('ai-debugger.openDashboard', async () => {
        await openDashboard();
    });

    // Cleanup command
    const cleanupCommand = vscode.commands.registerCommand('ai-debugger.cleanup', async () => {
        await cleanupDebugCode();
    });
    
    // Start server automatically on activation and create config file
    await startServer();
    await createAIDebugConfig();
    
    // Register MCP server
    await registerMcpServer(context);
    
    // Start MCP server
    try {
      await startRooTraceMCP();
      outputChannel.appendLine('[MCP] RooTrace MCP Server started successfully');
    } catch (error) {
      outputChannel.appendLine(`[MCP] Failed to start RooTrace MCP Server: ${error}`);
    }
    
    context.subscriptions.push(
        startCommand,
        stopCommand,
        clearLogsCommand,
        openDashboardCommand,
        cleanupCommand
    );
}

async function createAIDebugConfig() {
    if (!vscode.workspace.rootPath || !port) {
        return;
    }
    
    if (!vscode.workspace.rootPath) {
        return;
    }
    const configPath = path.join(vscode.workspace.rootPath, '.ai_debug_config');
    const config: AIDebugConfig = {
        url: `http://localhost:${port}/`,
        status: "active",
        timestamp: Date.now()
    };
    
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        outputChannel.appendLine(`[SYSTEM] Created .ai_debug_config: ${JSON.stringify(config)}`);
    } catch (error) {
        outputChannel.appendLine(`[SYSTEM] Error creating .ai_debug_config: ${error}`);
    }
}

async function clearLogs() {
    inMemoryLogs = [];
    outputChannel.clear();
    outputChannel.appendLine('[SYSTEM] Logs cleared.');
    outputChannel.show(true);
    
    // Clear the persistent log file
    try {
        if (fs.existsSync(logFilePath)) {
            fs.writeFileSync(logFilePath, '[]', 'utf8');
        }
    } catch (error) {
        outputChannel.appendLine(`[SYSTEM] Error clearing persistent log file: ${error}`);
    }
}

function loadAIDebugConfig(): AIDebugConfig | null {
    if (!vscode.workspace.rootPath) {
        outputChannel.appendLine('[SYSTEM] No workspace opened. Cannot load .ai_debug_config.');
        return null;
    }
    
    if (!vscode.workspace.rootPath) {
        return null;
    }
    const configPath = path.join(vscode.workspace.rootPath, '.ai_debug_config');
    
    if (!fs.existsSync(configPath)) {
        outputChannel.appendLine('[SYSTEM] .ai_debug_config not found in workspace root.');
        return null;
    }
    
    try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config: AIDebugConfig = JSON.parse(configContent);
        return config;
    } catch (error) {
        outputChannel.appendLine(`[SYSTEM] Error reading .ai_debug_config: ${error}`);
        return null;
    }
}

function formatLogEntry(hypothesisId: string, context: string, data: any): string {
    const now = new Date();
    const time = now.toTimeString().split(' ')[0]; // HH:MM:SS format
    
    const lines: string[] = [];
    lines.push(`[LOG][Hypothesis: ${hypothesisId}][Time: ${time}]`);
    lines.push(`Context: "${context}"`);
    lines.push(`Data: ${JSON.stringify(data, null, 2)}`);
    lines.push('---');
    
    return lines.join('\n');
}

function logToOutputChannel(hypothesisId: string, context: string, data: any) {
    const logEntry = formatLogEntry(hypothesisId, context, data);
    
    // Store in memory
    inMemoryLogs.push(logEntry);
    
    // Output to channel
    outputChannel.appendLine(logEntry);
    outputChannel.show(true);

    // Send to WebView Dashboard if open
    if (panel) {
        const logData = {
            hypothesisId,
            context,
            data,
            timestamp: new Date().toISOString()
        };
        panel.webview.postMessage(logData);
    }
    
    // Append to persistent log file
    appendLogToFile(hypothesisId, context, data);
}

function getInMemoryLogs(): string[] {
    return [...inMemoryLogs];
}

// WebView Dashboard Functions
async function openDashboard() {
    try {
        if (panel) {
            panel.reveal(vscode.ViewColumn.Two);
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

        panel.onDidDispose(() => {
            panel = undefined;
        });

        // Send existing logs to dashboard
        const logs = getInMemoryLogs();
        panel.webview.postMessage({ type: 'initialLogs', logs });

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to open dashboard: ${error}`);
    }
}

function getWebviewContent(logs: any[]): string {
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
    </style>
</head>
<body>
    <div class="header">
        <h1>AI Debugger Dashboard</h1>
        <button class="clear-btn" onclick="clearLogs()">Clear Logs</button>
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
        const logsContainer = document.getElementById('logsContainer');
        let hasLogs = false;

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;

            if (message.type === 'initialLogs') {
                message.logs.forEach(log => {
                    addLogEntry(log);
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
            // Remove empty state if first log
            if (!hasLogs) {
                logsContainer.innerHTML = '';
                hasLogs = true;
            }

            const entry = document.createElement('div');
            entry.className = 'log-entry ' + log.hypothesisId;

            const timestamp = new Date(log.timestamp).toLocaleTimeString();

            entry.innerHTML = \`
                <div class="log-header">
                    <span class="hypothesis-tag \${log.hypothesisId}">\${log.hypothesisId}</span>
                    <span class="timestamp">\${timestamp}</span>
                </div>
                <div class="log-context">\${log.context}</div>
                <div class="log-data">\${JSON.stringify(log.data, null, 2)}</div>
            \`;

            // Prepend to show newest first
            logsContainer.insertBefore(entry, logsContainer.firstChild);
        }

        function clearLogs() {
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
    </script>
</body>
</html>`;
}

// Cleanup Functions
async function cleanupDebugCode() {
    if (!vscode.workspace.rootPath) {
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

                // Remove .ai_debug_config file
                if (vscode.workspace.rootPath) {
                    const configPath = path.join(vscode.workspace.rootPath, '.ai_debug_config');
                    if (fs.existsSync(configPath)) {
                        fs.unlinkSync(configPath);
                        outputChannel.appendLine('[CLEANUP] Removed .ai_debug_config');
                    }
                }
                
                // Remove .ai_debug_logs.json file
                if (vscode.workspace.rootPath) {
                    const logsPath = path.join(vscode.workspace.rootPath, '.ai_debug_logs.json');
                    if (fs.existsSync(logsPath)) {
                        fs.unlinkSync(logsPath);
                        outputChannel.appendLine('[CLEANUP] Removed .ai_debug_logs.json');
                    }
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

async function startServer() {
    if (server) {
        outputChannel.appendLine('Debug sidecar server is already running.');
        return;
    }
    
    // Create HTTP server with CORS support
    server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
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
        
        if (req.method === 'POST' && req.url === '/') {
            let body = '';
            
            req.on('data', (chunk: any) => {
                body += chunk.toString();
            });
            
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    
                    // Check if this is a hypothesis-driven debug request
                    if (data.hypothesisId && data.message) {
                        // Format as hypothesis-driven log entry
                        const context = data.message || 'Debug data received';
                        const state = data.state || {};
                        
                        logToOutputChannel(data.hypothesisId, context, state);
                    } else {
                        // Legacy format - log as-is
                        outputChannel.appendLine(`[${new Date().toISOString()}] Received debug data:`);
                        outputChannel.appendLine(JSON.stringify(data, null, 2));
                        outputChannel.show(true);
                    }
                    
                    // Send success response
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'success', message: 'Data received' }));
                } catch (error) {
                    outputChannel.appendLine(`[${new Date().toISOString()}] Error parsing JSON: ${error}`);
                    
                    // Send error response
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
                }
            });
        } else if (req.method === 'GET' && req.url === '/logs') {
            // Return in-memory logs
            const logs = getInMemoryLogs();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'success', logs: logs }));
        } else {
            // Send 404 for other routes
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: 'Route not found' }));
        }
    });
    
    // Listen on a random available port
    server.listen(0, 'localhost', () => {
        const address = server?.address();
        if (address && typeof address !== 'string') {
            port = address.port;
            outputChannel.appendLine(`Debug sidecar server started on port ${port}`);
            
            // Save port to file in workspace root
            if (port !== null) {
                savePortToFile(port);
                
                // Create the AI debug config file
                createAIDebugConfig();
            }
        } else {
            outputChannel.appendLine('Failed to get server address');
        }
    });
    
    server.on('error', (err: Error) => {
        outputChannel.appendLine(`Server error: ${err.message}`);
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
    if (!vscode.workspace.rootPath) {
        outputChannel.appendLine('No workspace opened. Cannot save port file.');
        return;
    }
    
    if (!vscode.workspace.rootPath) {
        outputChannel.appendLine('No workspace opened. Cannot save port file.');
        return;
    }
    const portFilePath = path.join(vscode.workspace.rootPath, '.debug_port');
    fs.writeFileSync(portFilePath, port.toString(), 'utf8');
    outputChannel.appendLine(`Port ${port} saved to ${portFilePath}`);
}

function removePortFile() {
    if (!vscode.workspace.rootPath) {
        return;
    }
    
    if (!vscode.workspace.rootPath) {
        return;
    }
    const portFilePath = path.join(vscode.workspace.rootPath, '.debug_port');
    if (fs.existsSync(portFilePath)) {
        fs.unlinkSync(portFilePath);
        outputChannel.appendLine(`Removed port file: ${portFilePath}`);
    }
}

function removeAIDebugConfig() {
    if (!vscode.workspace.rootPath) {
        return;
    }
    
    if (!vscode.workspace.rootPath) {
        return;
    }
    const configPath = path.join(vscode.workspace.rootPath, '.ai_debug_config');
    if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
        outputChannel.appendLine(`Removed config file: ${configPath}`);
    }
}

export function deactivate() {
    if (server) {
        server.close();
        server = null;
        port = null;
        
        // Remove the port file
        removePortFile();
        
        // Remove the config file
        removeAIDebugConfig();
    }
    
    // Unregister MCP server
    unregisterMcpServer();
}
