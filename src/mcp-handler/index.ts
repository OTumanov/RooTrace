/**
 * Централизованный экспорт для модуля mcp-handler
 * 
 * Используйте этот файл для импорта:
 * ```typescript
 * import { RooTraceMCPHandler, startRooTraceMCP, rooTraceMCP } from './mcp-handler';
 * ```
 */

// Основной класс и функции
export { RooTraceMCPHandler, startRooTraceMCP, rooTraceMCP } from './handler';

// Типы
export * from './types';

// Схемы инструментов
export { MCP_TOOL_SCHEMAS } from './tool-schemas';

// Базовые интерфейсы для обработчиков
export * from './handlers/base-handler';

// Обработчики инструментов
export * from './handlers';

// Обработчики ресурсов
export * from './resources';

// Обработчики базовых MCP запросов
export * from './request-handlers';

// Утилиты безопасности (типы ReadLogsApprovalResult, GitCommitCheckResult уже в ./types)
export {
  checkReadRuntimeLogsApproval,
  READ_LOGS_APPROVAL_FILE,
  READ_LOGS_APPROVAL_MAX_AGE_MS,
  AUTO_DEBUG_APPROVAL_FILE,
  AUTO_DEBUG_APPROVAL_MAX_AGE_MS,
  checkGitCommitBeforeEdit
} from './security';

// Файловые утилиты
export * from './file-utils';

// Серверные утилиты (тип ServerTestResult уже в ./types)
export { testServerWriteRead } from './server-utils';

// Утилиты для инъекции проб
export * from './injection-utils';

// Утилиты логирования MCP
export * from './logging';
