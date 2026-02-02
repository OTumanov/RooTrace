# Phase 2.3: Расщепление extension.ts на модули

## Анализ текущего состояния

**Текущий файл:** `src/extension.ts`
- **Размер:** 2120 строк (God object)
- **Основные проблемы:**
  - Смешение ответственностей (HTTP сервер, WebSocket, UI, команды, конфигурация)
  - Высокая связность (глобальные переменные используются по всему файлу)
  - Сложность тестирования и поддержки
  - Нарушение принципа единой ответственности (SRP)

**Существующие модули (уже вынесены):**
- `mcp-handler/` – обработка MCP-запросов
- `code-injector/` – инъекция probe-кода
- `utils/` – утилиты
- `mcp-registration.ts` – регистрация MCP сервера
- `role-manager.ts` – управление ролями
- `shared-log-storage.ts` – хранилище логов с MVCC
- `session-manager.ts` – управление сессиями
- `log-exporter.ts` – экспорт логов
- `encryption-utils.ts` – шифрование
- `error-handler.ts` – обработка ошибок
- `metrics.ts` – метрики
- `constants.ts` – константы
- `diagnostics-handler.ts` – диагностика
- `rootrace-dir-utils.ts` – работа с директорией .rootrace

## Предлагаемая структура модулей

```
src/
├── extension.ts                    # Только activate/deactivate (<150 строк)
├── http-server/                    # HTTP сервер и маршруты
│   ├── index.ts                    # Экспорт модуля
│   ├── server.ts                   # Класс HttpServer (start/stop)
│   ├── routes/                     # Маршруты
│   │   ├── health.ts               # /health
│   │   ├── logs.ts                 # /logs
│   │   ├── diagnostics.ts          # /diagnostics
│   │   └── root.ts                 # POST / (приём логов)
│   └── handlers/                   # Обработчики бизнес-логики
│       ├── log-handler.ts          # Обработка логов
│       └── config-handler.ts       # Конфигурация сервера
├── websocket/                      # WebSocket сервер
│   ├── index.ts
│   ├── server.ts                   # WebSocketServer
│   └── message-handler.ts          # Обработка сообщений
├── ui-bridge/                      # UI взаимодействие с VS Code
│   ├── index.ts
│   ├── popup-handler.ts            # Показ всплывающих окон
│   ├── dashboard.ts                # WebView дашборд
│   └── ui-event-processor.ts       # Обработка UI событий (ui.json)
├── services/                       # Сервисы приложения
│   ├── log-service.ts              # Работа с логами (appendLogToFile, getInMemoryLogs)
│   ├── storage-service.ts          # Работа с хранилищем (savePortToFile, removeAIDebugConfig)
│   ├── role-service.ts             # Синхронизация ролей (вызов RoleManager)
│   ├── prompt-service.ts           # Копирование промпт-модулей (copyPromptModules)
│   └── config-service.ts           # Загрузка конфигурации (loadAIDebugConfig)
├── commands/                       # Регистрация команд VS Code
│   ├── index.ts                    # Регистрация всех команд
│   ├── server-commands.ts          # startServer, stopServer
│   ├── log-commands.ts             # clearLogs, exportLogs
│   ├── mcp-commands.ts             # reregisterMcpServer, readRuntimeLogs, clearSession
│   ├── ui-commands.ts              # showUserInstructions, openDashboard, cleanupDebugCode
│   └── gitignore-commands.ts       # removeFromGitignore
├── mcp-handler/                    # Существующий модуль (оставить как есть)
└── utils/                          # Существующий модуль (дополнить при необходимости)
```

## Детальный план миграции

### Шаг 0: Подготовка
- [ ] Создать директории `http-server`, `websocket`, `ui-bridge`, `services`, `commands`
- [ ] Обновить `tsconfig.json` если нужно добавить пути
- [ ] Проверить тесты, чтобы они продолжали работать

