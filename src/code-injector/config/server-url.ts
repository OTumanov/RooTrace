/**
 * Утилиты для получения URL сервера RooTrace
 */

import * as path from 'path';
import * as fs from 'fs';
import { getWorkspaceRoot } from '../../utils';
import { parseConfigOrDecrypt } from '../../utils';
import { findGitRootSync } from '../../utils';

/**
 * Находит workspace root от указанного файла
 * 
 * Поднимается вверх по директориям, ищет маркерные файлы:
 * - .rootrace/ai_debug_config или .ai_debug_config
 * - .rootrace/debug_port или .debug_port
 * - .git
 * - .roo
 * 
 * Отличие от getWorkspaceRoot() из utils/workspace-utils.ts:
 * - getWorkspaceRoot() использует VS Code API или переменные окружения
 * - findWorkspaceRoot() ищет workspace root от конкретного файла по маркерным файлам
 * 
 * Это нужно для случаев, когда файл находится вне текущего workspace,
 * но нужно найти workspace root, где находится конфигурация RooTrace.
 */
function findWorkspaceRoot(filePath: string): string | null {
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
    
    // Поднимаемся вверх по директориям, ища маркерные файлы
    let searchPath = currentPath;
    const root = path.parse(searchPath).root;
    
    while (searchPath !== root) {
      // Проверяем наличие маркерных файлов (в .rootrace или старые в корне)
      const rootraceDir = path.join(searchPath, '.rootrace');
      const hasConfigInRootrace = fs.existsSync(path.join(rootraceDir, 'ai_debug_config'));
      const hasPortInRootrace = fs.existsSync(path.join(rootraceDir, 'debug_port'));
      const hasConfig = fs.existsSync(path.join(searchPath, '.ai_debug_config'));
      const hasPort = fs.existsSync(path.join(searchPath, '.debug_port'));
      const hasGit = fs.existsSync(path.join(searchPath, '.git'));
      const hasRoo = fs.existsSync(path.join(searchPath, '.roo'));
      
      if (hasConfigInRootrace || hasPortInRootrace || hasConfig || hasPort || hasGit || hasRoo) {
        return searchPath;
      }
      
      // Поднимаемся на уровень выше
      const parentPath = path.dirname(searchPath);
      if (parentPath === searchPath) {
        break; // Достигли корня файловой системы
      }
      searchPath = parentPath;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Получает URL сервера RooTrace из конфигурации
 * 
 * Ищет конфигурацию в следующем порядке:
 * 1. Файл `.rootrace/ai_debug_config` или `.ai_debug_config` (старый путь)
 * 2. Файл `.rootrace/debug_port` или `.debug_port` (старый путь)
 * 3. Fallback на стандартный порт 51234
 * 
 * @param workspacePath Опциональный путь к workspace root
 * @param filePath Опциональный путь к файлу (для поиска workspace root от файла)
 * @returns URL сервера или null, если не найден
 */
export function getServerUrl(workspacePath?: string, filePath?: string): string | null {
  try {
    // Определяем базовый путь для поиска конфига
    let basePath: string | null = null;
    
    // 1. Используем переданный workspacePath, если есть
    if (workspacePath) {
      basePath = path.resolve(workspacePath);
    }
    // 2. Если есть filePath, пытаемся найти рабочую область от него
    else if (filePath) {
      basePath = findWorkspaceRoot(filePath);
    }
    // 3. Fallback на текущий workspace root
    if (!basePath) {
      basePath = getWorkspaceRoot();
    }
    
    // Сначала пытаемся прочитать из .rootrace/ai_debug_config (предпочтительный способ)
    const rootraceDir = path.join(basePath, '.rootrace');
    const configPathInRootrace = path.join(rootraceDir, 'ai_debug_config');
    const configPathOld = path.join(basePath, '.ai_debug_config'); // Старый путь для обратной совместимости
    
    // Пробуем сначала .rootrace, потом старый путь
    const configPath = fs.existsSync(configPathInRootrace) ? configPathInRootrace : configPathOld;
    
    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        
        // Используем общую утилиту для парсинга конфигурации
        const config = parseConfigOrDecrypt<{ url: string } | null>(configContent, null);
        
        if (config && config.url) {
          // ВСЕГДА возвращаем URL как есть - определение Docker происходит во время выполнения
          // через _rootrace_host (Python) или rootraceHost (Go)
          return config.url;
        }
      } catch (error) {
        // Если ошибка чтения конфига, пробуем .debug_port
      }
    }
    
    // Fallback 1: пытаемся прочитать порт из .rootrace/debug_port или .debug_port (старый путь)
    const portFilePathInRootrace = path.join(rootraceDir, 'debug_port');
    const portFilePathOld = path.join(basePath, '.debug_port');
    const portFilePath = fs.existsSync(portFilePathInRootrace) ? portFilePathInRootrace : portFilePathOld;
    if (fs.existsSync(portFilePath)) {
      try {
        const portContent = fs.readFileSync(portFilePath, 'utf8').trim();
        const port = parseInt(portContent, 10);
        if (!isNaN(port) && port > 0 && port < 65536) {
          // ВСЕГДА используем localhost - определение Docker происходит во время выполнения
          // через _rootrace_host (Python) или rootraceHost (Go)
          return `http://localhost:${port}/`;
        }
      } catch (error) {
        // Игнорируем ошибки чтения .debug_port
      }
    }
    
    // Fallback 2: используем стандартный порт (51234)
    // ВСЕГДА используем localhost - определение Docker происходит во время выполнения
    // через _rootrace_host (Python) или rootraceHost (Go)
    return `http://localhost:51234/`;
  } catch (error) {
    return null;
  }
}
