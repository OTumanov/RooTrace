/**
 * Diagnostics Handler - интеграция с VS Code Problems panel
 * 
 * Предоставляет доступ к диагностикам (ошибки, предупреждения) из VS Code
 * через MCP tool для автоматического исправления ошибок.
 */

import * as vscode from 'vscode';
import { logDebug, logInfo } from './error-handler';

/**
 * Уровень серьезности диагностики
 */
export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3
}

/**
 * Диагностика из VS Code
 */
export interface DiagnosticInfo {
  file: string;
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
  code?: string | number;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

/**
 * Результат получения диагностик
 */
export interface DiagnosticsResult {
  errors: DiagnosticInfo[];
  warnings: DiagnosticInfo[];
  total: number;
  files: string[];
}

/**
 * Получить все диагностики workspace
 * 
 * @param severityFilter - фильтр по уровню серьезности (по умолчанию Error и Warning)
 * @returns Результат с ошибками и предупреждениями
 */
export function getWorkspaceDiagnostics(
  severityFilter: DiagnosticSeverity[] = [DiagnosticSeverity.Error, DiagnosticSeverity.Warning]
): DiagnosticsResult {
  try {
    logDebug('Getting workspace diagnostics', 'DiagnosticsHandler.getWorkspaceDiagnostics');
    
    const errors: DiagnosticInfo[] = [];
    const warnings: DiagnosticInfo[] = [];
    const filesSet = new Set<string>();

    // Получаем все диагностики из всех документов
    const allDiagnostics = vscode.languages.getDiagnostics();

    for (const [uri, diagnostics] of allDiagnostics) {
      const filePath = uri.fsPath;
      filesSet.add(filePath);

      for (const diagnostic of diagnostics) {
        // Фильтруем по уровню серьезности
        if (!severityFilter.includes(diagnostic.severity)) {
          continue;
        }

        const diagnosticInfo: DiagnosticInfo = {
          file: filePath,
          severity: diagnostic.severity,
          message: diagnostic.message,
          source: diagnostic.source,
          code: typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code,
          range: {
            start: {
              line: diagnostic.range.start.line,
              character: diagnostic.range.start.character
            },
            end: {
              line: diagnostic.range.end.line,
              character: diagnostic.range.end.character
            }
          }
        };

        if (diagnostic.severity === DiagnosticSeverity.Error) {
          errors.push(diagnosticInfo);
        } else if (diagnostic.severity === DiagnosticSeverity.Warning) {
          warnings.push(diagnosticInfo);
        }
      }
    }

    const result: DiagnosticsResult = {
      errors,
      warnings,
      total: errors.length + warnings.length,
      files: Array.from(filesSet)
    };

    logInfo(
      `Found ${result.total} diagnostics (${errors.length} errors, ${warnings.length} warnings) in ${result.files.length} files`,
      'DiagnosticsHandler.getWorkspaceDiagnostics'
    );

    return result;
  } catch (error) {
    logDebug(`Error getting diagnostics: ${error}`, 'DiagnosticsHandler.getWorkspaceDiagnostics');
    return {
      errors: [],
      warnings: [],
      total: 0,
      files: []
    };
  }
}

/**
 * Получить диагностики для конкретного файла
 * 
 * @param filePath - путь к файлу
 * @param severityFilter - фильтр по уровню серьезности
 * @returns Массив диагностик для файла
 */
export function getFileDiagnostics(
  filePath: string,
  severityFilter: DiagnosticSeverity[] = [DiagnosticSeverity.Error, DiagnosticSeverity.Warning]
): DiagnosticInfo[] {
  try {
    logDebug(`Getting diagnostics for file: ${filePath}`, 'DiagnosticsHandler.getFileDiagnostics');

    const uri = vscode.Uri.file(filePath);
    const diagnostics = vscode.languages.getDiagnostics(uri);
    const result: DiagnosticInfo[] = [];

    for (const diagnostic of diagnostics) {
      if (!severityFilter.includes(diagnostic.severity)) {
        continue;
      }

      result.push({
        file: filePath,
        severity: diagnostic.severity,
        message: diagnostic.message,
        source: diagnostic.source,
        code: typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code,
        range: {
          start: {
            line: diagnostic.range.start.line,
            character: diagnostic.range.start.character
          },
          end: {
            line: diagnostic.range.end.line,
            character: diagnostic.range.end.character
          }
        }
      });
    }

    return result;
  } catch (error) {
    logDebug(`Error getting file diagnostics: ${error}`, 'DiagnosticsHandler.getFileDiagnostics');
    return [];
  }
}

/**
 * Получить диагностики в формате для MCP tool
 * 
 * @param filePath - опциональный путь к файлу (если не указан, возвращаются все)
 * @returns Массив диагностик в упрощенном формате
 */
export function getDiagnosticsForMCP(filePath?: string): DiagnosticInfo[] {
  if (filePath) {
    return getFileDiagnostics(filePath);
  } else {
    const result = getWorkspaceDiagnostics();
    return [...result.errors, ...result.warnings];
  }
}
