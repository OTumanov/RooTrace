// Экспорт логов в различные форматы

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SharedLogStorage, RuntimeLog } from './shared-log-storage';
import { SessionManager } from './session-manager';

// Simple in‑memory lock to serialize file operations per file and avoid race conditions
const fileOperationLocks: Map<string, Promise<void>> = new Map();

export type ExportFormat = 'json' | 'csv' | 'markdown' | 'html' | 'excel';

export interface ExportOptions {
  format: ExportFormat;
  includeMetadata?: boolean;
  filterByHypothesis?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
}

/**
 * Класс для экспорта логов в различные форматы
 */
export class LogExporter {
  /**
   * Экспортирует логи в указанном формате
   */
  static async exportLogs(options: ExportOptions): Promise<string> {
    const sharedStorage = SharedLogStorage.getInstance();
    const logsResult = sharedStorage.getLogs();
    // getLogs() может вернуть Promise или массив напрямую, нормализуем к Promise
    let logs: RuntimeLog[] = await Promise.resolve(logsResult);

    // Применяем фильтры
    if (options.filterByHypothesis && options.filterByHypothesis.length > 0) {
      logs = logs.filter((log: RuntimeLog) => options.filterByHypothesis!.includes(log.hypothesisId));
    }

    if (options.dateRange) {
      logs = logs.filter((log: RuntimeLog) => {
        const logDate = new Date(log.timestamp);
        return logDate >= options.dateRange!.start && logDate <= options.dateRange!.end;
      });
    }

    switch (options.format) {
      case 'json':
        return this.exportToJSON(logs, options);
      case 'csv':
        return this.exportToCSV(logs, options);
      case 'markdown':
        return this.exportToMarkdown(logs, options);
      case 'html':
        return this.exportToHTML(logs, options);
      case 'excel':
        return this.exportToExcel(logs, options);
      default:
        throw new Error(`Unsupported export format: ${options.format}`);
    }
  }

  /**
   * Экспорт в JSON
   */
  private static exportToJSON(logs: RuntimeLog[], options: ExportOptions): string {
    const data: any = {
      logs,
      exportedAt: new Date().toISOString(),
      totalCount: logs.length
    };

    if (options.includeMetadata) {
      const sessionManager = SessionManager.getInstance();
      data.metadata = {
        currentSession: sessionManager.getCurrentSession(),
        totalSessions: sessionManager.getAllSessions().length
      };
    }

    return JSON.stringify(data, null, 2);
  }

  /**
   * Экспорт в CSV
   */
  private static exportToCSV(logs: RuntimeLog[], options: ExportOptions): string {
    const headers = ['Timestamp', 'Hypothesis ID', 'Context', 'Data'];
    const rows: string[] = [headers.join(',')];

    logs.forEach(log => {
      const dataStr = typeof log.data === 'string' 
        ? `"${log.data.replace(/"/g, '""')}"` 
        : `"${JSON.stringify(log.data).replace(/"/g, '""')}"`;
      const contextStr = `"${log.context.replace(/"/g, '""')}"`;
      rows.push([
        log.timestamp,
        log.hypothesisId,
        contextStr,
        dataStr
      ].join(','));
    });

    return rows.join('\n');
  }

  /**
   * Экспорт в Markdown
   */
  private static exportToMarkdown(logs: RuntimeLog[], options: ExportOptions): string {
    let markdown = '# RooTrace Debug Logs\n\n';
    
    if (options.includeMetadata) {
      markdown += `**Exported:** ${new Date().toISOString()}\n`;
      markdown += `**Total Logs:** ${logs.length}\n\n`;
    }

    markdown += '## Logs\n\n';
    markdown += '| Timestamp | Hypothesis | Context | Data |\n';
    markdown += '|-----------|------------|---------|------|\n';

    logs.forEach(log => {
      const dataStr = typeof log.data === 'string' 
        ? log.data 
        : '```json\n' + JSON.stringify(log.data, null, 2) + '\n```';
      markdown += `| ${log.timestamp} | ${log.hypothesisId} | ${log.context} | ${dataStr.replace(/\|/g, '\\|')} |\n`;
    });

    return markdown;
  }

  /**
   * Экспорт в HTML
   */
  private static exportToHTML(logs: RuntimeLog[], options: ExportOptions): string {
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RooTrace Debug Logs</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #4CAF50; color: white; }
        tr:hover { background-color: #f5f5f5; }
        .hypothesis { font-weight: bold; color: #2196F3; }
        .data { font-family: monospace; font-size: 12px; max-width: 400px; overflow-x: auto; }
        pre { margin: 0; white-space: pre-wrap; }
    </style>
</head>
<body>
    <div class="header">
        <h1>RooTrace Debug Logs</h1>`;

    if (options.includeMetadata) {
      html += `
        <p><strong>Exported:</strong> ${new Date().toISOString()}</p>
        <p><strong>Total Logs:</strong> ${logs.length}</p>`;
    }

    html += `
    </div>
    <table>
        <thead>
            <tr>
                <th>Timestamp</th>
                <th>Hypothesis</th>
                <th>Context</th>
                <th>Data</th>
            </tr>
        </thead>
        <tbody>`;

    logs.forEach(log => {
      const dataStr = typeof log.data === 'string' 
        ? log.data 
        : JSON.stringify(log.data, null, 2);
      const escapedData = this.escapeHtml(dataStr);
      html += `
            <tr>
                <td>${log.timestamp}</td>
                <td class="hypothesis">${log.hypothesisId}</td>
                <td>${this.escapeHtml(log.context)}</td>
                <td class="data"><pre>${escapedData}</pre></td>
            </tr>`;
    });

    html += `
        </tbody>
    </table>
</body>
</html>`;

    return html;
  }

  /**
   * Экспорт в Excel (CSV формат для Excel)
   */
  private static exportToExcel(logs: RuntimeLog[], options: ExportOptions): string {
    // Excel может открывать CSV файлы, поэтому используем CSV формат
    return this.exportToCSV(logs, options);
  }

  /**
   * Экранирует HTML символы
   */
  private static escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Сохраняет экспортированные логи в файл
   */
  static async saveToFile(content: string, format: ExportFormat, filename?: string): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath = workspaceFolders && workspaceFolders.length > 0
      ? workspaceFolders[0].uri.fsPath
      : '.';

    const extension = format === 'html' ? 'html' : format === 'csv' || format === 'excel' ? 'csv' : format === 'markdown' ? 'md' : 'json';
    const defaultFilename = `roo-trace-logs-${Date.now()}.${extension}`;
    const filePath = path.join(workspacePath, filename || defaultFilename);

    // Acquire lock for the file to prevent concurrent modifications
    const previousLock = fileOperationLocks.get(filePath) || Promise.resolve();
    let releaseLock: () => void;
    const currentLock = new Promise<void>((res) => (releaseLock = res));
    fileOperationLocks.set(filePath, previousLock.then(() => currentLock));

    try {
      await fs.promises.writeFile(filePath, content, 'utf8');
    } finally {
      // Release the lock
      releaseLock!();
    }

    return filePath;
  }
}
