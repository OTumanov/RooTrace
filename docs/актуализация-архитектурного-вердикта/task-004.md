# Задача 004: Проверить статус блокирующего JSON.stringify

## Что нужно проверить

Проверить файл [`src/shared-log-storage.ts`](../../src/shared-log-storage.ts) на наличие исправления блокирующего JSON.stringify.

**Конкретные проверки:**
1. Метод `VersionedLogStore.mergeLogs()` использует опцию `useStreaming: true`
2. Метод `addLog()` не блокируется на `await this.saveToFileWithMvcc(this.logs)`
3. Нет синхронных вызовов `JSON.stringify()` в `addLog()`
4. Все операции сериализации асинхронные

## Как протестировать

### Тест 1: Проверка блокировки event loop
```bash
# Запустить тест
npm test -- tests/event-loop-blocking-check.test.ts
```

### Тест 2: Тест с большими логами
```bash
# Создать тест с 10000 записей
node -e "
const storage = require('./src/shared-log-storage.ts');
// Добавить 10000 записей
// Замерить время выполнения
// Проверить что event loop не блокируется
"
```

**Лимит:** Макс. 100 строк лога или 30 секунд выполнения

**Ожидаемый результат:** Event loop не блокируется, операции асинхронные
