# Task-006: Добавить асинхронный расчёт размера логов без JSON.stringify

## Что именно нужно сделать

В файле [`src/shared-log-storage.ts`](../src/shared-log-storage.ts) добавить асинхронный метод для расчёта общего размера логов без использования синхронного `JSON.stringify()`.

**Проблема:** В методе `addLog()` на строке 447 используется синхронный `JSON.stringify(this.logs).length` для расчёта текущего размера, когда кэш не инициализирован. Это блокирует event loop на 100-500ms для больших массивов логов.

**Текущий код (строка 447):**
```typescript
const currentSize = this.logsSizeCache ?? JSON.stringify(this.logs).length;  // БЛОКИРУЕТ!
```

**Решение:** Создать асинхронный метод для расчёта размера с использованием `setImmediate()` для разблокировки event loop.

**Предлагаемая реализация:**

1. Добавить новый метод в класс `SharedLogStorage`:
```typescript
/**
 * Асинхронно вычисляет общий размер всех логов в байтах
 * Использует setImmediate для предотвращения блокировки event loop
 * Обрабатывает логи батчами для улучшения производительности
 */
private async calculateTotalLogsSize(): Promise<number> {
    if (this.logs.length === 0) {
        return 0;
    }
    
    return new Promise((resolve) => {
        let totalSize = 0;
        let index = 0;
        const BATCH_SIZE = 100;
        
        const processBatch = () => {
            const endIndex = Math.min(index + BATCH_SIZE, this.logs.length);
            
            for (; index < endIndex; index++) {
                totalSize += JSON.stringify(this.logs[index]).length;
            }
            
            if (index < this.logs.length) {
                // Продолжаем обработку следующего батча
                setImmediate(processBatch);
            } else {
                // Завершаем обработку
                resolve(totalSize);
            }
        };
        
        // Начинаем обработку
        setImmediate(processBatch);
    });
}
```

2. Обновить метод `addLog()` для использования асинхронного расчёта:
```typescript
async addLog(log: RuntimeLog): Promise<void> {
    logDebug(`addLog called: hypothesisId=${log.hypothesisId}, context=${log.context}`, 'SharedLogStorage.addLog');
    try {
        // Синхронизируемся перед добавлением
        await this.loadFromFile();
        logDebug(`After loadFromFile: ${this.logs.length} logs in memory`, 'SharedLogStorage.addLog');
        
        // БЕЗОПАСНОСТЬ: Проверяем размер логов перед добавлением
        const maxLogs = this.getMaxLogs();
        const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB лимит
        
        // Используем асинхронный расчёт размера вместо синхронного
        const currentSize = this.logsSizeCache ?? await this.calculateTotalLogsSize();
        const newLogSize = await this.calculateLogSize(log);
        const estimatedSize = currentSize + newLogSize;
        
        // ... остальной код метода
    } catch (error) {
        handleError(error, 'SharedLogStorage.addLog', { 
            hypothesisId: log.hypothesisId,
            context: log.context 
        });
        throw error;
    }
}
```

3. Обновить метод `loadFromFile()` для инициализации кэша размера:
```typescript
private async loadFromFile(): Promise<void> {
    // ... существующий код загрузки логов
    
    // Инициализируем кэш размера асинхронно
    if (this.logsSizeCache === null) {
        this.logsSizeCache = await this.calculateTotalLogsSize();
    }
}
```

---

## Как протестировать именно этот кусок

### Тест 1: Корректность расчёта размера
```typescript
const storage = SharedLogStorage.getInstance();

// Добавляем несколько логов
const testLogs = [
    { timestamp: new Date().toISOString(), hypothesisId: 'H1', context: 'Test 1', data: { value: 1 } },
    { timestamp: new Date().toISOString(), hypothesisId: 'H2', context: 'Test 2', data: { value: 2 } },
    { timestamp: new Date().toISOString(), hypothesisId: 'H3', context: 'Test 3', data: { value: 3 } }
];

for (const log of testLogs) {
    await storage.addLog(log);
}

// Проверяем, что размер вычисляется корректно
const calculatedSize = await storage['calculateTotalLogsSize']();
const expectedSize = JSON.stringify(testLogs).length;

console.assert(calculatedSize === expectedSize, 
    `Размер ${calculatedSize} не совпадает с ожидаемым ${expectedSize}`);
```

### Тест 2: Производительность на больших данных
```typescript
const storage = SharedLogStorage.getInstance();

// Добавляем много логов
for (let i = 0; i < 5000; i++) {
    await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: `Test ${i}`,
        data: { value: i }
    });
}

// Сбрасываем кэш для принудительного пересчёта
storage['logsSizeCache'] = null;

// Измеряем время расчёта
const start = Date.now();
const size = await storage['calculateTotalLogsSize']();
const end = Date.now();

// Проверяем, что расчёт не блокирует UI
console.assert((end - start) < 200, `Расчёт занял ${(end - start)}ms, что может блокировать UI`);

// Проверяем, что размер корректен
console.assert(size > 0, 'Размер логов равен 0');
```

### Тест 3: Интеграция с addLog
```typescript
const storage = SharedLogStorage.getInstance();

// Сбрасываем кэш для принудительного пересчёта
storage['logsSizeCache'] = null;

// Добавляем лог через addLog
const start = Date.now();
await storage.addLog({
    timestamp: new Date().toISOString(),
    hypothesisId: 'H1',
    context: 'Integration test',
    data: { test: 'data' }
});
const end = Date.now();

// Проверяем, что добавление не блокирует UI
console.assert((end - start) < 100, `Добавление лога заняло ${(end - start)}ms, что может блокировать UI`);

// Проверяем, что кэш размера обновлён
console.assert(storage['logsSizeCache'] !== null, 'Кэш размера не обновлён');
```

---

## Примечания

- Эта задача зависит от task-001 (должен быть создан `calculateLogSize`)
- После выполнения убедитесь, что все тесты проходят
- Проверьте, что `BATCH_SIZE = 100` обеспечивает хороший баланс между производительностью и разблокировкой event loop
- Убедитесь, что кэш размера корректно инициализируется в `loadFromFile()`
