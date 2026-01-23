import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceRoot } from './utils/workspace-utils';

/**
 * Получает путь к директории .rootrace в корне рабочей области
 * Создает директорию, если она не существует
 */
export function getRootraceDir(): string {
  // Используем общую утилиту для получения workspace root
  const workspaceRoot = getWorkspaceRoot();
  const rootraceDir = path.join(workspaceRoot, '.rootrace');
  
  // Создаем директорию, если она не существует
  if (!fs.existsSync(rootraceDir)) {
    try {
      fs.mkdirSync(rootraceDir, { recursive: true });
    } catch (e) {
      // Игнорируем ошибки создания (может быть уже создана)
    }
  }
  
  return rootraceDir;
}

/**
 * Получает путь к файлу внутри .rootrace директории
 */
export function getRootraceFilePath(filename: string): string {
  return path.join(getRootraceDir(), filename);
}

/**
 * Добавляет .rootrace в .gitignore, если файл существует
 */
export function ensureRootraceInGitignore(): void {
  // Используем общую утилиту для получения workspace root
  const workspaceRoot = getWorkspaceRoot();
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  
  if (!fs.existsSync(gitignorePath)) {
    // .gitignore не существует - создаем его
    try {
      fs.writeFileSync(gitignorePath, '.rootrace\n', 'utf8');
    } catch (e) {
      // Игнорируем ошибки записи
    }
    return;
  }
  
  // Проверяем, есть ли уже .rootrace в .gitignore
  try {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    if (gitignoreContent.includes('.rootrace')) {
      // Уже есть - ничего не делаем
      return;
    }
    
    // Добавляем .rootrace в конец файла
    const newContent = gitignoreContent.trim() + '\n.rootrace\n';
    fs.writeFileSync(gitignorePath, newContent, 'utf8');
  } catch (e) {
    // Игнорируем ошибки чтения/записи
  }
}
