# Task-005: Оптимизировать writeJSONStream для предотвращения блокировок в цикле

## Что именно нужно сделать

В файле [`src/streaming-json.ts`](../src/streaming-json.ts) в функции [`writeJSONStream()`](../src/streaming-json.ts) оптимизировать обработку элементов в цикле для предотвращения блокировок event loop.

**Текущий код (строки 411-438):**
```typescript
const processItems = async () => {
    try {
        for await (const item of items) {
            const separator = isFirstItem ? '' : ',';
            const jsonString = pretty ? 
              `${separator}\n${JSON.stringify(item, null, 2)}` : 
              `${separator}${JSON.stringify(item)}`;  // БЛОКИРУЕТ!
            
            if (!writeStream.write(jsonString)) {
                await new Promise<void>((resolveDrain) => {
                    writeStream.once('drain', resolveDrain);
                });
            }
            
            itemCount++;
            isFirstItem = false;
        }
        
        writeStream.write(pretty ? '\n]' : ']');
        writeStream.end();
    } catch (error) {
        writeStream.destroy();
        fs.unlink(tempPath, () => {});
        reject(new Error(`Failed to write array items: ${error instanceof Error ? error.message : String(error)}`));
    }
};
```

**Проблема:** `JSON.stringify(item)` в цикле блокирует event loop на каждой итерации. При записи 10k+ элементов это может вызвать задержку на 100-300ms.

**Решение:** Использовать `setImmediate()` для разблокировки event loop между итерациями цикла.

**Предлагаемая реализация:**

1. Обновить функцию `processItems` для использования `setImmediate()`:
```typescript
const processItems = async () => {
    try {
        let processedCount = 0;
        const BATCH_SIZE = 100;  // Обрабатываем по 100 элементов за раз
        
        for await (const item of items) {
            const separator = isFirstItem ? '' : ',';
            const jsonString = pretty ? 
              `${separator}\n${JSON.stringify(item, null, 2)}` : 
              `${separator}${JSON.stringify(item)}`;
            
            if (!writeStream.write(jsonString)) {
                await new Promise<void>((resolveDrain) => {
                    writeStream.once('drain', resolveDrain);
                });
            }
            
            itemCount++;
            isFirstItem = false;
            processedCount++;
            
            // Разблокируем event loop каждые BATCH_SIZE элементов
            if (processedCount % BATCH_SIZE === 0) {
                await new Promise<void>((resolve) => setImmediate(resolve));
            }
        }
        
        writeStream.write(pretty ? '\n]' : ']');
        writeStream.end();
    } catch (error) {
        writeStream.destroy();
        fs.unlink(tempPath, () => {});
        reject(new Error(`Failed to write array items: ${error instanceof Error ? error.message : String(error)}`));
    }
};
```

2. Добавить опцию для настройки размера батча:
```typescript
export interface WriteJSONStreamOptions {
    pretty?: boolean;
    encoding?: BufferEncoding;
    mode?: number;
    /**
     * Количество элементов для обработки перед разблокировкой event loop (по умолчанию 100)
     */
    batchSize?: number;
}
```

3. Обновить функцию `writeJSONStream` для использования новой опции:
```typescript
export async function writeJSONStream<T = any>(
    filePath: string,
    data: T,
    options: WriteJSONStreamOptions = {}
): Promise<number> {
    const {
        pretty = true,
        encoding = 'utf-8',
        mode = 0o644,
        batchSize = 100
    } = options;
    
    // ... остальной код функции
    
    // Используем batchSize в processItems
    const processItems = async () => {
        // ... код с использованием batchSize
    };
}
```

---

## Как протестировать именно этот кусок

### Тест 1: Базовый функционал записи
```typescript
import { writeJSONStream } from '../src/streaming-json';

const testData = Array(100).fill({ 
    timestamp: new Date().toISOString(),
    hypothesisId: 'H1',
    context: 'Test',
    data: { value: 42 }
});

const testPath = '/tmp/test-streaming-write.json';

// Записываем данные
const itemCount = await writeJSONStream(testPath, testData);

// Проверяем, что количество записанных элементов совпадает
console.assert(itemCount === 100, `Записано ${itemCount} элементов вместо 100`);

// Проверяем, что файл существует и содержит корректные данные
const fs = require('fs');
const content = fs.readFileSync(testPath, 'utf-8');
const parsed = JSON.parse(content);

console.assert(parsed.length === 100, 'Количество элементов в файле не совпадает');

// Удаляем тестовый файл
fs.unlinkSync(testPath);
```

### Тест 2: Производительность на больших данных
```typescript
const largeData = Array(10000).fill({ 
    timestamp: new Date().toISOString(),
    hypothesisId: 'H1',
    context: 'Test',
    data: { value: 42 }
});

const testPath = '/tmp/test-large-streaming-write.json';

// Измеряем время записи
const start = Date.now();
const itemCount = await writeJSONStream(testPath, largeData);
const end = Date.now();

// Проверяем, что запись не блокирует UI
console.assert((end - start) < 300, `Запись заняла ${(end - start)}ms, что может блокировать UI`);

// Проверяем корректность данных
const fs = require('fs');
const content = fs.readFileSync(testPath, 'utf-8');
const parsed = JSON.parse(content);

console.assert(parsed.length === 10000, 'Количество элементов не совпадает');

// Удаляем тестовый файл
fs.unlinkSync(testPath);
```

### Тест 3: Проверка разблокировки event loop
```typescript
const largeData = Array(5000).fill({ 
    timestamp: new Date().toISOString(),
    hypothesisId: 'H1',
    context: 'Test',
    data: { value: 42 }
});

const testPath = '/tmp/test-event-loop.json';

// Отслеживаем время между итерациями
const timestamps: number[] = [];
const originalSetImmediate = global.setImmediate;
global.setImmediate = (callback: (...args: any[]) => void) => {
    timestamps.push(Date.now());
    return originalSetImmediate(callback);
};

// Записываем данные
await writeJSONStream(testPath, largeData, { batchSize: 100 });

// Восстанавливаем оригинальный setImmediate
global.setImmediate = originalSetImmediate;

// Проверяем, что event loop разблокировался несколько раз
console.assert(timestamps.length > 10, `Event loop разблокировался только ${timestamps.length} раз`);

// Проверяем, что интервалы между разблокировками достаточно малы
for (let i = 1; i < timestamps.length; i++) {
    const interval = timestamps[i] - timestamps[i - 1];
    console.assert(interval < 50, `Интервал ${interval}ms между разблокировками слишком велик`);
}

// Удаляем тестовый файл
const fs = require('fs');
fs.unlinkSync(testPath);
```

---

## Примечания

- Эта задача зависит от task-004 (должен быть обновлён `atomicWriteJson`)
- После выполнения убедитесь, что все тесты проходят
- Проверьте, что настройка `batchSize` работает корректно
- Убедитесь, что производительность улучшилась на больших данных
