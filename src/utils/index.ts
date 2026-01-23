/**
 * Централизованный экспорт всех утилит
 * 
 * Используйте этот файл для импорта утилит:
 * ```typescript
 * import { getWorkspaceRoot, sanitizeFilePath } from './utils';
 * ```
 */

// Workspace утилиты
export { getWorkspaceRoot, getWorkspaceRootOrNull } from './workspace-utils';

// VS Code загрузчик
export { getVSCode, isVSCodeAvailable } from './vscode-loader';

// Парсинг конфигурации
export {
  parseConfigOrDecrypt,
  parseConfigOrDecryptWithError,
  parseArrayOrDecrypt
} from './config-parser';

// Работа с путями файлов
export {
  normalizeFilePath,
  sanitizeFilePath,
  isPathSafe
} from './file-path-utils';

// Git утилиты
export {
  findGitRoot,
  findGitRootSync
} from './git-utils';

// Определение языка
export { getLanguageFromFileExtension } from './language-detector';
