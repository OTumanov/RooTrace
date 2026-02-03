# Task-002: Оптимизировать расчёт размера при обрезке старых логов

**Статус:** [ГОТОВО]

## Что именно нужно сделать

В файле [`src/shared-log-storage.ts`](../src/shared-log-storage.ts) в методе [`addLog()`](../src/shared-log-storage.ts:435-525) оптимизировать расчёт размера при обрезке старых логов (строки 456-463).

**Текущий код:**
```typescript
let removeCount = 0;
let currentSizeAfterRemoval = currentSize;

while (currentSizeAfterRemoval > targetSize && removeCount < this.logs.length) {
    const removedLog = this.logs[removeCount];
    currentSizeAfterRemoval -= JSON.stringify(removedLog).length;  // БЛОКИРУЕТ!
    removeCount++;
}
```

**Проблема:** В цикле вызывается синхронный `JSON.stringify(removedLog)`, что блокирует event loop на каждой итерации. При удалении 1000+ логов это может вызвать задержку на 100-500ms.

**Решение:** Использовать инкрементный кэш размера для каждого лога вместо пересчёта через `JSON.stringify()`.

**Предлагаемая реализация:**

1. Добавить новое поле в класс `SharedLogStorage` для хранения размеров отдельных логов:
```typescript
private logSizeCache: Map<number, number> = new Map();  // индекс лога -> размер в байтах
```

2. Обновить метод `addLog()` для хранения размера каждого лога:
```typescript
const index = this.logs.length;
this.logs.push(log);

// Сохраняем размер лога в кэш
this.logSizeCache.set(index, newLogSize);
```

3. Обновить цикл обрезки для использования кэша:
```typescript
while (currentSizeAfterRemoval > targetSize && removeCount < this.logs.length) {
    const removedLogSize = this.logSizeCache.get(removeCount) ?? 0;
    currentSizeAfterRemoval -= removedLogSize;
    removeCount++;
}
```

4. Обновить метод `rebuildIndexes()` для очистки кэша размеров:
```typescript
private rebuildIndexes(): void {
    this.hypothesisIndex.clear();
    this.timestampIndex.clear();
    this.logSizeCache.clear();  // Очищаем кэш размеров
    
    // ... остальной код rebuildIndexes
}
```

---

## Как протестировать именно этот кусок

### Тест 1: Корректность расчёта размера при обрезке
```typescript
const storage = SharedLogStorage.getInstance();

// Добавляем несколько логов
for (let i = 0; i < 100; i++) {
    await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: `H${i}`,
        context: `Test context ${i}`,
        data: { value: i }
    });
}

// Устанавливаем небольшой лимит для принудительной обрезки
const originalMaxLogs = storage['getMaxLogs']();
// ... эмуляция обрезки ...

// Проверяем, что размер кэша корректен
const logs = storage.getLogs();
const calculatedSize = Array.from(storage['logSizeCache'].values())
    .reduce((sum, size) => sum + size, 0);

console.assert(calculatedSize === storage['logsSizeCache'], 
    `Размер кэша ${calculatedSize} не совпадает с размером логов ${storage['logsSizeCache']}`);
```

### Тест 2: Производительность при обрезке
```typescript
const storage = SharedLogStorage.getInstance();

// Добавляем много логов для создания большой базы
for (let i = 0; i < 10000; i++) {
    await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: `Test ${i}`,
        data: { value: i }
    });
}

// Измеряем время обрезки
const start = Date.now();
await storage.addLog({
    timestamp: new Date().toISOString(),
    hypothesisId: 'H2',
    context: 'Trigger trim',
    data: { trigger: true }
});
const end = Date.now();

// Проверяем, что обрезка не блокирует UI
console.assert((end - start) < 100, `Обрезка заняла ${(end - start)}ms, что может блокировать UI`);
```

### Тест 3: Корректность очистки кэша при rebuildIndexes
```typescript
const storage = SharedLogStorage.getInstance();

// Добавляем логи
await storage.addLog({
    timestamp: new Date().toISOString(),
    hypothesisId: 'H1',
    context: 'Test',
    data: { test: 'data' }
});

// Вызываем rebuildIndexes
storage['rebuildIndexes']();

// Проверяем, что кэш размеров очищен
console.assert(storage['logSizeCache'].size === 0, 'Кэш размеров не очищен после rebuildIndexes');
```

---

## Примечания

- Эта задача зависит от task-001 (должен быть выполнен `calculateLogSize`)
- После выполнения убедитесь, что все тесты проходят
- При обрезке логов необходимо также удалять записи из `logSizeCache`
