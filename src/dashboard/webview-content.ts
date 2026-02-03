/**
 * Генерация HTML контента для WebView dashboard
 */

/**
 * Generate a random nonce string for CSP
 */
function generateNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * Сгенерировать HTML контент для dashboard
 */
export function getWebviewContent(logs: string[] = []): string {
    const nonce = generateNonce();
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
        <textarea id="probeCodeInput" class="probe-code-input" placeholder="Paste probe code here (e.g., try: import http.client, json, socket; conn = http.client.HTTPConnection("localhost", 51234); conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0); conn.request("POST", "/", json.dumps({'hypothesisId': 'H1', 'message': 'test', 'state': {}}), {'Content-Type': 'application/json'}); conn.getresponse(); conn.close() except: pass)"></textarea>
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

    <script nonce="${nonce}">
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
                            const hypothesisMatch = log.match(/Hypothesis: (H\\\\d+)/);
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
                const map = {'&': '&', '<': '<', '>': '>', '"': '"', "'": '&#039;'};
                return map[m];
            });
            const safeContext = log.context.replace(/[&<>"']/g, m => {
                const map = {'&': '&', '<': '<', '>': '>', '"': '"', "'": '&#039;'};
                return map[m];
            });
            const safeData = JSON.stringify(log.data, null, 2).replace(/[&<>"']/g, m => {
                const map = {'&': '&', '<': '<', '>': '>', '"': '"', "'": '&#039;'};
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

/**
 * Экранировать HTML символы для безопасности
 */
export function escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
        '&': '&',
        '<': '<',
        '>': '>',
        '"': '"',
        "'": "&#039;"
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}