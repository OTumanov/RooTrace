# Руководство разработчика RooTrace

## Содержание

1. [Отладка расширения](#отладка-расширения)
2. [Тестирование](#тестирование)
3. [Валидация синтаксиса](#валидация-синтаксиса)
4. [Разработка новых функций](#разработка-новых-функций)

---

## Отладка расширения

### Проблема: Расширение не активируется

**Симптомы:**
- Канал "AI Debugger" отсутствует в Output Panel
- В логах VSCode нет упоминаний о RooTrace
- MCP сервер не регистрируется

**Диагностика:**

1. **Проверьте Developer Console:**
   ```
   Help → Toggle Developer Tools → Console
   ```
   Должны быть видны логи `[RooTrace] Extension ACTIVATING...`

2. **Проверьте установку расширения:**
   ```bash
   code --list-extensions | grep -i roo
   ```

3. **Попробуйте принудительную активацию:**
   - `Cmd+Shift+P` → `RooTrace: Start Server`

4. **Проверьте файлы расширения:**
   ```bash
   find ~/.vscode/extensions -name "roo-trace*" -type d
   ls -la ~/.vscode/extensions/*roo-trace*/out/
   ```

5. **Переустановите расширение:**
   ```bash
   npm run compile && vsce package
   ```

### Проверка компиляции

```bash
cd /path/to/RooTrace
npm run compile
ls -la out/
```

Должны быть файлы:
- `out/extension.js`
- `out/mcp-server.js`
- `out/mcp-handler.js`
- и другие

### Проверка конфигурации

После активации проверьте:
```bash
# MCP конфигурация
cat .roo/mcp.json

# Роль
cat .roomodes
```

### Частые проблемы

1. **Ошибка: "Cannot find module 'js-yaml'"**
   - Решение: Добавлен `js-yaml` в `dependencies` в `package.json`
   - Действие: Пересоберите и переустановите расширение

2. **Воркспейс не открыт**
   - Решение: Откройте папку проекта (File → Open Folder)

3. **Файлы не скомпилированы**
   - Решение: Запустите `npm run compile`

---

## Тестирование

### Тестирование интеграции AI Debugger

**Цель:** Проверить, что все компоненты работают вместе корректно.

**Тестовый сценарий:**

1. **Подготовка:**
   - Убедитесь, что расширение RooTrace запущено
   - Откройте папку с проектом в VSCode
   - Активируйте режим AI Debugger

2. **Тест 1: Загрузка промпта**
   - Проверьте, что RoleManager загружает инструкции из `prompts/ai-debugger-prompt.md`
   - Убедитесь, что инструкции содержат упоминание о кнопках

3. **Тест 2: Интерфейс панели отладки**
   - Запустите команду `ai-debugger.openDashboard`
   - Проверьте наличие кнопок: Run & Reproduce, Analyze Logs, Confirm Fix, Clear Logs

4. **Тест 3: Работа кнопок**
   - Нажмите кнопку "Run & Reproduce" → должно появиться сообщение с инструкцией
   - Нажмите кнопку "Analyze Logs" → должен вызваться соответствующий MCP-инструмент
   - Нажмите кнопку "Confirm Fix" → должна вызваться команда очистки сессии

5. **Тест 4: Инъекция проб**
   - Проверьте, что пробы вставляются с UUID-маркерами
   - Проверьте, что при ошибке синтаксиса файл откатывается
   - Проверьте, что пробы удаляются точно через UUID-маркеры

6. **Тест 5: Железный мост**
   - Запустите HTTP-сервер и отправьте логи
   - Проверьте, что MCP-сервер видит логи через `fs.watchFile`
   - Проверьте, что файловые блокировки предотвращают race conditions

### Unit-тесты

```bash
npm test
```

### Интеграционные тесты

```bash
npm run test:integration
```

---

## Валидация синтаксиса

### Поддерживаемые языки

**Полная поддержка (с проверкой синтаксиса):**
- Python (py) - `python3 -m py_compile`
- JavaScript (js, jsx) - `node --check`
- TypeScript (ts, tsx) - `tsc --noEmit` или `node --check` как fallback
- Java - `javac -Xlint:all`
- Go - `go build`
- Rust (rs) - `rustc --crate-type lib`
- C++ (cpp, cxx, cc) - `g++` или `clang++` с `-fsyntax-only`
- PHP - `php -l`
- Ruby (rb) - `ruby -c`
- C# (cs) - `dotnet build` или `csc`
- Swift - `swiftc -typecheck`
- Kotlin (kt, kts) - `kotlinc -script`

### Настройки

В VS Code Settings:
- **`rooTrace.enableSyntaxValidation`** (boolean, default: `true`) - Включить/выключить валидацию
- **`rooTrace.syntaxCheckTimeout`** (number, default: `10000`) - Таймаут в миллисекундах (1000-60000)

### Как это работает

1. После инъекции пробы записывается измененное содержимое в файл
2. Автоматически запускается проверка синтаксиса
3. **Автоматический Rollback**: Если проверка провалилась, файл автоматически откатывается
4. Результаты возвращаются в `InjectionResult.syntaxCheck`

### Пример использования

```typescript
const result = await injectProbe('src/app.py', 42, 'log', 'Test probe');

if (result.syntaxCheck) {
  if (result.syntaxCheck.passed) {
    console.log('✅ Syntax check passed');
  } else {
    console.error('❌ Syntax errors detected:');
    result.syntaxCheck.errors?.forEach(error => console.error(error));
    // Файл уже автоматически откачен к исходному состоянию
    if (result.rollback) {
      console.log('✅ File automatically rolled back');
    }
  }
}
```

### Обработка ошибок

- Если компилятор/интерпретатор не найден в PATH, проверка пропускается с предупреждением
- Если проверка занимает больше времени, чем указано в `syntaxCheckTimeout`, она прерывается
- Ошибки компиляции (например, отсутствие зависимостей) не считаются синтаксическими ошибками

---

## Разработка новых функций

### Добавление нового MCP-инструмента

1. Добавьте инструмент в `mcp-handler.ts`:
```typescript
case 'new_tool': {
  // Реализация
  break;
}
```

2. Обновите список инструментов в `start()`:
```typescript
const tools = [
  // ...
  {
    name: 'new_tool',
    description: 'Описание инструмента',
    inputSchema: { /* схема */ }
  }
];
```

3. Обновите документацию в `ARCHITECTURE.md`

### Добавление поддержки нового языка

1. Добавьте проверку синтаксиса в `code-injector.ts`:
```typescript
case 'newlang': {
  // Проверка синтаксиса
  break;
}
```

2. Добавьте генерацию кода пробы в `generateProbeCode()`:
```typescript
case 'newlang': {
  return `// Код пробы для нового языка`;
}
```

3. Обновите документацию в `DEVELOPER.md`

### Модульная архитектура

**Модули:**
- `code-injector.ts` — инъекция проб с UUID-маркерами и rollback
- `session-manager.ts` — управление сессиями
- `log-exporter.ts` — экспорт логов
- `shared-log-storage.ts` — хранение данных с файловыми блокировками
- `mcp-handler.ts` — обработка MCP запросов
- `mcp-registration.ts` — регистрация MCP сервера
- `file-lock-utils.ts` — файловые блокировки

**Принципы:**
- Разделение ответственности
- Упрощение тестирования
- Возможность переиспользования

---

## Рекомендации

1. **Всегда используйте файловые блокировки** для операций с файлами
2. **Всегда добавляйте UUID-маркеры** для новых типов проб
3. **Всегда проверяйте синтаксис** после инъекции проб
4. **Всегда используйте асинхронные операции** для I/O
5. **Всегда валидируйте пользовательские данные** перед использованием
