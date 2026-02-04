# Задача 005: Проверить статус обработки Promise в MCP Handler

## Что нужно проверить

Проверить файл [`src/mcp-handler/request-handlers/list-tools.ts`](../../src/mcp-handler/request-handlers/list-tools.ts) на наличие исправления обработки Promise.

**Конкретные проверки:**
1. Метод `handleListTools()` содержит валидацию `MCP_TOOL_SCHEMAS`
2. Есть проверка на undefined/null
3. Есть проверка на массив
4. Есть валидация каждого инструмента (name, description)

## Как протестировать

### Тест 1: Проверка валидации с null
```bash
# Запустить тест с null MCP_TOOL_SCHEMAS
node -e "
const { handleListTools } = require('./src/mcp-handler/request-handlers/list-tools.ts');
// Вызвать с null
// Проверить что выбрасывается ошибка
"
```

### Тест 2: Проверка валидации с невалидным инструментом
```bash
# Запустить тест с невалидным инструментом
node -e "
const { handleListTools } = require('./src/mcp-handler/request-handlers/list-tools.ts');
// Вызвать с инструментом без name
// Проверить что выбрасывается ошибка
"
```

**Лимит:** Макс. 100 строк лога или 30 секунд выполнения

**Ожидаемый результат:** Валидация работает, ошибки выбрасываются для невалидных данных
