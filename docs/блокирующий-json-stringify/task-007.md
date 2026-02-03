# Task-007: Оптимизировать mergeLogs для использования асинхронных операций

## Что именно нужно сделать

В файле [`src/versioned-logs.ts`](../src/versioned-logs.ts) оптимизировать метод [`mergeLogs()`](../src/versioned-logs.ts) для использования асинхронных операций и предотвращения блокировок event loop.

**Проблема:** Метод `mergeLogs()` может содержать синхронные операции, которые блокируют event loop при слиянии больших массивов логов (10k+ записей).

**Текущий код (пример из строк 445-458):**
```typescript
if (useStreaming) {
    await writeJSONStream(filePath, versionedLogs, {
        pretty: true,
        encoding: 'utf-8',
        mode: 0o644
    });
} else {
    // Атомарно записываем в файл
    await atomicWriteJson(filePath, versionedLogs, {
        encoding: 'utf-8',
        cleanupOldTempFiles: 3600000,
        mode: 0o644
    });
}
```

**Решение:** Оптимизировать логику слияния для использования асинхронных операций и предотвращения блокировок.

**Предлагаемая реализация:**

1. Добавить асинхронный метод для слияния логов с разблокировкой event loop:
```typescript
/**
 * Асинхронно объединяет массивы логов с использованием setImmediate
 * для предотвращения блокировки event loop
 */
private static async mergeLogsWithoutBlocking(
    existingLogs: RuntimeLog[],
    newLogs: RuntimeLog[]
): Promise<RuntimeLog[]> {
    return new Promise((resolve) => {
        const merged = [...existingLogs, ...newLogs];
        let index = 0;
        const BATCH_SIZE = 100;
        
        const processBatch = () => {
            const endIndex = Math.min(index + BATCH_SIZE, merged.length);
            
            // Обрабатываем батч (можно добавить логику дедупликации)
            for (; index < endIndex; index++) {
                // Здесь можно добавить логику слияния/дедупликации
                // Например, проверка на дубликаты по timestamp и hypothesisId
            }
            
            if (index < merged.length) {
                // Продолжаем обработку следующего батча
                setImmediate(processBatch);
            } else {
                // Завершаем обработку
                resolve(merged);
            }
        };
        
        // Начинаем обработку
        setImmediate(processBatch);
    });
}
```

2. Обновить метод `mergeLogs()` для использования асинхронного слияния:
```typescript
static async mergeLogs(
    filePath: string,
    newLogs: RuntimeLog[],
    strategy: 'smart' | 'append' | 'replace' = 'smart',
    options: MergeOptions = {}
): Promise<MergeResult> {
    const {
        useStreaming = false,
        incrementVersion = true,
        useLock = true,
        lockTimeout = 30000,
        lockPriority = 'normal'
    } = options;
    
    const mergeOperation = async (): Promise<MergeResult> => {
        try {
            // Читаем существующие логи
            const readResult = await this.readLatestVersion(filePath, {
                validateHash: true,
                useLock: false,
                useStreaming: useStreaming
            });
            
            let mergedLogs: RuntimeLog[];
            let conflictResolved = false;
            
            if (strategy === 'replace') {
                mergedLogs = newLogs;
            } else if (strategy === 'append') {
                // Используем асинхронное слияние без блокировки
                mergedLogs = await this.mergeLogsWithoutBlocking(readResult.logs, newLogs);
            } else {
                // Smart стратегия с дедупликацией
                mergedLogs = await this.mergeLogsWithoutBlocking(readResult.logs, newLogs);
                // Добавляем логику дедупликации
                const seen = new Set<string>();
                const deduplicated: RuntimeLog[] = [];
                
                for (const log of mergedLogs) {
                    const key = `${log.timestamp}-${log.hypothesisId}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        deduplicated.push(log);
                    } else {
                        conflictResolved = true;
                    }
                }
                
                mergedLogs = deduplicated;
            }
            
            // Создаём версионированные логи
            const versionedLogs: VersionedLogs = {
                logs: mergedLogs,
                version: readResult.metadata.version + (incrementVersion ? 1 : 0),
                versionId: this.generateVersionId(),
                hash: this.calculateHash(mergedLogs),
                timestamp: new Date().toISOString(),
                previousHash: readResult.metadata.hash
            };
            
            // Записываем в файл
            if (useStreaming) {
                await writeJSONStream(filePath, versionedLogs, {
                    pretty: true,
                    encoding: 'utf-8',
                    mode: 0o644
                });
            } else {
                await atomicWriteJson(filePath, versionedLogs, {
                    encoding: 'utf-8',
                    cleanupOldTempFiles: 3600000,
                    mode: 0o644
                });
            }
            
            return {
                mergedLogs,
                version: versionedLogs.version,
                versionId: versionedLogs.versionId,
                hash: versionedLogs.hash,
                conflictResolved
            };
        } catch (error) {
            handleError(error, 'VersionedLogStore.mergeLogs', {
                filePath,
                newLogsCount: newLogs.length,
                strategy,
                useStreaming
            });
            throw error;
        }
    };
    
    // Используем блокировку если требуется
    if (useLock) {
        return withFileLock(filePath, mergeOperation, {
            timeout: lockTimeout,
            priority: lockPriority
        });
    } else {
        return mergeOperation();
    }
}
```

---

## Как протестировать именно этот кусок

### Тест 1: Базовый функционал слияния
```typescript
import { VersionedLogStore } from '../src/versioned-logs';

