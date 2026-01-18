# Анализ архитектуры расширения Debug Sidecar (MCP-Интеграция)

## Введение

Debug Sidecar — это VSCode расширение, которое реализует подход Hypothesis-Driven Debugging (HDD) для интеллектуальной отладки с использованием AI. Система состоит из трёх основных компонентов:
1. **Расширение Debug Sidecar** — локальный сервер, Dashboard и управление логами.
2. **Roo Code с системным промптом** — инструментирование кода и анализ логов.
3. **Пользовательский код** — инструментированный fetch-вызовами.

## Основные компоненты

### 1. Debug Sidecar Extension (`debug-sidecar/src/extension.ts`)

#### Функции:
- **`activate()`** — регистрация команд и автоматический запуск сервера.
- **`startServer()`** — создание HTTP-сервера на случайном порту с CORS поддержкой.
- **`createAIDebugConfig()`** — создание файла `.ai_debug_config` с URL сервера.
- **`logToOutputChannel()`** — форматирование и сохранение логов в канале «AI Debugger».
- **`openDashboard()`** — открытие WebView панели для визуализации логов.
- **`cleanupDebugCode()`** — удаление отладочных блоков из кода.
- **`stopServer()`** — остановка сервера и удаление конфигурационных файлов.

#### API эндпоинты сервера:
- **POST `/`** — приём отладочных данных в формате JSON.
- **GET `/logs`** — получение сохранённых логов из памяти.
- **OPTIONS** — обработка preflight CORS запросов.

#### Формат лога:
```
[LOG][Hypothesis: H1][Time: 14:35:22]
Context: "Проверка значения a"
Data: {
  "a": 2,
  "b": 3,
  "result": 5
}
---
```

### 2. Roo Code Integration

Roo Code работает как AI-ассистент, который:
- Читает файл `.ai_debug_config` для определения порта сервера.
- Формулирует гипотезы (H1–H5) на основе проблемы.
- Вставляет в код блоки между маркерами `// AI_DEBUG_START` и `// AI_DEBUG_END`.
- Внутри блока добавляет `fetch`-запрос на `http://localhost:PORT/` с данными гипотезы.
- После выполнения сценария анализирует логи из канала «AI Debugger» и предлагает выводы.

### 3. WebView Dashboard

Панель Dashboard отображает логи в реальном времени с цветовым кодированием по гипотезам:
- **H1** — красный, **H2** — зелёный, **H3** — синий, **H4** — жёлтый, **H5** — пурпурный.
- Каждая запись содержит: тег гипотезы, временную метку, контекстное сообщение и данные состояния.
- Поддерживается очистка логов (только визуальная).

## Поток данных

```mermaid
flowchart TD
    A[Пользователь ставит задачу отладки] --> B[Roo Code формирует гипотезы H1..H5]
    B --> C[Roo Code внедряет отладочные блоки в код]
    C --> D[Пользователь запускает приложение]
    D --> E[Код отправляет POST запрос на localhost:порт]
    E --> F[Debug Sidecar сервер принимает данные]
    F --> G[Логи выводятся в канал AI Debugger]
    F --> H[Логи передаются в WebView Dashboard]
    G --> I[Пользователь даёт команду "Analyze logs"]
    H --> I
    I --> J[Roo Code анализирует логи и предлагает выводы]
    J --> K[Пользователь подтверждает правильную гипотезу]
    K --> L[Команда Cleanup удаляет отладочные блоки]
```

## Точки интеграции для тестирования

### 1. Работает ли умный дебаг
- **Сервер запускается автоматически** при активации расширения.
- **Порт сохраняется в `.debug_port`** — проверка наличия файла и корректности порта.
- **Конфигурационный файл `.ai_debug_config` создаётся** — проверка структуры JSON.

### 2. Вставлены ли fetch-вызовы в нужных местах кода
- **Roo Code добавляет блоки с маркерами** — проверка наличия `// AI_DEBUG_START` и `// AI_DEBUG_END`.
- **fetch-запрос отправляется на правильный URL** — проверка порта из `.debug_port`.
- **Данные гипотезы включают `hypothesisId`, `message`, `state`** — проверка формата JSON.

### 3. Отправляются ли данные на сервер
- **Сервер отвечает статусом 200** на POST запрос.
- **Логи появляются в канале «AI Debugger»** — проверка вывода `outputChannel`.
- **Данные передаются в Dashboard** — проверка обновления WebView.

### 4. Анализирует ли LLM полученные данные
- **Roo Code читает логи из канала «AI Debugger»** — проверка доступа к логам.
- **LLM получает структурированный контекст** — проверка формирования промпта.
- **Анализ приводит к корректной гипотезе** — проверка точности вывода.

## План тестирования

### Тест 1: Запуск сервера
- **Цель:** Убедиться, что сервер запускается и создаёт конфигурационные файлы.
- **Шаги:**
  1. Активировать расширение Debug Sidecar.
  2. Проверить наличие файла `.debug_port` с номером порта.
  3. Проверить наличие файла `.ai_debug_config` с корректным URL.
  4. Отправить тестовый POST запрос на `/` и убедиться в успешном ответе.

