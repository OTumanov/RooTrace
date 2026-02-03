# Task-004: Заменить синхронный JSON.stringify в atomicWriteJson на потоковую запись

## Что именно нужно сделать

В файле [`src/atomic-write.ts`](../src/atomic-write.ts) в функции [`atomicWriteJson()`](../src/atomic-write.ts:161-168) заменить синхронный `JSON.stringify()` на потоковую запись.

**Текущий код:**
```typescript
async function atomicWriteJson(
  filePath: string,
  jsonData: any,
  options: Omit<AtomicWriteOptions, 'validateJson'> = {}
): Promise<void> {
  const jsonString = JSON.stringify(jsonData, null, 2);  // БЛОКИРУЕТ!
  return atomicWriteFile(filePath, jsonString, { ...options, validateJson: true });
}
```

**Проблема:** `JSON.stringify(jsonData, null, 2)` блокирует event loop при больших данных (10k+ логов), что может вызвать задержку на 200-500ms.

**Решение:** Использовать потоковую запись JSON из [`src/streaming-json.ts`](../src/streaming-json.ts) вместо синхронного `JSON.stringify()`.

**Предлагаемая реализация:**

1. Обновить функцию `atomicWriteJson()` для использования потоковой записи:
```typescript
import { writeJSONStream } from './streaming-json';

async function atomicWriteJson(
  filePath: string,
  jsonData: any,
  options: Omit<AtomicWriteOptions, 'validateJson'> = {}
): Promise<void> {
  const {
    encoding = 'utf-8',
    cleanupOldTempFiles = 3600000,
    mode = 0o644
  } = options;
  
  // Используем потоковую запись вместо синхронного JSON.stringify
  await writeJSONStream(filePath, jsonData, {
    pretty: true,  // для совместимости с JSON.stringify(jsonData, null, 2)
    encoding: encoding as BufferEncoding,
    mode
  });
  
  // Очистка старых временных файлов
  await cleanupOldTempFiles(filePath, cleanupOldTempFiles);
}
```

2. Добавить функцию очистки временных файлов (если её ещё нет):
```typescript
async function cleanupOldTempFiles(filePath: string, maxAge: number): Promise<void> {
    try {
        const dir = path.dirname(filePath);
        const basename = path.basename(filePath);
        const files = await fs.readdir(dir);
        
        for (const file of files) {
            if (file.startsWith(basename) && file.includes('.tmp')) {
                const tempPath = path.join(dir, file);
                const stats = await fs.stat(tempPath);
                const age = Date.now() - stats.mtimeMs;
                
                if (age > maxAge) {
                    await fs.unlink(tempPath);
                }
            }
        }
    } catch (error) {
        // Игнорируем ошибки при очистке
        logDebug(`Failed to cleanup temp files: ${error}`, 'atomicWriteJson');
    }
}
```

---

## Как протестировать именно этот кусок

### Тест 1: Базовый функционал записи
```typescript
import { atomicWriteJson } from '../src/atomic-write';

const testData = {
    logs: Array(100).fill({ 
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'Test',
        data: { value: 42 }
    }),
    version: 1,
    versionId: 'test-id'
};

const testPath = '/tmp/test-atomic-write.json';

// Записываем данные
await atomicWriteJson(testPath, testData);

// Проверяем, что файл существует и содержит корректные данные
const fs = require('fs');
const content = fs.readFileSync(testPath, 'utf-8');
const parsed = JSON.parse(content);

console.assert(parsed.logs.length === 100, 'Количество логов не совпадает');
console.assert(parsed.version === 1, 'Версия не совпадает');

// Удаляем тестовый файл
fs.unlinkSync(testPath);
```

### Тест 2: Производительность на больших данных
```typescript
const largeData = {
    logs: Array(10000).fill({ 
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'Test',
        data: { value: 42 }
    }),
    version: 1,
    versionId: 'test-id'
};

const testPath = '/tmp/test-large-atomic-write.json';

// Измеряем время записи
const start = Date.now();
await atomicWriteJson(testPath, largeData);
const end = Date.now();

// Проверяем, что запись не блокирует UI
console.assert((end - start) < 200, `Запись заняла ${(end - start)}ms, что может блокировать UI`);

// Проверяем корректность данных
const fs = require('fs');
const content = fs.readFileSync(testPath, 'utf-8');
const parsed = JSON.parse(content);

console.assert(parsed.logs.length === 10000, 'Количество логов не совпадает');

// Удаляем тестовый файл
fs.unlinkSync(testPath);
```

### Тест 3: Атомарность записи
```typescript
const testData = {
    logs: [{ timestamp: new Date().toISOString(), hypothesisId: 'H1', context: 'Test', data: {} }],
    version: 1
};

const testPath = '/tmp/test-atomic.json';

// Записываем данные
await atomicWriteJson(testPath, testData);

// Проверяем, что файл существует
const fs = require('fs');
console.assert(fs.existsSync(testPath), 'Файл не был создан');

// Проверяем, что данные корректны
const content = fs.readFileSync(testPath, 'utf-8');
const parsed = JSON.parse(content);

console.assert(parsed.version === 1, 'Данные не корректны');

// Удаляем тестовый файл
fs.unlinkSync(testPath);
```

---

## Примечания

- Эта задача зависит от task-003 (должны быть оптимизированы все вызовы в `addLog`)
- После выполнения убедитесь, что `VersionedLogStore` корректно использует обновлённую функцию
- Проверьте, что `useStreaming: true` в `VersionedLogStore.mergeLogs()` работает корректно
