/**
 * Утилиты для нормализации путей файлов и проверки типов файлов
 * 
 * Этот модуль предоставляет функции для работы с путями файлов,
 * включая нормализацию путей из Roo Code mentions и проверку типов файлов.
 */

import * as path from 'path';
import { normalizeFilePath as utilsNormalizeFilePath } from '../../utils';

/**
 * Нормализует путь файла, удаляя символ @ в начале
 * (формат @/path/to/file из Roo Code mentions)
 * 
 * Использует общую утилиту из utils/file-path-utils для единообразия.
 * 
 * @param filePath - Путь к файлу (может содержать @ в начале)
 * @returns Нормализованный путь без символа @
 */
export function normalizeFilePath(filePath: string): string {
  return utilsNormalizeFilePath(filePath);
}

/**
 * Проверяет, является ли файл Python файлом
 * 
 * Поддерживаемые расширения:
 * - .py - обычные Python файлы
 * - .pyw - Python скрипты для Windows
 * - .pyi - Python stub файлы (type hints)
 * 
 * @param filePath - Путь к файлу
 * @returns true, если файл является Python файлом
 */
export function isPythonFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.py' || ext === '.pyw' || ext === '.pyi';
}
