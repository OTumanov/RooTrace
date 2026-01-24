/**
 * Обработчик инструмента show_user_instructions
 * 
 * Показывает пользователю инструкции с кнопками для следующих шагов отладки.
 * Используется после завершения инъекции проб, чтобы показать пользователю что делать дальше.
 * 
 * MCP-сервер не имеет доступа к VS Code UI. Поэтому пишем "UI event" в workspace,
 * а расширение (extension host) ловит изменение файла и показывает popup с кнопками.
 */

import * as fs from 'fs';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { HandlerContext } from './base-handler';

/**
 * Обрабатывает вызов инструмента show_user_instructions
 * 
 * @param args - Аргументы инструмента
 * @param context - Контекст с зависимостями
 * @returns Результат выполнения инструмента
 */
export async function handleShowUserInstructions(
  args: any,
  context: HandlerContext
): Promise<CallToolResult> {
  const { instructions, stepNumber } = args as { instructions: string; stepNumber?: number };
  
  if (!instructions || typeof instructions !== 'string') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: 'Missing or invalid instructions parameter (must be a non-empty string)',
          errorCode: 'MISSING_PARAMETERS'
        })
      }],
      isError: true
    };
  }

  // MCP-сервер не имеет доступа к VS Code UI. Поэтому пишем "UI event" в workspace,
  // а расширение (extension host) ловит изменение файла и показывает popup с кнопками.
  const stepNum = stepNumber || 1;
  const requestId = `ui_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const uiEvent = {
    type: 'show_user_instructions',
    requestId,
    stepNumber: stepNum,
    instructions,
    createdAt: new Date().toISOString()
  };

  const uiEventPath = context.getRootraceFilePath('ui.json');
  const uiResponsePath = context.getRootraceFilePath('ui-response.json');
  try {
    fs.writeFileSync(uiEventPath, JSON.stringify(uiEvent, null, 2), 'utf8');
  } catch (e) {
    // Если не удалось записать UI-event, деградируем в текстовый вывод
    const fallback = `## 📋 Шаг ${stepNum}: Инструкции по отладке\n\n${instructions}\n\n(Не удалось показать popup в VS Code: ${e instanceof Error ? e.message : String(e)})`;
    return {
      content: [{ type: 'text', text: fallback }]
    };
  }

  // Ждём, пока пользователь нажмёт кнопку в VS Code (через response-файл).
  // По запросу пользователя увеличиваем ожидание минимум до 2 минут.
  const maxWaitMs = 2 * 60 * 1000;
  const pollIntervalMs = 200;
  const startWait = Date.now();

  let choice: string | null = null;
  while (Date.now() - startWait < maxWaitMs) {
    try {
      if (fs.existsSync(uiResponsePath)) {
        const raw = fs.readFileSync(uiResponsePath, 'utf8');
        if (raw && raw.trim().length > 0) {
          const resp = JSON.parse(raw) as { requestId?: string; choice?: string | null };
          if (resp?.requestId === requestId) {
            choice = typeof resp.choice === 'string' ? resp.choice : null;
            break;
          }
        }
      }
    } catch {
      // игнорируем временные ошибки чтения/парсинга во время записи
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        message: choice
          ? 'User selected an option in VS Code popup.'
          : 'Timed out waiting for user click in VS Code popup (2 minutes).',
        requestId,
        choice,
        uiEventPath,
        uiResponsePath
      })
    }]
  };
}
