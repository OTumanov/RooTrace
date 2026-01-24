/**
 * Обработчик инструмента get_problems
 * 
 * Получает диагностики (ошибки и предупреждения) из VS Code Problems panel
 * для автоматического обнаружения проблем в коде.
 * Можно указать конкретный файл или получить все диагностики workspace.
 */

import * as http from 'http';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { HandlerContext } from './base-handler';

/**
 * Обрабатывает вызов инструмента get_problems
 * 
 * @param args - Аргументы инструмента
 * @param context - Контекст с зависимостями
 * @returns Результат выполнения инструмента
 */
export async function handleGetProblems(
  args: any,
  context: HandlerContext
): Promise<CallToolResult> {
  const { filePath: rawFilePath } = args as { filePath?: string };
  
  // Нормализуем путь (удаляем @ в начале, если есть)
  const filePath = rawFilePath ? context.normalizeFilePath(rawFilePath) : rawFilePath;
  
  try {
    // Получаем URL сервера extension
    const serverUrl = context.getServerUrl();
    if (!serverUrl) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Server URL not found. Extension server may not be running.',
            errorCode: 'SERVER_NOT_FOUND'
          })
        }],
        isError: true
      };
    }

    // Формируем URL для запроса диагностик
    const url = new URL(serverUrl);
    url.pathname = '/diagnostics';
    if (filePath) {
      url.searchParams.set('file', filePath);
    }

    // Выполняем HTTP GET запрос
    const diagnostics = await new Promise<any>((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 51234,
        path: url.pathname + url.search,
        method: 'GET',
        timeout: 5000
      };

      const req = http.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk.toString();
        });

        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`Server returned status ${res.statusCode}: ${responseData}`));
              return;
            }
            const parsed = JSON.parse(responseData);
            resolve(parsed);
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          diagnostics: diagnostics.diagnostics || [],
          count: diagnostics.count || 0,
          filePath: filePath || 'all files'
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
          errorCode: 'DIAGNOSTICS_FETCH_FAILED'
        })
      }],
      isError: true
    };
  }
}
