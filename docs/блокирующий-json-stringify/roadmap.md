# Roadmap: Блокирующий JSON.stringify на больших логах

## Описание проблемы

В файле [`src/shared-log-storage.ts`](../src/shared-log-storage.ts) используется [`VersionedLogStore.mergeLogs()`](../src/versioned-logs.ts) с опцией `useStreaming: true` (строки 304-351). Однако метод [`addLog()`](../src/shared-log-storage.ts:435-525) блокируется на `await this.saveToFileWithMvcc(this.logs)` (строка 512).

Есть синхронные вызовы `JSON.stringify()` в [`addLog()`](../src/shared-log-storage.ts:435-525):
- Строка 447: `const currentSize = this.logsSizeCache ?? JSON.stringify(this.logs).length;`
- Строка 448: `const newLogSize = JSON.stringify(log).length;`
- Строка 461: `currentSizeAfterRemoval -= JSON.stringify(removedLog).length;`
- Строка 503: `const removedSize = removedLogs.reduce((sum, log) => sum + JSON.stringify(log).length, 0);`

Эти синхронные вызовы могут блокировать UI на 200-500ms при больших логах (10k+ записей).

---

## Список задач

| ID | Задача | Статус | Зависимости |
|----|--------|--------|-------------|
| [task-001](./task-001.md) | Заменить синхронный JSON.stringify для расчёта размера нового лога | [ГОТОВО] | - |
| [task-002](./task-002.md) | Оптимизировать расчёт размера при обрезке старых логов | [ГОТОВО] | task-001 |
| [task-003](./task-003.md) | Оптимизировать расчёт размера при ограничении MAX_LOGS | [НЕТ] | task-002 |
| [task-004](./task-004.md) | Заменить синхронный JSON.stringify в atomicWriteJson на потоковую запись | [НЕТ] | task-003 |
| [task-005](./task-005.md) | Оптимизировать writeJSONStream для предотвращения блокировок в цикле | [НЕТ] | task-004 |
| [task-006](./task-006.md) | Добавить асинхронный расчёт размера логов без JSON.stringify | [НЕТ] | task-005 |
| [task-007](./task-007.md) | Оптимизировать mergeLogs для использования асинхронных операций | [НЕТ] | task-006 |

---

## Легенда статусов

- **[НЕТ]** — задача не начата
- **[В ПРОЦЕССЕ]** — задача в работе
- **[ГОТОВО]** — задача завершена
- **[ПРОВАЛ]** — задача не удалась

---

## Приоритеты

1. **Критические**: task-001, task-002, task-003 — прямые блокирующие вызовы в `addLog()`
2. **Высокие**: task-004, task-005 — улучшение производительности записи
3. **Средние**: task-006, task-007 — дополнительные оптимизации

---

## Примечания

- Все задачи должны быть независимо тестируемы
- После выполнения каждой задачи необходимо запускать тесты
- При необходимости можно добавить дополнительные задачи в процессе работы