const existingLogs = [
    { timestamp: '2024-01-01T00:00:00.000Z', hypothesisId: 'H1', context: 'Test 1', data: {} },
    { timestamp: '2024-01-01T00:01:00.000Z', hypothesisId: 'H2', context: 'Test 2', data: {} }
];

const newLogs = [
    { timestamp: '2024-01-01T00:02:00.000Z', hypothesisId: 'H3', context: 'Test 3', data: {} },
    { timestamp: '2024-01-01T00:03:00.000Z', hypothesisId: 'H4', context: 'Test 4', data: {} }
];

const testPath = '/tmp/test-merge-logs.json';

// Сливаем логи
const result = await VersionedLogStore.mergeLogs(testPath, newLogs, 'append', {
    useStreaming: true
});

// Проверяем, что все логи слиты
console.assert(result.mergedLogs.length === 4, `Слито ${result.mergedLogs.length} логов вместо 4`);

// Проверяем, что версия увеличилась
console.assert(result.version > 0, `Версия ${result.version} не увеличилась`);

// Удаляем тестовый файл
const fs = require('fs');
fs.unlinkSync(testPath);
```

### Тест 2: Производительность на больших данных
```typescript
const existingLogs = Array(5000).fill(null).map((_, i) => ({
    timestamp: new Date(i).toISOString(),
    hypothesisId: 'H1',
    context: `Existing ${i}`,
    data: { value: i }
}));

const newLogs = Array(5000).fill(null).map((_, i) => ({
    timestamp: new Date(i + 5000).toISOString(),
    hypothesisId: 'H2',
    context: `New ${i}`,
    data: { value: i }
}));

const testPath = '/tmp/test-large-merge-logs.json';

// Измеряем время слияния
const start = Date.now();
const result = await VersionedLogStore.mergeLogs(testPath, newLogs, 'append', {
    useStreaming: true
});
const end = Date.now();

// Проверяем, что слияние не блокирует UI
console.assert((end - start) < 500, `Слияние заняло ${(end - start)}ms, что может блокировать UI`);

// Проверяем корректность данных
console.assert(result.mergedLogs.length === 10000, `Слито ${result.mergedLogs.length} логов вместо 10000`);

// Удаляем тестовый файл
const fs = require('fs');
fs.unlinkSync(testPath);
```

### Тест 3: Дедупликация в smart стратегии
```typescript
const existingLogs = [
    { timestamp: '2024-01-01T00:00:00.000Z', hypothesisId: 'H1', context: 'Test 1', data: {} },
    { timestamp: '2024-01-01T00:01:00.000Z', hypothesisId: 'H2', context: 'Test 2', data: {} }
];

const newLogs = [
    { timestamp: '2024-01-01T00:00:00.000Z', hypothesisId: 'H1', context: 'Duplicate', data: {} },  // Дубликат
    { timestamp: '2024-01-01T00:02:00.000Z', hypothesisId: 'H3', context: 'Test 3', data: {} }
];

const testPath = '/tmp/test-dedup-merge-logs.json';

// Сливаем логи с smart стратегией
const result = await VersionedLogStore.mergeLogs(testPath, newLogs, 'smart', {
    useStreaming: true
});

// Проверяем, что дубликаты удалены
console.assert(result.mergedLogs.length === 3, `Слито ${result.mergedLogs.length} логов вместо 3 (с дедупликацией)`);

// Проверяем, что конфликт был разрешён
console.assert(result.conflictResolved === true, 'Конфликт не был разрешён');

// Удаляем тестовый файл
const fs = require('fs');
fs.unlinkSync(testPath);
```

---

## Примечания

- Эта задача зависит от task-005 (должен быть оптимизирован `writeJSONStream`)
- После выполнения убедитесь, что все тесты проходят
- Проверьте, что `BATCH_SIZE = 100` обеспечивает хороший баланс между производительностью и разблокировкой event loop
- Убедитесь, что все стратегии слияния (smart, append, replace) работают корректно
