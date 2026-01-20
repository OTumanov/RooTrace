import * as fs from 'fs';
import * as path from 'path';

// Условный импорт vscode - доступен только в контексте VS Code расширения
let vscode: typeof import('vscode') | undefined;
try {
  vscode = require('vscode');
} catch (e) {
  // vscode недоступен (например, в MCP сервере) - это нормально
  vscode = undefined;
}

/**
 * Получает путь к директории .rootrace в корне рабочей области
 * Создает директорию, если она не существует
 */
export function getRootraceDir(): string {
  let workspaceRoot: string;
  
  // Приоритет 1: переменная окружения (для MCP сервера)
  const envWorkspace = process.env.ROO_TRACE_WORKSPACE || process.env.ROO_TRACE_WORKSPACE_ROOT;
  if (envWorkspace && typeof envWorkspace === 'string' && envWorkspace.trim().length > 0) {
    workspaceRoot = envWorkspace.trim();
  } else if (vscode) {
    // Приоритет 2: VS Code workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      workspaceRoot = workspaceFolders[0].uri.fsPath;
    } else {
      workspaceRoot = process.cwd();
    }
  } else {
    // Fallback: текущая директория
    workspaceRoot = process.cwd();
  }
  
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
  // Получаем workspace root (родительскую директорию .rootrace)
  let workspaceRoot: string;
  
  const envWorkspace = process.env.ROO_TRACE_WORKSPACE || process.env.ROO_TRACE_WORKSPACE_ROOT;
  if (envWorkspace && typeof envWorkspace === 'string' && envWorkspace.trim().length > 0) {
    workspaceRoot = envWorkspace.trim();
  } else if (vscode) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      workspaceRoot = workspaceFolders[0].uri.fsPath;
    } else {
      workspaceRoot = process.cwd();
    }
  } else {
    workspaceRoot = process.cwd();
  }
  
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
