/**
 * Обработчик инструмента get_debug_status
 * 
 * Возвращает статус сервера (активен/не активен), список активных гипотез
 * и текущую сессию. Используется для проверки состояния отладочной сессии.
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { HandlerContext } from './base-handler';
import { logDebug, handleError } from '../../error-handler';
import type { Hypothesis } from '../../types';

/**
 * Обрабатывает вызов инструмента get_debug_status
 * 
 * @param args - Аргументы инструмента
 * @param context - Контекст с зависимостями
 * @returns Результат выполнения инструмента
 */
export async function handleGetDebugStatus(
  args: any,
  context: HandlerContext
): Promise<CallToolResult> {
  const hypotheses = context.sharedStorage.getHypotheses();
  const activeHypotheses = hypotheses.filter((h: Hypothesis) => h.status === 'active');
  
  // КРИТИЧНО: Проверяем работоспособность сервера через тестовую запись/чтение
  let serverStatus: 'active' | 'inactive' | 'error' = 'inactive';
  let serverTestResult: string | null = null;
  
  try {
    // Получаем URL сервера
    const serverUrl = context.getServerUrl();
    if (!serverUrl) {
      serverStatus = 'error';
      serverTestResult = 'Server URL not found';
    } else {
      // Выполняем тестовую запись/чтение
      const testResult = await context.testServerWriteRead(serverUrl);
      if (testResult.success) {
        serverStatus = 'active';
        serverTestResult = 'Server verified: write/read test passed';
        logDebug('Server status check: write/read test passed', 'MCPHandler.get_debug_status');
      } else {
        serverStatus = 'error';
        serverTestResult = `Server test failed: ${testResult.error}`;
        logDebug(`Server status check failed: ${testResult.error}`, 'MCPHandler.get_debug_status');
      }
    }
  } catch (error) {
    serverStatus = 'error';
    serverTestResult = `Server test error: ${error instanceof Error ? error.message : String(error)}`;
    handleError(error, 'MCPHandler.get_debug_status', { action: 'server_test' });
  }
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        serverStatus,
        serverTestResult,
        activeHypotheses,
        currentSession: 'default-session',
        lastUpdated: new Date().toISOString(),
        uptime: Date.now() - context.startTime
      })
    }]
  };
}