### Шаг 1: Вынос сервисов (наименее зависимые)
- [ ] Создать `services/log-service.ts` с функциями:
  - `appendLogToFile`
  - `getInMemoryLogs`
  - `formatLogEntry`
  - `logToOutputChannel`
- [ ] Создать `services/storage-service.ts` с функциями:
  - `savePortToFile`
  - `removePortFile`
  - `removeAIDebugConfig`
  - `createAIDebugConfig`
  - `loadAIDebugConfig`
- [ ] Создать `services/prompt-service.ts` с функцией `copyPromptModules`
- [ ] Обновить импорты в `extension.ts` на новые сервисы

### Шаг 2: Вынос команд
- [ ] Создать `commands/` модуль с отдельными файлами для групп команд
- [ ] Перенести регистрацию команд из `activate` в соответствующие файлы
- [ ] Создать `commands/index.ts` который экспортирует функцию `registerAllCommands`
- [ ] Обновить `extension.ts` для вызова `registerAllCommands`

### Шаг 3: Вынос HTTP сервера
- [ ] Создать `http-server/server.ts` с классами `HttpServer` (инкапсуляция server, port)
- [ ] Перенести функции `startServer`, `stopServer`, обработчики маршрутов
- [ ] Создать отдельные файлы маршрутов в `http-server/routes/`
- [ ] Вынести rate limiting в отдельный утилитный модуль
- [ ] Обновить `extension.ts` для использования `HttpServer`

### Шаг 4: Вынос WebSocket
- [ ] Создать `websocket/server.ts` с классом `WebSocketServer`
- [ ] Перенести `setupWebSocketListeners`, управление клиентами
- [ ] Обновить зависимости на `sharedStorage` через события

### Шаг 5: Вынос UI Bridge
- [ ] Создать `ui-bridge/dashboard.ts` с функциями `openDashboard`, `escapeHtml`, `getWebviewContent`
- [ ] Создать `ui-bridge/popup-handler.ts` с обработкой команд `showUserInstructions`
- [ ] Создать `ui-bridge/ui-event-processor.ts` с обработкой файла `ui.json`
- [ ] Перенести watchFile логику из `activate`

### Шаг 6: Рефакторинг extension.ts
- [ ] Удалить все вынесенные функции
- [ ] Оставить только:
  - Импорты
  - Глобальные переменные (которые нельзя убрать)
  - `activate` (до 50 строк)
  - `deactivate` (до 30 строк)
  - Минимальную glue-логику
- [ ] Обновить все импорты на новые модули

### Шаг 7: Интеграционное тестирование
- [ ] Запустить существующие тесты `npm test`
- [ ] Проверить ручные сценарии:
  - Запуск/остановка сервера
  - Отправка логов через HTTP
  - Открытие дашборда
  - Работа MCP команд
  - Копирование промпт-модулей

### Шаг 8: Документация и чистка
- [ ] Обновить `docs/PHASE_2_PROGRESS.md` с отметкой о завершении
- [ ] Создать `docs/MODULE_ARCHITECTURE.md` с описанием новой структуры
- [ ] Удалить неиспользуемые импорты и переменные

## Карта переноса функций

