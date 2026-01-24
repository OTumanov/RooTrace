/**
 * Утилиты для поиска файлов с маркерами RooTrace
 * 
 * Этот модуль предоставляет функции для рекурсивного поиска файлов,
 * содержащих маркеры RooTrace проб в коде.
 */

import * as path from 'path';
import * as fs from 'fs';
import { logDebug } from '../../error-handler';

/**
 * Рекурсивно находит все файлы с маркерами RooTrace в директории
 * 
 * Используется как fallback, если реестр проб и логи не содержат информации о файлах.
 * 
 * Особенности:
 * - Пропускает скрытые директории (начинающиеся с .)
 * - Пропускает node_modules, venv, __pycache__
 * - Ограничивает глубину поиска (по умолчанию 5 уровней)
 * - Проверяет только файлы с расширениями кода
 * - Ищет маркеры 'RooTrace [id:' или 'RooTrace[id:'
 * 
 * @param rootDir - Корневая директория для поиска
 * @param maxDepth - Максимальная глубина рекурсии (по умолчанию 5)
 * @param currentDepth - Текущая глубина (для внутреннего использования)
 * @returns Массив путей к файлам, содержащим маркеры RooTrace
 */
export async function findFilesWithProbes(
  rootDir: string,
  maxDepth: number = 5,
  currentDepth: number = 0
): Promise<string[]> {
  const filesWithProbes: string[] = [];
  
  if (currentDepth >= maxDepth) {
    return filesWithProbes;
  }
  
  try {
    const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
    
    for (const entry of entries) {
      // Пропускаем скрытые директории и node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'venv' || entry.name === '__pycache__') {
        continue;
      }
      
      const fullPath = path.join(rootDir, entry.name);
      
      try {
        if (entry.isDirectory()) {
          // Рекурсивно сканируем поддиректории
          const subFiles = await findFilesWithProbes(fullPath, maxDepth, currentDepth + 1);
          filesWithProbes.push(...subFiles);
        } else if (entry.isFile()) {
          // Проверяем только текстовые файлы с кодом
          const ext = path.extname(entry.name).toLowerCase();
          const codeExtensions = ['.js', '.ts', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.cs', '.php', '.rb', '.swift', '.kt'];
          
          if (codeExtensions.includes(ext)) {
            try {
              const content = await fs.promises.readFile(fullPath, 'utf8');
              // Быстрая проверка на наличие маркеров
              if (content.includes('RooTrace [id:') || content.includes('RooTrace[id:')) {
                filesWithProbes.push(fullPath);
              }
            } catch (readError) {
              // Игнорируем ошибки чтения (бинарные файлы, права доступа и т.д.)
              continue;
            }
          }
        }
      } catch (entryError) {
        // Игнорируем ошибки доступа к отдельным файлам/директориям
        continue;
      }
    }
  } catch (dirError) {
    // Игнорируем ошибки доступа к директории
    logDebug(`Error scanning directory ${rootDir}: ${dirError}`, 'RooTraceMCPHandler.findFilesWithProbes');
  }
  
  return filesWithProbes;
}
