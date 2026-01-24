/**
 * Обработчик инструмента read_file
 * 
 * Читает один или несколько файлов параллельно для анализа кода.
 * Поддерживает чтение до 100 файлов за один запрос.
 * Можно указать либо path (один файл), либо paths (массив файлов).
 * Опционально можно указать startLine и endLine для чтения диапазона строк (только для одного файла).
 */

import * as path from 'path';
import * as fs from 'fs';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { HandlerContext } from './base-handler';

/**
 * Обрабатывает вызов инструмента read_file
 * 
 * @param args - Аргументы инструмента
 * @param context - Контекст с зависимостями
 * @returns Результат выполнения инструмента
 */
export async function handleReadFile(
  args: any,
  context: HandlerContext
): Promise<CallToolResult> {
  const { path: singlePath, paths, startLine, endLine, limit } = args as {
    path?: string;
    paths?: string[];
    startLine?: number;
    endLine?: number;
    limit?: number;
  };

  // Нормализуем пути: удаляем символ @ в начале, если он есть (формат @/path/to/file из Roo Code mentions)
  const normalizePath = (p: string): string => {
    return p.startsWith('@') ? p.substring(1) : p;
  };

  // Определяем список файлов для чтения
  let fileList: string[] = [];
  const maxLimit = limit ? Math.min(limit, 100) : 100; // максимальный лимит 100 файлов

  if (paths && Array.isArray(paths)) {
    fileList = paths.slice(0, maxLimit).map(normalizePath);
  } else if (singlePath && typeof singlePath === 'string') {
    fileList = [normalizePath(singlePath)];
  } else {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: 'Missing or invalid parameters: either "path" (string) or "paths" (array) must be provided',
          errorCode: 'MISSING_PARAMETERS'
        })
      }],
      isError: true
    };
  }

  // Если передан только один файл и указаны startLine/endLine, применяем диапазон
  const useRange = fileList.length === 1 && (startLine !== undefined || endLine !== undefined);
  const rangeStart = startLine !== undefined ? Math.max(1, startLine) : 1;
  const rangeEnd = endLine !== undefined ? Math.max(rangeStart, endLine) : Infinity;

  try {
    // Чтение файлов параллельно
    const readPromises = fileList.map(async (filePath) => {
      try {
        const absolutePath = path.resolve(filePath);
        const content = await fs.promises.readFile(absolutePath, 'utf-8');
        
        // Применяем диапазон строк, если нужно
        if (useRange) {
          const lines = content.split('\n');
          const start = rangeStart - 1;
          const end = rangeEnd === Infinity ? lines.length : Math.min(rangeEnd, lines.length);
          if (start >= lines.length || start < 0 || end <= start) {
            return {
              path: filePath,
              content: '',
              error: `Invalid line range: start=${rangeStart}, end=${rangeEnd}, file lines=${lines.length}`
            };
          }
          const slicedLines = lines.slice(start, end);
          return {
            path: filePath,
            content: slicedLines.join('\n'),
            lineRange: { start: rangeStart, end: rangeEnd }
          };
        }
        
        return { path: filePath, content };
      } catch (err) {
        return {
          path: filePath,
          content: '',
          error: err instanceof Error ? err.message : String(err)
        };
      }
    });

    const results = await Promise.all(readPromises);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          files: results,
          count: results.length,
          lineRange: useRange ? { start: rangeStart, end: rangeEnd } : undefined
        })
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `Failed to read files: ${error instanceof Error ? error.message : String(error)}`,
          errorCode: 'READ_FILE_FAILED'
        })
      }],
      isError: true
    };
  }
}