| Функция в extension.ts          | Новый модуль                    | Примечания |
|---------------------------------|---------------------------------|------------|
| `getLogFilePath`                | `services/storage-service.ts`   | Уже есть `getRootraceFilePath` |
| `copyPromptModules`             | `services/prompt-service.ts`    | |
| `appendLogToFile`               | `services/log-service.ts`       | |
| `createAIDebugConfig`           | `services/storage-service.ts`   | |
| `loadAIDebugConfig`             | `services/storage-service.ts`   | |
| `clearLogs`                     | `commands/log-commands.ts`      | |
| `formatLogEntry`                | `services/log-service.ts`       | |
| `logToOutputChannel`            | `services/log-service.ts`       | |
| `setupWebSocketListeners`       | `websocket/server.ts`           | |
| `exportLogs`                    | `commands/log-commands.ts`      | Использует `LogExporter` |
| `getInMemoryLogs`               | `services/log-service.ts`       | |
| `openDashboard`                 | `ui-bridge/dashboard.ts`        | |
| `escapeHtml`                    | `ui-bridge/dashboard.ts`        | |
| `getWebviewContent`             | `ui-bridge/dashboard.ts`        | |
| `cleanupDebugCode`              | `commands/ui-commands.ts`       | |
| `getRateLimitConfig`            | `http-server/middleware/rate-limit.ts` | |
| `checkRateLimit`                | `http-server/middleware/rate-limit.ts` | |
| `getClientIP`                   | `http-server/middleware/rate-limit.ts` | |
| `getServerPort`                 | `http-server/config.ts`         | |
| `startServer`                   | `http-server/server.ts`         | Класс `HttpServer` |
| `stopServer`                    | `http-server/server.ts`         | |
| `savePortToFile`                | `services/storage-service.ts`   | |
| `removePortFile`                | `services/storage-service.ts`   | |
| `removeAIDebugConfig`           | `services/storage-service.ts`   | |
| Команды регистрации в `activate`| `commands/*.ts`                 | Разделить по категориям |

## Зависимости между модулями

```
extension.ts → commands/, http-server/, websocket/, ui-bridge/, services/
services/ → shared-log-storage, session-manager, log-exporter, encryption-utils
http-server/ → services/log-service, services/storage-service
websocket/ → shared-log-storage (events)
ui-bridge/ → services/log-service, commands/
commands/ → services/, mcp-registration, mcp-handler
```

## Критические требования

1. **Не ломать существующий функционал** – каждый шаг должен сохранять работоспособность
2. **Соблюдать типизацию** – TypeScript интерфейсы должны быть вынесены в `types.ts` или локально
3. **Избегать циклических зависимостей** – планировать порядок выноса
4. **Сохранить глобальное состояние** – server, port, outputChannel должны быть доступны там, где нужно
5. **Минимизировать изменения в тестах** – тесты должны проходить после каждого шага

## Чеклист выполнения

- [ ] Подготовить структуру директорий
- [ ] Вынести сервисы (log, storage, prompt)
- [ ] Вынести команды
- [ ] Вынести HTTP сервер
- [ ] Вынести WebSocket
- [ ] Вынести UI bridge
- [ ] Рефакторинг extension.ts до <150 строк
- [ ] Прогон всех тестов
- [ ] Обновление документации

## Ожидаемый результат

`src/extension.ts` будет содержать только:

```typescript
import * as vscode from 'vscode';
import { registerAllCommands } from './commands';
import { HttpServer } from './http-server';
import { WebSocketServer } from './websocket';
import { UIBridge } from './ui-bridge';
import { LogService, StorageService, PromptService } from './services';

let server: HttpServer | null = null;
let wsServer: WebSocketServer | null = null;
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('AI Debugger');
    
    // Инициализация сервисов
    const logService = new LogService(outputChannel);
    const storageService = new StorageService();
    const promptService = new PromptService(outputChannel);
    
    // Регистрация команд
    registerAllCommands(context, { logService, storageService, promptService });
    
    // Запуск серверов
    server = new HttpServer(outputChannel, logService, storageService);
    await server.start();
    
    wsServer = new WebSocketServer(outputChannel);
    wsServer.start();
    
    // Копирование промпт-модулей
    await promptService.copyPromptModules(context);
    
    // Регистрация MCP сервера
    await registerMcpServer(context);
    
    // Синхронизация роли
    await RoleManager.syncRoleWithRoo(context);
}

export function deactivate() {
    server?.stop();
    wsServer?.stop();
    // ... cleanup
}
```

**Итоговая оценка:** ~100 строк, модульная архитектура, легко тестируемые компоненты.