/**
 * Утилиты для работы с workspace (рабочей областью проекта)
 * 
 * Объединяет логику получения workspace root из разных модулей:
 * - code-injector.ts: getProjectRoot()
 * - mcp-handler.ts: getWorkspaceRootForFiles()
 * - rules-loader.ts: getWorkspaceRoot()
 * - rootrace-dir-utils.ts: логика внутри getRootraceDir()
 */

import { getVSCode } from './vscode-loader';

/**
 * Получает корень рабочей области проекта
 * 
 * Приоритеты:
 * 1. Переменная окружения ROO_TRACE_WORKSPACE или ROO_TRACE_WORKSPACE_ROOT (для MCP сервера)
 * 2. VS Code workspace (если доступен)
 * 3. Текущая рабочая директория (process.cwd())
 * 
 * @returns Абсолютный путь к корню рабочей области
 */
export function getWorkspaceRoot(): string {
  // Приоритет 1: переменная окружения (для MCP сервера)
  const envWorkspace = process.env.ROO_TRACE_WORKSPACE || process.env.ROO_TRACE_WORKSPACE_ROOT;
  if (envWorkspace && typeof envWorkspace === 'string' && envWorkspace.trim().length > 0) {
    return envWorkspace.trim();
  }
  
  // Приоритет 2: VS Code workspace
  const vscode = getVSCode();
  if (vscode) {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        return workspaceFolders[0].uri.fsPath;
      }
    } catch (e) {
      // Игнорируем ошибки при доступе к workspace в MCP контексте
    }
  }
  
  // Fallback: текущая рабочая директория
  return process.cwd();
}

/**
 * Получает корень рабочей области или null, если не удалось определить
 * 
 * Отличается от getWorkspaceRoot() тем, что может вернуть null
 * (для обратной совместимости с кодом, который ожидает null)
 * 
 * @returns Абсолютный путь к корню рабочей области или null
 */
export function getWorkspaceRootOrNull(): string | null {
  try {
    return getWorkspaceRoot();
  } catch (e) {
    return null;
  }
}
