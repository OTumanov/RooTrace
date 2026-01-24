# MCP Handler Module

Модуль для обработки MCP (Model Context Protocol) запросов в RooTrace.

## Структура модуля

Модуль организован в следующую структуру:

```
mcp-handler/
├── handler.ts              # Основной класс RooTraceMCPHandler (оркестратор)
├── index.ts               # Централизованный экспорт модуля
├── tool-schemas.ts        # Схемы MCP инструментов
├── types.ts               # Типы для MCP handler
│
├── handlers/              # Обработчики инструментов (tools)
│   ├── base-handler.ts   # Базовые интерфейсы (HandlerContext, ToolHandler)
│   ├── index.ts          # Экспорт всех обработчиков
│   ├── read-runtime-logs.ts
│   ├── clear-logs.ts
│   ├── get-debug-status.ts
│   ├── clear-session.ts
│   ├── inject-probes.ts
│   ├── inject-multiple-probes.ts
│   ├── show-user-instructions.ts
│   ├── read-file.ts
│   ├── get-problems.ts
│   └── load-rule.ts
│
├── request-handlers/      # Обработчики базовых MCP запросов
│   ├── index.ts
│   ├── initialize.ts     # Initialize Request
│   └── list-tools.ts     # ListTools Request
│
├── resources/             # Обработчики ресурсов
│   ├── index.ts
│   ├── list-resources.ts # ListResources Request
│   └── read-resource.ts  # ReadResource Request
│
├── security/              # Утилиты безопасности
│   ├── index.ts
│   ├── approval-checker.ts      # Проверка разрешений на чтение логов
│   └── git-commit-checker.ts    # Проверка git commit перед редактированием
│
├── file-utils/            # Файловые утилиты
│   ├── index.ts
│   ├── path-normalizer.ts # Нормализация путей, проверка Python файлов
│   ├── git-utils.ts      # Обертка над utils/git-utils
│   └── probe-finder.ts   # Поиск файлов с пробами
│
├── server-utils/          # Серверные утилиты
│   ├── index.ts
│   └── server-tester.ts   # Тестирование работоспособности сервера
│
├── injection-utils/       # Утилиты для инъекции проб
│   ├── index.ts
│   ├── retry-handler.ts  # Retry механизм для инъекции проб
│   └── validation.ts     # Валидация параметров инъекции
│
└── logging/               # Утилиты логирования MCP
    ├── index.ts
    └── mcp-logger.ts     # Логирование MCP запросов/ответов/ошибок
```

## Архитектура

### Основной класс: RooTraceMCPHandler

`RooTraceMCPHandler` является оркестратором, который:
- Регистрирует обработчики MCP запросов
- Создает и управляет `HandlerContext` для обработчиков
- Делегирует выполнение соответствующим модулям

### HandlerContext

`HandlerContext` - это интерфейс, который предоставляет все необходимые зависимости и утилиты для обработчиков:
- Хранилище логов (`SharedLogStorage`)
- Мониторинг контекста (`ContextMonitor`)
- Очередь сообщений (`MessageQueue`)
- Утилиты для работы с файлами, путями, пробами
- Утилиты безопасности

### Обработчики инструментов

Каждый обработчик инструмента:
- Принимает аргументы инструмента и `HandlerContext`
- Возвращает `CallToolResult`
- Изолирован от других обработчиков
- Легко тестируется

### Обработчики запросов и ресурсов

Обработчики базовых MCP запросов и ресурсов:
- `initialize` - инициализация MCP сервера
- `list_tools` - список доступных инструментов
- `list_resources` - список доступных ресурсов
- `read_resource` - чтение конкретного ресурса

## Использование

### Импорт основного класса

```typescript
import { RooTraceMCPHandler, startRooTraceMCP, rooTraceMCP } from './mcp-handler';
```

### Запуск сервера

```typescript
const handler = await startRooTraceMCP();
// или
const handler = new RooTraceMCPHandler();
await handler.start();
```

### Импорт отдельных компонентов

```typescript
// Обработчики инструментов
import { handleReadRuntimeLogs, handleInjectProbes } from './mcp-handler/handlers';

// Утилиты
import { normalizeFilePath, isPythonFile } from './mcp-handler/file-utils';
import { checkReadRuntimeLogsApproval } from './mcp-handler/security';
```

## Доступные инструменты (Tools)

1. **read_runtime_logs** - Чтение runtime логов отладочной сессии
2. **clear_logs** - Очистка логов
3. **get_debug_status** - Получение статуса отладки
4. **clear_session** - Очистка сессии (удаление проб и логов)
5. **inject_probes** - Инъекция одной пробы в код
6. **inject_multiple_probes** - Инъекция нескольких проб
7. **show_user_instructions** - Показ инструкций пользователю через UI
8. **read_file** - Чтение файла (с поддержкой диапазонов строк)
9. **get_problems** - Получение диагностик (проблем) из VS Code
10. **load_rule** - Загрузка правила из .roo/roo-trace-rules/

## Доступные ресурсы (Resources)

1. **roo-trace://logs** - Runtime логи в формате JSON
2. **roo-trace://status** - Статус отладки (uptime, активные гипотезы)
3. **roo-trace://rules** - Список доступных модулей правил
4. **roo-trace://rule/{filename}** - Содержимое конкретного модуля правила

## Безопасность

Модуль включает несколько механизмов безопасности:

- **Проверка разрешений на чтение логов**: `read_runtime_logs` требует явного одобрения пользователя
- **Проверка git commit**: Перед редактированием файлов требуется коммит или .bak копия
- **Валидация параметров**: Все параметры инъекции проб валидируются перед выполнением
- **Запрет инъекции в Python файлы**: Python файлы защищены от прямого редактирования

## Тестирование

Тесты находятся в `tests/mcp-handler-comprehensive.test.ts` и `tests/mcp-server.test.ts`.

Для запуска тестов:
```bash
npm test -- mcp-handler
```

## История рефакторинга

Модуль был рефакторирован из монолитного файла `mcp-handler.ts` (1942 строки) в модульную структуру для:
- Улучшения читаемости и поддерживаемости
- Упрощения тестирования
- Следования принципам единственной ответственности
- Улучшения переиспользования кода

## Дополнительная информация

- [План рефакторинга](../../docs/REFACTORING_MCP_HANDLER_PLAN.md)
- [MCP Protocol Documentation](https://modelcontextprotocol.io/)
