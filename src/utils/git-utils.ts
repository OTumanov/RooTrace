/**
 * Утилиты для работы с Git репозиториями
 */

import * as path from 'path';
import * as fs from 'fs';

/**
 * Находит корень Git репозитория, начиная с указанного пути
 * 
 * Поднимается вверх по директориям от указанного пути,
 * ищет директорию .git и возвращает путь к корню репозитория.
 * 
 * @param filePath Путь к файлу или директории (относительный или абсолютный)
 * @returns Путь к корню Git репозитория или null, если не найден
 * 
 * @example
 * ```typescript
 * const gitRoot = await findGitRoot('/workspace/src/app.ts');
 * // Возвращает: '/workspace' (если .git находится там)
 * ```
 */
export async function findGitRoot(filePath: string): Promise<string | null> {
  try {
    let currentPath = path.resolve(filePath);
    
    // Если путь существует и это файл, берем его директорию
    // Если путь не существует, предполагаем что это файл и берем директорию
    if (fs.existsSync(currentPath)) {
      if (!fs.statSync(currentPath).isDirectory()) {
        currentPath = path.dirname(currentPath);
      }
    } else {
      // Файл еще не существует, берем директорию из пути
      currentPath = path.dirname(currentPath);
    }

    const root = path.parse(currentPath).root;
    
    // Поднимаемся вверх по директориям, ища .git
    while (currentPath !== root) {
      const gitPath = path.join(currentPath, '.git');
      if (fs.existsSync(gitPath)) {
        return currentPath;
      }
      
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        break; // Достигли корня файловой системы
      }
      currentPath = parentPath;
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Синхронная версия findGitRoot
 * 
 * @param filePath Путь к файлу или директории
 * @returns Путь к корню Git репозитория или null
 */
export function findGitRootSync(filePath: string): string | null {
  try {
    let currentPath = path.resolve(filePath);
    
    if (fs.existsSync(currentPath)) {
      if (!fs.statSync(currentPath).isDirectory()) {
        currentPath = path.dirname(currentPath);
      }
    } else {
      currentPath = path.dirname(currentPath);
    }

    const root = path.parse(currentPath).root;
    
    while (currentPath !== root) {
      const gitPath = path.join(currentPath, '.git');
      if (fs.existsSync(gitPath)) {
        return currentPath;
      }
      
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        break;
      }
      currentPath = parentPath;
    }
    
    return null;
  } catch {
    return null;
  }
}
