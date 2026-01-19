# RooTrace API Documentation

Полная документация API для расширения RooTrace.

**Версия:** 0.0.1  
**Последнее обновление:** 2024-01-XX

## Содержание

- [Code Injector API](#code-injector-api)
- [Shared Log Storage API](#shared-log-storage-api)
- [Session Manager API](#session-manager-api)
- [File Lock Utils API](#file-lock-utils-api)
- [MCP Handler API](#mcp-handler-api)
- [Log Exporter API](#log-exporter-api)
- [Encryption Utils API](#encryption-utils-api)
- [MCP Registration API](#mcp-registration-api)
- [Role Manager API](#role-manager-api)

---

## Code Injector API

Модуль для инъекции проб отладки в код.

### `injectProbe(filePath, lineNumber, probeType, message, probeCode?, hypothesisId?)`

Инъекция пробы в код для отладки.

**Параметры:**
- `filePath: string` - Путь к файлу (относительный или абсолютный). Будет проверен на path traversal.
- `lineNumber: number` - Номер строки для инъекции (1-based). Будет скорректирован для правильной вставки.
- `probeType: 'log' | 'trace' | 'error'` - Тип пробы:
  - `'log'` - обычное логирование
  - `'trace'` - трассировка выполнения
  - `'error'` - логирование ошибок
- `message: string` - Сообщение для логирования. Используется для идентификации пробы.
- `probeCode?: string` - Опциональный пользовательский код пробы. Если не указан, будет сгенерирован автоматически.
- `hypothesisId?: string` - Опциональный ID гипотезы (H1-H5). Если не указан, будет сгенерирован из message.

**Возвращает:** `Promise<InjectionResult>`

**Пример:**
```typescript
const result = await injectProbe('src/app.py', 42, 'log', 'Checking user input');
if (result.success) {
  console.log('Probe injected successfully');
} else {
  console.error('Failed to inject probe:', result.message);
}
```

**Интерфейс InjectionResult:**
```typescript
interface InjectionResult {
  success: boolean;
  message: string;
  insertedCode?: string;
  syntaxCheck?: {
    passed: boolean;
    errors?: string[];
    warnings?: string[];
  };
}
```

**Интерфейс ProbeInfo:**
```typescript
interface ProbeInfo {
  id: string;
  filePath: string;
  lineNumber: number;
  originalCode: string;
  injectedCode: string;
  probeType: string;
  message: string;
  actualLineNumber?: number;
  probeLinesCount?: number;
}
```

---

### `removeProbe(filePath, probeId)`

Удаляет пробу из кода по её ID.

**Параметры:**
- `filePath: string` - Путь к файлу, из которого нужно удалить пробу
- `probeId: string` - Уникальный ID пробы, полученный при инъекции

**Возвращает:** `Promise<InjectionResult>`

**Пример:**
```typescript
const result = await removeProbe('src/app.py', 'probe_1234567890_abc');
if (result.success) {
  console.log('Probe removed successfully');
}
```

---

### `removeAllProbesFromFile(filePath)`

Удаляет все пробы из указанного файла.

**Параметры:**
- `filePath: string` - Путь к файлу, из которого нужно удалить все пробы

**Возвращает:** `Promise<InjectionResult>`

**Пример:**
```typescript
const result = await removeAllProbesFromFile('src/app.py');
if (result.success) {
  console.log('All probes removed from file');
}
```

---

### `getAllProbes()`

Получает информацию о всех зарегистрированных пробах.

**Возвращает:** `ProbeInfo[]`

**Пример:**
```typescript
const probes = getAllProbes();
console.log(`Total probes: ${probes.length}`);
probes.forEach(probe => {
  console.log(`Probe ${probe.id} in ${probe.filePath}:${probe.lineNumber}`);
});
```

---

### `generateProbeCode(language, probeType, message, serverUrl?, hypothesisId?)`

Генерирует код пробы для указанного языка программирования.

**Параметры:**
- `language: string` - Язык программирования (например, 'python', 'javascript', 'go')
- `probeType: 'log' | 'trace' | 'error'` - Тип пробы
- `message: string` - Сообщение для логирования
- `serverUrl?: string` - URL сервера RooTrace. Если не указан, вернется код с ошибкой.
- `hypothesisId?: string` - ID гипотезы (H1-H5). Если не указан, будет сгенерирован из message.

**Возвращает:** `string` - Сгенерированный код пробы

**Пример:**
```typescript
const code = generateProbeCode('python', 'log', 'User login', 'http://localhost:51234/', 'H1');
// Возвращает: try: import urllib.request, json; ...
```

**Поддерживаемые языки:**
- JavaScript/TypeScript (js, ts, jsx, tsx)
- Python (py)
- Java
- Go
- Rust (rs)
- C++ (cpp, cxx, cc)
- PHP
- Ruby (rb)
- C# (cs)
- Swift
- Kotlin (kt, kts)
- Scala (scala, sc)
- Lua
- Perl (pl, pm)
- R
- MATLAB (m, mm)
- Dart
- CSS (комментарии)
- HTML (комментарии)

**Примечание:** Для языков, не указанных в списке, используется JavaScript как fallback.

---

## Shared Log Storage API

Singleton класс для хранения логов отладки.

### `SharedLogStorage.getInstance()`

Получает единственный экземпляр SharedLogStorage (Singleton pattern).

**Возвращает:** `SharedLogStorage`

**Пример:**
```typescript
const storage = SharedLogStorage.getInstance();
```

---

### `addLog(log)`

Добавляет лог в хранилище.

**Параметры:**
- `log: RuntimeLog` - Объект RuntimeLog с данными лога

**Пример:**
```typescript
storage.addLog({
  timestamp: new Date().toISOString(),
  hypothesisId: 'H1',
  context: 'Function execution',
  data: { result: 42 }
});
```

**Интерфейс RuntimeLog:**
```typescript
interface RuntimeLog {
  timestamp: string;
  hypothesisId: string;
  context: string;
  data: unknown;
}
```

**События:**
- `logAdded` - Эмитится при добавлении нового лога

---

### `getLogs()`

Получает все логи из хранилища.

**Возвращает:** `RuntimeLog[]` - Копия массива всех логов

**Пример:**
```typescript
const allLogs = storage.getLogs();
console.log(`Total logs: ${allLogs.length}`);
```

---

### `getLogsByHypothesis(hypothesisId)`

Получает логи по ID гипотезы.

**Параметры:**
- `hypothesisId: string` - ID гипотезы (например, 'H1', 'H2')

**Возвращает:** `RuntimeLog[]`

**Пример:**
```typescript
const h1Logs = storage.getLogsByHypothesis('H1');
console.log(`H1 logs: ${h1Logs.length}`);
```

---

### `getLogsByDateRange(startDate, endDate)`

Получает логи за определенный период.

**Параметры:**
- `startDate: Date` - Начальная дата диапазона
- `endDate: Date` - Конечная дата диапазона

**Возвращает:** `RuntimeLog[]` - Массив логов, отсортированных по времени

**Пример:**
```typescript
const today = new Date();
const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
const recentLogs = storage.getLogsByDateRange(yesterday, today);
```

---

### `clear()`

Очищает все логи из хранилища.

**Пример:**
```typescript
storage.clear();
```

---

### `getHypotheses()`

Получает все гипотезы.

**Возвращает:** `Hypothesis[]`

**Интерфейс Hypothesis:**
```typescript
interface Hypothesis {
  id: string;
  status: string;
  description: string;
}
```

---

### `getHypothesis(id)`

Получает гипотезу по ID.

**Параметры:**
- `id: string` - ID гипотезы

**Возвращает:** `Hypothesis | undefined`

---

### `getLogCount()`

Получает количество логов в хранилище.

**Возвращает:** `number`

---

## Session Manager API

Менеджер для управления историей сессий отладки.

### `SessionManager.getInstance()`

Получает единственный экземпляр SessionManager.

**Возвращает:** `SessionManager`

---

### `createSession(description?)`

Создает новую сессию отладки.

**Параметры:**
- `description?: string` - Опциональное описание сессии

**Возвращает:** `Promise<string>` - ID созданной сессии

**Пример:**
```typescript
const sessionId = await sessionManager.createSession('Debug session 1');
```

---

### `completeSession()`

Завершает текущую активную сессию.

**Возвращает:** `Promise<void>`

**Пример:**
```typescript
await sessionManager.completeSession();
```

---

### `getSession(sessionId)`

Получает метаданные сессии по ID.

**Параметры:**
- `sessionId: string` - ID сессии

**Возвращает:** `SessionMetadata | undefined`

**Интерфейс SessionMetadata:**
```typescript
interface SessionMetadata {
  id: string;
  timestamp: string;
  hypotheses: Hypothesis[];
  logCount: number;
  duration?: number;
  status: 'active' | 'completed' | 'archived';
  description?: string;
}
```

---

### `getAllSessions()`

Получает все сессии, отсортированные по времени (новые первыми).

**Возвращает:** `SessionMetadata[]`

---

### `getCurrentSession()`

Получает текущую активную сессию.

**Возвращает:** `SessionMetadata | null`

---

### `compareSessions(sessionId1, sessionId2)`

Сравнивает две сессии.

**Параметры:**
- `sessionId1: string` - ID первой сессии
- `sessionId2: string` - ID второй сессии

**Возвращает:** `SessionComparison | null`

**Интерфейс SessionComparison:**
```typescript
interface SessionComparison {
  session1: SessionMetadata;
  session2: SessionMetadata;
  differences: {
    logCountDiff: number;
    hypothesisDiff: string[];
    durationDiff?: number;
  };
}
```

---

### `exportSessions()`

Экспортирует историю сессий в JSON.

**Возвращает:** `string` - JSON строка с данными сессий

---

### `archiveOldSessions(daysOld)`

Архивирует старые сессии.

**Параметры:**
- `daysOld: number` - Возраст сессий в днях для архивирования (по умолчанию 30)

**Возвращает:** `Promise<void>`

---

## File Lock Utils API

Утилита для файловых блокировок с очередью операций.

### `withFileLock(filePath, operation)`

Выполняет операцию с файлом с гарантией последовательного доступа.

**Параметры:**
- `filePath: string` - Путь к файлу
- `operation: () => Promise<T>` - Асинхронная операция для выполнения

**Возвращает:** `Promise<T>` - Результат операции

**Пример:**
```typescript
await withFileLock('file.txt', async () => {
  const content = await fs.promises.readFile('file.txt', 'utf8');
  await fs.promises.writeFile('file.txt', content + '\nnew line', 'utf8');
});
```

---

### `clearAllLocks()`

Очищает все блокировки (используется для тестов).

**Пример:**
```typescript
clearAllLocks();
```

---

## MCP Handler API

Обработчик MCP (Model Context Protocol) запросов.

### `RooTraceMCPHandler`

Класс для обработки MCP-запросов.

#### `start()`

Запускает MCP-сервер RooTrace.

**Возвращает:** `Promise<void>`

#### `stop()`

Останавливает MCP-сервер RooTrace.

**Возвращает:** `Promise<void>`

#### `addLog(hypothesisId, context, data)`

Добавляет лог в сессию отладки (deprecated).

**Параметры:**
- `hypothesisId: string` - ID гипотезы
- `context: string` - Контекст лога
- `data: unknown` - Данные лога

**Примечание:** Используйте `SharedLogStorage.getInstance().addLog()` напрямую.

---

## Log Exporter API

Класс для экспорта логов в различные форматы.

### `LogExporter.exportLogs(options)`

Экспортирует логи в указанном формате.

**Параметры:**
- `options: ExportOptions` - Опции экспорта

**Интерфейс ExportOptions:**
```typescript
interface ExportOptions {
  format: 'json' | 'csv' | 'markdown' | 'html' | 'excel';
  includeMetadata?: boolean;
  filterByHypothesis?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
}
```

**Возвращает:** `Promise<string>` - Экспортированные данные в виде строки

**Пример:**
```typescript
const content = await LogExporter.exportLogs({
  format: 'json',
  includeMetadata: true,
  filterByHypothesis: ['H1', 'H2']
});
```

---

### `LogExporter.saveToFile(content, format, filename?)`

Сохраняет экспортированные логи в файл.

**Параметры:**
- `content: string` - Содержимое для сохранения
- `format: ExportFormat` - Формат файла
- `filename?: string` - Опциональное имя файла

**Возвращает:** `Promise<string>` - Путь к сохраненному файлу

**Пример:**
```typescript
const filePath = await LogExporter.saveToFile(content, 'json', 'my-logs.json');
console.log(`Logs saved to: ${filePath}`);
```

---

## Encryption Utils API

Утилиты для шифрования данных.

### `generateEncryptionKey()`

Генерирует случайный ключ шифрования.

**Возвращает:** `Buffer` - Буфер сгенерированного ключа (32 байта)

**Пример:**
```typescript
const key = generateEncryptionKey();
```

---

### `encryptString(text, key)`

Шифрует строку с использованием ключа.

**Параметры:**
- `text: string` - Текст для шифрования
- `key: Buffer` - Ключ шифрования

**Возвращает:** `string` - Зашифрованные данные в формате base64

**Пример:**
```typescript
const encrypted = encryptString('sensitive data', key);
```

---

### `decryptString(encryptedText, key)`

Расшифровывает строку с использованием ключа.

**Параметры:**
- `encryptedText: string` - Зашифрованный текст в формате base64
- `key: Buffer` - Ключ шифрования

**Возвращает:** `string` - Расшифрованный текст

**Пример:**
```typescript
const decrypted = decryptString(encrypted, key);
```

---

### `encryptObject(obj, key)`

Шифрует объект (сериализует в JSON и шифрует).

**Параметры:**
- `obj: any` - Объект для шифрования
- `key: Buffer` - Ключ шифрования

**Возвращает:** `string` - Зашифрованные данные в формате base64

**Пример:**
```typescript
const encrypted = encryptObject({ data: 'value' }, key);
```

---

### `decryptObject(encryptedText, key)`

Расшифровывает объект (расшифровывает и десериализует из JSON).

**Параметры:**
- `encryptedText: string` - Зашифрованный текст в формате base64
- `key: Buffer` - Ключ шифрования

**Возвращает:** `any` - Расшифрованный объект

**Пример:**
```typescript
const obj = decryptObject(encrypted, key);
```

---

### `getEncryptionKey()`

Получает ключ шифрования из переменной окружения или генерирует новый.

**Возвращает:** `Buffer` - Ключ шифрования

**Пример:**
```typescript
const key = getEncryptionKey();
```

---

## MCP Registration API

Функции для регистрации MCP сервера в Roo Code/Roo Cline.

### `detectInstalledExtension()`

Определяет, какое расширение установлено (Roo Code или Roo Cline).

**Возвращает:** `Promise<'roo-code' | 'roo-cline' | null>`

**Пример:**
```typescript
const extension = await detectInstalledExtension();
if (extension === 'roo-code') {
  console.log('Roo Code detected');
}
```

---

### `registerMcpServer(context)`

Регистрирует MCP сервер RooTrace в конфигурации Roo Code/Roo Cline.

**Параметры:**
- `context: vscode.ExtensionContext` - Контекст расширения VS Code

**Возвращает:** `Promise<void>`

**Пример:**
```typescript
await registerMcpServer(context);
```

---

### `unregisterMcpServer()`

Удаляет регистрацию MCP сервера из конфигурации.

**Возвращает:** `Promise<void>`

**Пример:**
```typescript
await unregisterMcpServer();
```

---

## Role Manager API

Класс для управления ролями в Roo Code.

### `RoleManager.syncRoleWithRoo(context)`

Синхронизирует роль AI Debugger с Roo Code.

**Параметры:**
- `context: vscode.ExtensionContext` - Контекст расширения VS Code

**Возвращает:** `Promise<void>`

**Пример:**
```typescript
await RoleManager.syncRoleWithRoo(context);
```

---

## MCP Handler Exports

### `startRooTraceMCP()`

Запускает MCP-сервер RooTrace и возвращает обработчик.

**Возвращает:** `Promise<RooTraceMCPHandler>`

**Пример:**
```typescript
const handler = await startRooTraceMCP();
```

---

### `rooTraceMCP`

Глобальный экземпляр RooTraceMCPHandler для использования в других частях приложения.

**Тип:** `RooTraceMCPHandler`

**Пример:**
```typescript
import { rooTraceMCP } from './mcp-handler';
```

---

## Конфигурация VS Code

Все настройки доступны в VS Code Settings (Preferences → Settings → Extensions → RooTrace):

- `rooTrace.maxLogs` (number, default: 1000) - Максимальное количество логов в памяти
- `rooTrace.rateLimitMaxRequests` (number, default: 100) - Максимум HTTP запросов в минуту
- `rooTrace.rateLimitWindowMs` (number, default: 60000) - Окно rate limiting в миллисекундах
- `rooTrace.syntaxCheckTimeout` (number, default: 10000) - Таймаут проверки синтаксиса в миллисекундах
- `rooTrace.enableSyntaxValidation` (boolean, default: true) - Включить валидацию синтаксиса
- `rooTrace.autoCleanupInactiveClients` (boolean, default: true) - Автоматически удалять неактивные WebSocket клиенты

---

## Примеры использования

### MCP Инструменты

RooTrace предоставляет следующие MCP инструменты (префикс `mcp--roo-trace--`):

1. **`get_debug_status`** - Проверка статуса сервера и активных гипотез
2. **`read_runtime_logs`** - Получение логов отладочной сессии
3. **`clear_session`** - Очистка сессии отладки
4. **`inject_probes`** - Инъекция одной пробы в код
5. **`inject_multiple_probes`** - Инъекция нескольких проб за один раз (ПРЕДПОЧТИТЕЛЬНО)
6. **`show_user_instructions`** - Показ инструкций пользователю с кнопками

**Важно:**
- Все пробы используют стандартный URL `http://localhost:51234/` - не требуется чтение конфигов
- Используйте `inject_multiple_probes` для пакетной вставки проб - это более эффективно
- Инструменты доступны только через MCP с префиксом `mcp--roo-trace--`

### Протокол отладки (7 фаз с циклами)

Протокол отладки состоит из 7 фаз с циклическими процессами:

1. **Инициализация** - Проверка статуса сервера через `get_debug_status`
2. **Гипотезы** - Формулировка 3-5 гипотез (H1-H5)
3. **Инъекция проб** - Вставка проб через `inject_probes` или `inject_multiple_probes`, затем `show_user_instructions`
4. **Ожидание действий пользователя** - Пользователь запускает код и нажимает кнопку "Продолжить"
5. **Анализ логов** - Получение и анализ логов через `read_runtime_logs`
   - Если данных недостаточно → возврат к Фазе 3 (цикл диагностики)
6. **Исправление** - Предложение и применение исправления
   - После исправления → возврат к Фазе 4 (цикл проверки исправлений)
7. **Очистка** - Очистка сессии через `clear_session` только после подтверждения решения проблемы

**Циклы:**
- **Цикл диагностики**: Фаза 3 → Фаза 4 → Фаза 5 → (если нужно больше данных) → Фаза 3 → ...
- **Цикл проверки исправлений**: Фаза 4 → Фаза 5 → Фаза 6 → Фаза 4 → ... до подтверждения решения

### Полный цикл отладки (устаревшее описание)

```typescript
import { injectProbe, removeAllProbesFromFile, getAllProbes } from './code-injector';
import { SharedLogStorage } from './shared-log-storage';
import { SessionManager } from './session-manager';
import { LogExporter } from './log-exporter';

// 1. Создаем сессию
const sessionManager = SessionManager.getInstance();
const sessionId = await sessionManager.createSession('Debug user login');

// 2. Инъектируем пробы
const result1 = await injectProbe('src/auth.py', 42, 'log', 'Checking credentials', undefined, 'H1');
const result2 = await injectProbe('src/auth.py', 58, 'trace', 'User authenticated', undefined, 'H1');

// 3. Запускаем приложение и собираем логи
const storage = SharedLogStorage.getInstance();
const logs = storage.getLogsByHypothesis('H1');
console.log(`Collected ${logs.length} logs for H1`);

// 4. Анализируем результаты
logs.forEach(log => {
  console.log(`[${log.timestamp}] ${log.context}:`, log.data);
});

// 5. Экспортируем логи
const exportedContent = await LogExporter.exportLogs({
  format: 'json',
  includeMetadata: true,
  filterByHypothesis: ['H1']
});
const filePath = await LogExporter.saveToFile(exportedContent, 'json');
console.log(`Logs exported to: ${filePath}`);

// 6. Удаляем все пробы
await removeAllProbesFromFile('src/auth.py');

// 7. Завершаем сессию
await sessionManager.completeSession();
```

---

### Экспорт логов в разных форматах

```typescript
import { LogExporter } from './log-exporter';
import { SharedLogStorage } from './shared-log-storage';

const storage = SharedLogStorage.getInstance();

// Экспорт в JSON
const jsonContent = await LogExporter.exportLogs({
  format: 'json',
  includeMetadata: true
});
await LogExporter.saveToFile(jsonContent, 'json', 'logs.json');

// Экспорт в CSV
const csvContent = await LogExporter.exportLogs({
  format: 'csv',
  filterByHypothesis: ['H1', 'H2']
});
await LogExporter.saveToFile(csvContent, 'csv', 'logs.csv');

// Экспорт в HTML с фильтром по дате
const htmlContent = await LogExporter.exportLogs({
  format: 'html',
  includeMetadata: true,
  dateRange: {
    start: new Date('2024-01-01'),
    end: new Date('2024-12-31')
  }
});
await LogExporter.saveToFile(htmlContent, 'html', 'logs.html');
```

---

### Работа с шифрованием

```typescript
import { 
  generateEncryptionKey, 
  encryptObject, 
  decryptObject, 
  getEncryptionKey 
} from './encryption-utils';

// Генерация нового ключа
const newKey = generateEncryptionKey();

// Использование системного ключа
const key = getEncryptionKey();

// Шифрование объекта
const data = { secret: 'sensitive information' };
const encrypted = encryptObject(data, key);

// Расшифровка объекта
const decrypted = decryptObject(encrypted, key);
console.log(decrypted); // { secret: 'sensitive information' }
```

---

## Лицензия

MIT
