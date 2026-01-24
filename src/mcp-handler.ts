/**
 * Реэкспорт для обратной совместимости
 * 
 * Этот файл реэкспортирует все из новой модульной структуры mcp-handler/.
 * Старый монолитный код был разбит на модули в подкаталоге mcp-handler/.
 * 
 * Импорты из './mcp-handler' автоматически разрешаются в './mcp-handler/index.ts'
 */

// Основной класс и функции
export { RooTraceMCPHandler, startRooTraceMCP, rooTraceMCP } from './mcp-handler/index';

// Типы
export * from './mcp-handler/types';

// Схемы инструментов
export { MCP_TOOL_SCHEMAS } from './mcp-handler/tool-schemas';
