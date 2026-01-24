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

/** Записи .gitignore, добавляемые расширением: только то, что создаёт расширение. .rootrace — и файл, и каталог (одноимённые). */
const GITIGNORE_ENTRIES = ['.rootrace', '.rootrace/', '.roo/roo-trace-rules', '.roomodes'];

/** Все варианты для удаления при uninstall (включая эквиваленты вроде .roo/roo-trace-rules/). */
const GITIGNORE_REMOVE_PATTERNS = new Set([
  ...GITIGNORE_ENTRIES,
  '.roo/roo-trace-rules/'
]);

function parseGitignoreLines(content: string): Set<string> {
  const seen = new Set<string>();
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line) {
      seen.add(line);
      // .rootrace и .rootrace/ эквивалентны
      if (line === '.rootrace/') seen.add('.rootrace');
      if (line === '.rootrace') seen.add('.rootrace/');
      // .roo/roo-trace-rules и .roo/roo-trace-rules/ эквивалентны
      if (line === '.roo/roo-trace-rules/') seen.add('.roo/roo-trace-rules');
      if (line === '.roo/roo-trace-rules') seen.add('.roo/roo-trace-rules/');
    }
  }
  return seen;
}

/**
 * Добавляет в .gitignore только то, что создаёт расширение: .rootrace (файл), .rootrace/ (каталог), .roo/roo-trace-rules, .roomodes.
 */
export function ensureRootraceInGitignore(): void {
  const workspaceRoot = getWorkspaceRoot();
  const gitignorePath = path.join(workspaceRoot, '.gitignore');

  if (!fs.existsSync(gitignorePath)) {
    try {
      fs.writeFileSync(gitignorePath, GITIGNORE_ENTRIES.join('\n') + '\n', 'utf8');
    } catch (e) {
      // Игнорируем ошибки записи
    }
    return;
  }

  try {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    const seen = parseGitignoreLines(gitignoreContent);
    const missing = GITIGNORE_ENTRIES.filter(e => !seen.has(e));
    if (missing.length === 0) return;
    const newContent = gitignoreContent.trimEnd() + '\n' + missing.join('\n') + '\n';
    fs.writeFileSync(gitignorePath, newContent, 'utf8');
  } catch (e) {
    // Игнорируем ошибки чтения/записи
  }
}

/**
 * Удаляет из .gitignore все записи, добавленные расширением.
 * Вызывать перед удалением расширения (команда "RooTrace: Remove RooTrace entries from .gitignore").
 */
export function removeRooTraceFromGitignore(): boolean {
  const workspaceRoot = getWorkspaceRoot();
  const gitignorePath = path.join(workspaceRoot, '.gitignore');

  if (!fs.existsSync(gitignorePath)) {
    return false;
  }

  try {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const kept: string[] = [];
    let removed = 0;

    for (const raw of lines) {
      const pattern = raw.replace(/#.*$/, '').trim();
      if (pattern && GITIGNORE_REMOVE_PATTERNS.has(pattern)) {
        removed++;
        continue;
      }
      kept.push(raw);
    }

    if (removed === 0) {
      return false;
    }

    let newContent = kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
    if (newContent) newContent += '\n';
    fs.writeFileSync(gitignorePath, newContent, 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

/** Пути артефактов расширения в корне workspace (удалять при uninstall). */
const ARTIFACT_PATHS = [
  '.rootrace',           // файл или каталог
  '.roo/roo-trace-rules', // каталог промптов
  '.roomodes'            // файл
];

/**
 * Удаляет файлы и каталоги, которые создаёт расширение (те же, что в .gitignore).
 * Вызывать перед удалением расширения вместе с removeRooTraceFromGitignore.
 * @returns Список удалённых путей (относительно workspace root)
 */
export function removeRooTraceArtifacts(): string[] {
  const root = getWorkspaceRoot();
  const deleted: string[] = [];

  for (const rel of ARTIFACT_PATHS) {
    const full = path.join(root, rel);
    try {
      if (!fs.existsSync(full)) continue;
      fs.rmSync(full, { recursive: true, force: true });
      deleted.push(rel);
    } catch (e) {
      // Пропускаем ошибки отдельного удаления
    }
  }

  return deleted;
}
