/**
 * Чтение конфигурации VS Code для code-injector
 */

import { getVSCode } from '../../utils/vscode-loader';

/**
 * Получает таймаут для проверки синтаксиса из конфигурации VS Code
 * @returns Таймаут в миллисекундах (по умолчанию 10000)
 */
export function getSyntaxCheckTimeout(): number {
  const vscode = getVSCode();
  if (!vscode) {
    return 10000; // Fallback если VS Code недоступен
  }
  
  try {
    const config = vscode.workspace.getConfiguration('rooTrace');
    const timeout = config.get<number>('syntaxCheckTimeout', 10000);
    return timeout > 0 ? timeout : 10000;
  } catch {
    return 10000;
  }
}

/**
 * Проверяет, включена ли валидация синтаксиса в конфигурации VS Code
 * @returns true если валидация включена (по умолчанию true)
 */
export function isSyntaxValidationEnabled(): boolean {
  const vscode = getVSCode();
  if (!vscode) {
    return true; // Fallback если VS Code недоступен
  }
  
  try {
    const config = vscode.workspace.getConfiguration('rooTrace');
    return config.get<boolean>('enableSyntaxValidation', true);
  } catch {
    return true;
  }
}
