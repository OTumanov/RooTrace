/**
 * Обработчик инструмента load_rule
 * 
 * Загружает конкретное правило из .roo/roo-trace-rules/ для lazy loading модулей инструкций.
 * Используется для загрузки модулей по требованию, когда нужны дополнительные инструкции.
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { HandlerContext } from './base-handler';

/**
 * Обрабатывает вызов инструмента load_rule
 * 
 * @param args - Аргументы инструмента
 * @param context - Контекст с зависимостями
 * @returns Результат выполнения инструмента
 */
export async function handleLoadRule(
  args: any,
  context: HandlerContext
): Promise<CallToolResult> {
  const { rulePath } = args as { rulePath: string };
  
  try {
    if (!rulePath) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'rulePath is required',
            errorCode: 'MISSING_RULE_PATH'
          })
        }],
        isError: true
      };
    }

    // Загружаем правило
    const content = await context.loadRule(rulePath);
    
    if (content === null) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Rule file not found or empty: ${rulePath}`,
            errorCode: 'RULE_NOT_FOUND'
          })
        }],
        isError: true
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          rulePath: rulePath,
          content: content
        })
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          errorCode: 'LOAD_RULE_FAILED',
          rulePath: rulePath
        })
      }],
      isError: true
    };
  }
}
