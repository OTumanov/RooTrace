/**
 * Обработчик инструмента clear_logs
 * 
 * Очищает ТОЛЬКО логи (без удаления проб/гипотез).
 * Аналог кнопки очистки логов на дашборде.
 * Не изменяет файлы, только очищает внутреннее хранилище логов.
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { HandlerContext } from './base-handler';

/**
 * Обрабатывает вызов инструмента clear_logs
 * 
 * @param args - Аргументы инструмента
 * @param context - Контекст с зависимостями
 * @returns Результат выполнения инструмента
 */
export async function handleClearLogs(
  args: any,
  context: HandlerContext
): Promise<CallToolResult> {
  try {
    await context.sharedStorage.clear();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Logs cleared.',
          clearedAt: new Date().toISOString()
        })
      }]
    };
  } catch (e) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          errorCode: 'CLEAR_LOGS_FAILED',
          error: e instanceof Error ? e.message : String(e)
        })
      }],
      isError: true
    };
  }
}