### Тест 2: Инструментирование кода
- **Цель:** Проверить, что Roo Code корректно вставляет отладочные блоки.
- **Шаги:**
  1. Использовать Roo Code с системным промптом для отладки простой функции.
  2. Проверить наличие маркеров `// AI_DEBUG_START` и `// AI_DEBUG_END` в коде.
  3. Убедиться, что внутри блока есть `fetch`-запрос с правильным портом.
  4. Проверить, что `hypothesisId` соответствует одной из гипотез.

### Тест 3: Отправка данных
- **Цель:** Убедиться, что инструментированный код отправляет данные на сервер.
- **Шаги:**
  1. Запустить инструментированный код.
  2. Проверить лог в канале «AI Debugger» на наличие новой записи.
  3. Проверить обновление Dashboard.
  4. Убедиться, что сервер отвечает статусом 200.

### Тест 4: Анализ логов LLM
- **Цель:** Проверить, что LLM корректно анализирует собранные логи.
- **Шаги:**
  1. Собрать логи для нескольких гипотез.
  2. Дать команду Roo Code «Analyze logs».
  3. Проверить, что LLM возвращает анализ с указанием наиболее вероятной гипотезы.
  4. Убедиться, что анализ соответствует данным состояния.

### Тест 5: Очистка кода
- **Цель:** Проверить, что команда Cleanup удаляет отладочные блоки.
- **Шаги:**
  1. Выполнить команду `ai-debugger.cleanup`.
  2. Проверить, что блоки между маркерами удалены из всех файлов.
  3. Убедиться, что файл `.ai_debug_config` удалён.

## Рекомендации по реализации тестов

### Интеграционные тесты
- Использовать **Jest** для тестирования функций расширения (например, `formatLogEntry`).
- Использовать **Supertest** для тестирования HTTP эндпоинтов сервера.
- Использовать **VSCode Test API** для эмуляции команд расширения.

### Модульные тесты
- **`extension.ts`** — тестирование функций `createAIDebugConfig`, `logToOutputChannel`, `cleanupDebugCode`.
- **Сервер** — тестирование обработки POST и GET запросов.
- **Dashboard** — тестирование генерации HTML и передачи сообщений.

### E2E тесты
- Запуск расширения в изолированном хосте VSCode.
- Автоматическое выполнение сценария отладки с использованием Roo Code.
- Проверка появления логов и их анализа.

## MCP Architecture

### Overview
The architecture has been updated to integrate with the Model Context Protocol (MCP). Instead of the traditional HTTP server approach, the system now uses an MCP server called RooTrace that provides deeper integration with AI assistants and simplifies interaction through a standardized protocol.

### Component Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                    Roo Code AI Assistant                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │         MCP Client Interface                             │  │
│  │  - Invokes MCP tools                                     │  │
│  │  - Processes tool responses                              │  │
│  │  - Integrates with debugging workflow                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │         RooTrace MCP Server                              │  │
│  │  - Handles debug-specific tools                          │  │
│  │  - Manages hypothesis tracking                           │  │
│  │  - Provides probe injection capabilities                 │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Debug Sidecar Extension                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │         MCP Registration Layer                           │  │
│  │  - Auto-registers RooTrace server                        │  │
│  │  - Manages server lifecycle                              │  │
│  │  - Handles tool permissions                              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │         Code Instrumentation Module                      │  │
│  │  - AST parsing and code modification                     │  │
│  │  - Probe injection at runtime                            │  │
│  │  - Multi-language support                                │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### MCP Tools
The system implements the following MCP tools:

1. **read_runtime_logs**
   - Retrieves debugging session logs
   - Parameters: sessionId (optional)
   - Returns: log entries and metadata

2. **get_debug_status**
   - Returns server status, active hypotheses and current session
   - Parameters: none
   - Returns: server status and debugging session info

3. **clear_session**
   - Clears debugging session, resets all hypotheses and logs
   - Parameters: sessionId (optional)
   - Returns: success status

4. **inject_probes**
   - Injects probes into code for additional debugging information
   - Parameters: filePath, lineNumber, probeType, message
   - Returns: injection result

### Key Files
- `mcp-handler.ts` - Main class for handling MCP requests
- `mcp-registration.ts` - Registration logic for MCP server
- `code-injector.ts` - Code instrumentation module for probe injection

## Заключение

Архитектура Debug Sidecar обеспечивает гибкий и безопасный подход к Hypothesis-Driven Debugging. Компоненты хорошо разделены, что упрощает тестирование. Ключевые точки интеграции — запуск сервера, инструментирование кода, отправка данных и анализ LLM — должны быть покрыты тестами для гарантии корректной работы системы.

Предложенный план тестирования охватывает все аспекты «умного дебага» и может быть использован для создания набора тестов, проверяющих расширение в реальных сценариях.