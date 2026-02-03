# Task-003: Оптимизировать расчёт размера при ограничении MAX_LOGS

## Что именно нужно сделать

В файле [`src/shared-log-storage.ts`](../src/shared-log-storage.ts) в методе [`addLog()`](../src/shared-log-storage.ts:435-525) оптимизировать расчёт размера при ограничении `MAX_LOGS` (строки 494-509).

**Текущий код:**
```typescript
if (this.logs.length > maxLogs) {
    const removedCount = this.logs.length - maxLogs;
    const removedLogs = this.logs.slice(0, removedCount);
    this.logs = this.logs.slice(-maxLogs);
    
    if (this.logsSizeCache !== null) {
        const removedSize = removedLogs.reduce((sum, log) => sum + JSON.stringify(log).length, 0);  // БЛОКИРУЕТ!
        this.logsSizeCache -= removedSize;
    }
    
    this.rebuildIndexes();
}
```

**Проблема:** Синхронный `JSON.stringify(log)` в `reduce` блокирует event loop. При удалении 1000+ логов это может вызвать задержку на 100-300ms.

**Решение:** Использовать кэш размеров логов `logSizeCache` (созданный в task-002) вместо пересчёта через `JSON.stringify()`.

**Предлагаемая реализация:**

1. Обновить код для использования кэша размеров:
```typescript
if (this.logs.length > maxLogs) {
    const removedCount = this.logs.length - maxLogs;
    const removedLogs = this.logs.slice(0, removedCount);
    this.logs = this.logs.slice(-maxLogs);
    
    // Используем кэш размеров вместо JSON.stringify
    if (this.logsSizeCache !== null) {
        const removedSize = Array.from({ length: removedCount }, (_, i) => 
            this.logSizeCache.get(i) ?? 0
        ).reduce((sum, size) => sum + size, 0);
        this.logsSizeCache -= removedSize;
    }
    
    this.rebuildIndexes();
}
```

2. Обновить метод `rebuildIndexes()` для пересчёта `logSizeCache` после обрезки:
```typescript
private rebuildIndexes(): void {
    this.hypothesisIndex.clear();
    this.timestampIndex.clear();
    this.logSizeCache.clear();
    
    this.logs.forEach((log, index) => {
        // ... существующий код для hypothesisIndex и timestampIndex
        
        // Пересчитываем размер для каждого лога (асинхронно не требуется, так как это редкая операция)
        this.logSizeCache.set(index, JSON.stringify(log).length);
    });
    
    this.logsSizeCache = null;  // Сбрасываем кэш общего размера
}
```

---

## Как протестировать именно этот кусок

### Тест 1: Корректность расчёта размера при ограничении MAX_LOGS
```typescript
const storage = SharedLogStorage.getInstance();

// Добавляем логи больше лимита (предположим MAX_LOGS = 1000)
for (let i = 0; i < 1500; i++) {
    await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: `Test ${i}`,
        data: { value: i }
    });
}

// Проверяем, что количество логов не превышает лимит
const logs = storage.getLogs();
const maxLogs = storage['getMaxLogs']();
console.assert(logs.length <= maxLogs, `Количество логов ${logs.length} превышает лимит ${maxLogs}`);

// Проверяем, что размер кэша корректен
const calculatedSize = Array.from(storage['logSizeCache'].values())
    .reduce((sum, size) => sum + size, 0);
console.assert(calculatedSize === storage['logsSizeCache'], 
    `Размер кэша ${calculatedSize} не совпадает с размером логов ${storage['logsSizeCache']}`);
```

### Тест 2: Производительность при ограничении MAX_LOGS
```typescript
const storage = SharedLogStorage.getInstance();

// Добавляем много логов для превышения лимита
for (let i = 0; i < 2000; i++) {
    await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: `Test ${i}`,
        data: { value: i }
    });
}

// Измеряем время добавления лога, который вызывает обрезку
const start = Date.now();
await storage.addLog({
    timestamp: new Date().toISOString(),
    hypothesisId: 'H2',
    context: 'Trigger MAX_LOGS limit',
    data: { trigger: true }
});
const end = Date.now();

// Проверяем, что обрезка не блокирует UI
console.assert((end - start) < 100, `Ограничение MAX_LOGS заняло ${(end - start)}ms, что может блокировать UI`);
```

### Тест 3: Корректность индексов после обрезки
```typescript
const storage = SharedLogStorage.getInstance();

// Добавляем логи
for (let i = 0; i < 1500; i++) {
    await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: `H${i % 10}`,
        context: `Test ${i}`,
        data: { value: i }
    });
}

// Проверяем, что индексы корректны
const logs = storage.getLogs();
const hypothesisIndex = storage['hypothesisIndex'];
const timestampIndex = storage['timestampIndex'];

// Проверяем, что все индексы соответствуют текущим логам
console.assert(hypothesisIndex.size > 0, 'Индекс гипотез пуст после обрезки');
console.assert(timestampIndex.size > 0, 'Индекс временных меток пуст после обрезки');
```

---

## Примечания

- Эта задача зависит от task-002 (должен быть создан `logSizeCache`)
- После выполнения убедитесь, что все тесты проходят
- Проверьте, что `rebuildIndexes()` корректно пересчитывает все индексы
