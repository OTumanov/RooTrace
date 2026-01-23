/**
 * Утилита для условного импорта VS Code API
 * 
 * VS Code API доступен только в контексте расширения VS Code.
 * В MCP сервере (который запускается отдельно) vscode недоступен.
 * Этот модуль обеспечивает безопасный доступ к vscode с кэшированием.
 */

let vscodeInstance: typeof import('vscode') | undefined;
let vscodeChecked = false;

/**
 * Получает экземпляр VS Code API, если доступен
 * @returns VS Code API или undefined, если недоступен
 */
export function getVSCode(): typeof import('vscode') | undefined {
  // Кэшируем результат проверки, чтобы не делать require каждый раз
  if (vscodeChecked) {
    return vscodeInstance;
  }
  
  vscodeChecked = true;
  
  try {
    vscodeInstance = require('vscode');
  } catch (e) {
    // vscode недоступен (например, в MCP сервере) - это нормально
    vscodeInstance = undefined;
  }
  
  return vscodeInstance;
}

/**
 * Проверяет, доступен ли VS Code API
 * @returns true если VS Code API доступен, false иначе
 */
export function isVSCodeAvailable(): boolean {
  return getVSCode() !== undefined;
}
