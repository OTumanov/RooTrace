/**
 * Обработчик инструмента read_runtime_logs
 * 
 * Получает логи отладочной сессии RooTrace для анализа выполнения кода с пробами.
 * Требует явного одобрения пользователя через кнопку на дашборде (безопасность).
 */

/**
 * Обработчик инструмента read_runtime_logs
 * 
 * Получает логи отладочной сессии RooTrace для анализа выполнения кода с пробами.
 * Требует явного одобрения пользователя через кнопку на дашборде (безопасность).
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { HandlerContext } from './base-handler';
import { checkReadRuntimeLogsApproval } from '../security';

/**
 * Обрабатывает вызов инструмента read_runtime_logs
 * 
 * @param args - Аргументы инструмента
 * @param context - Контекст с зависимостями
 * @returns Результат выполнения инструмента
 */
export async function handleReadRuntimeLogs(
  args: any,
  context: HandlerContext
): Promise<CallToolResult> {
  const { sessionId } = args as { sessionId?: string };
  
  // Проверяем, является ли запрос queued сообщением (неявное одобрение)
  const queued = (args as any).__queued === true;
  
  if (!queued) {
    const approval = checkReadRuntimeLogsApproval(context.getRootraceFilePath);
    if (!approval.allowed) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            errorCode: 'FORBIDDEN_USER_ACTION_REQUIRED',
            error: 'FORBIDDEN: read_runtime_logs must be triggered by the USER via button (dashboard/popup).',
            reason: approval.reason || 'not approved',
            requiredAction: 'Click the "Read logs" / "Logs ready" button in VS Code UI.'
          })
        }],
        isError: true
      };
    }
  }
  
  // Принудительно перезагружаем логи из файла перед чтением (для синхронизации с HTTP сервера)
  await context.sharedStorage.reloadLogsFromFile();
  const logs = await context.sharedStorage.getLogs();
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        logs,
        count: logs.length,
        sessionId: sessionId || 'current',
        queued: queued // возвращаем признак queued для отладки
      })
    }]
  };
}
