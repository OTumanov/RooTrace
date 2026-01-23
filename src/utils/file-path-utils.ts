/**
 * Утилиты для работы с путями файлов
 * 
 * Объединяет функциональность из:
 * - mcp-handler.ts: normalizeFilePath() - удаление @ в начале
 * - code-injector.ts: sanitizeFilePath() - валидация и защита от path traversal
 */

import * as path from 'path';
import { getWorkspaceRoot } from './workspace-utils';

/**
 * Нормализует путь файла, удаляя префикс @ если он есть
 * 
 * Roo Code использует формат @/path/to/file для mentions файлов.
 * Эта функция удаляет @ для получения обычного пути.
 * 
 * @param filePath Путь к файлу (может начинаться с @)
 * @returns Нормализованный путь без префикса @
 * 
 * @example
 * ```typescript
 * normalizeFilePath('@/src/app.ts') // '/src/app.ts'
 * normalizeFilePath('src/app.ts')   // 'src/app.ts'
 * ```
 */
export function normalizeFilePath(filePath: string): string {
  return filePath.startsWith('@') ? filePath.substring(1) : filePath;
}

/**
 * Валидирует и нормализует путь файла с защитой от path traversal
 * 
 * Проверяет, что путь находится внутри workspace root и не содержит
 * попыток выхода за его пределы (например, ../../../etc/passwd).
 * 
 * @param inputPath Путь к файлу (может быть относительным или абсолютным)
 * @param workspaceRoot Корень рабочей области (если не указан, определяется автоматически)
 * @returns Абсолютный нормализованный путь, если безопасен
 * @throws Error если путь невалиден или содержит path traversal
 * 
 * @example
 * ```typescript
 * // Валидный путь
 * sanitizeFilePath('src/app.ts') // '/workspace/src/app.ts'
 * 
 * // Невалидный путь (path traversal)
 * sanitizeFilePath('../../../etc/passwd') // throws Error
 * ```
 */
export function sanitizeFilePath(inputPath: string, workspaceRoot?: string): string {
  // Нормализуем путь (удаляем @ если есть)
  const normalized = normalizeFilePath(inputPath);
  
  // Определяем workspace root если не указан
  const root = workspaceRoot || getWorkspaceRoot();
  
  // Разрешаем путь относительно workspace root
  const resolved = path.resolve(root, normalized);
  const finalPath = path.normalize(resolved);
  
  // Проверяем, что путь находится внутри workspace root
  // Используем path.sep для кроссплатформенной совместимости
  const rootWithSep = root + path.sep;
  if (!finalPath.startsWith(rootWithSep) && finalPath !== root) {
    throw new Error(`Invalid file path: path traversal detected (${inputPath})`);
  }
  
  return finalPath;
}

/**
 * Проверяет, является ли путь безопасным (находится внутри workspace)
 * 
 * @param filePath Путь к файлу
 * @param workspaceRoot Корень рабочей области
 * @returns true если путь безопасен, false иначе
 */
export function isPathSafe(filePath: string, workspaceRoot?: string): boolean {
  try {
    sanitizeFilePath(filePath, workspaceRoot);
    return true;
  } catch {
    return false;
  }
}
