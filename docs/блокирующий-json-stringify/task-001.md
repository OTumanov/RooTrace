# Task-001: Заменить синхронный JSON.stringify для расчёта размера нового лога

**Статус:** [ГОТОВО]

## Что именно нужно сделать

В файле [`src/shared-log-storage.ts`](../src/shared-log-storage.ts) в методе [`addLog()`](../src/shared-log-storage.ts:435-525) заменить синхронный вызов `JSON.stringify(log)` на асинхронный расчёт размера.

**Текущий код (строки 447-448):**
```typescript
const currentSize = this.logsSizeCache ?? JSON.stringify(this.logs).length;
const newLogSize = JSON.stringify(log).length;
```

**Проблема:** `JSON.stringify(log)` блокирует event loop, что может вызвать задержку UI на 50-100ms для больших логов.

**Решение:** Создать асинхронную функцию для расчёта размера лога без использования синхронного `JSON.stringify()`.

**Предлагаемая реализация:**

1. Создать новый метод в `SharedLogStorage`:
```typescript
/**
 * Асинхронно вычисляет размер лога в байтах
 * Использует setImmediate для предотвращения блокировки event loop
 */
private async calculateLogSize(log: RuntimeLog): Promise<number> {
    return new Promise((resolve) => {
        setImmediate(() => {
            const size = JSON.stringify(log).length;
            resolve(size);
        });
    });
}
```

2. Обновить метод `addLog()` для использования асинхронного расчёта:
```typescript
const currentSize = this.logsSizeCache ?? 0;
const newLogSize = await this.calculateLogSize(log);
const estimatedSize = currentSize + newLogSize;
```

---

## Как протестировать именно этот кусок

### Тест 1: Базовый функционал
```typescript
// Создаём тестовый лог
const testLog: RuntimeLog = {
    timestamp: new Date().toISOString(),
    hypothesisId: 'H1',
    context: 'Test context',
    data: { result: 42, nested: { value: 'test' } }
};

// Проверяем, что размер вычисляется корректно
const storage = SharedLogStorage.getInstance();
const size = await storage['calculateLogSize'](testLog);
const expectedSize = JSON.stringify(testLog).length;

console.assert(size === expectedSize, `Размер ${size} не совпадает с ожидаемым ${expectedSize}`);
```

### Тест 2: Производительность (нет блокировки)
```typescript
// Создаём большой лог
const largeLog: RuntimeLog = {
    timestamp: new Date().toISOString(),
    hypothesisId: 'H1',
    context: 'Large log test',
    data: { array: Array(10000).fill({ key: 'value' }) }
};

// Измеряем время до и после вызова
const start = Date.now();
const size = await storage['calculateLogSize'](largeLog);
const end = Date.now();

// Проверяем, что event loop не блокируется
console.assert((end - start) < 50, `Расчёт занял ${(end - start)}ms, что может блокировать UI`);
```

### Тест 3: Интеграция с addLog
```typescript
// Добавляем лог через addLog
const storage = SharedLogStorage.getInstance();
await storage.addLog({
    timestamp: new Date().toISOString(),
    hypothesisId: 'H1',
    context: 'Integration test',
    data: { test: 'data' }
});

// Проверяем, что лог добавлен и размер кэша обновлён
const logs = storage.getLogs();
console.assert(logs.length > 0, 'Лог не был добавлен');
console.assert(storage['logsSizeCache'] !== null, 'Кэш размера не обновлён');
```

---

## Примечания

- После выполнения этой задачи необходимо убедиться, что все существующие тесты проходят
- Если тесты используют синхронные вызовы `addLog()`, их нужно обновить для использования `await`
