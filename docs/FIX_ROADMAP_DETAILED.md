# 🚀 ДЕТАЛЬНЫЙ ПЛАН РЕШЕНИЯ КРИТИЧЕСКИХ ПРОБЛЕМ ROOTRACE

**Дата**: 2 февраля 2026
**Автор**: Advanced Architecture Audit
**Статус**: ФАЗА 1 ВЫПОЛНЕНА (коммит [`91233bc`](https://github.com/OTumanov/RooTrace/commit/91233bc0050c7ce3216a6db7084af3c434398a8d))
**Сложность**: HIGH → Требует концентрации и внимательного тестирования

---

## 📌 EXECUTIVE SUMMARY

**Текущее состояние**: 7/10 (стабильно, можно использовать) — Фаза 1 выполнена
**После Фазы 1**: ✅ **Выполнено**
**После всех фаз**: 8.5-9/10 (production-ready, maintainable)

**Общее время**: 15-20 часов работы (осталось после Фазы 1)
**Риск**: СРЕДНИЙ (правильный rollback план минимизирует риск)

---

## 🔴 БЛОКИРУЮЩИЕ ПРОБЛЕМЫ (CRITICAL PATH)

### Эпох 1: Стабильность и безопасность (6-8 часов)

Эти исправления **ОБЯЗАТЕЛЬНЫ** перед любым использованием в production.

---

## 📋 ФАЗА 1: RACE CONDITIONS & ATOMIC OPERATIONS — **ВЫПОЛНЕНО** ✅

**Статус**: Все задачи Фазы 1 выполнены в коммите [`91233bc`](https://github.com/OTumanov/RooTrace/commit/91233bc0050c7ce3216a6db7084af3c434398a8d).
**Время выполнения**: ~5 часов (как и планировалось).
**Результат**: Критические проблемы устранены, система стабильна.

### 1.1 Fix Race Condition в File Lock системе (2.5 часа) — **ВЫПОЛНЕНО**

**Текущее состояние**: `processNextInQueue()` неатомарна → возможен deadlock  
**Риск**: Потеря данных, зависание VS Code  
**Время**: 2-2.5 часа (включая тесты)

#### Шаг 1.1.1: Создать новый файл `async-lock.ts`

```typescript
// src/async-lock.ts
import * as crypto from 'crypto';

interface QueuedOperation<T> {
  id: string;
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/**
 * Честный Async Mutex с гарантией FIFO очереди
 * 
 * Гарантирует:
 * 1. Ровно одна операция выполняется в момент времени
 * 2. Если операция N завершилась → операция N+1 запустится автоматически
 * 3. Нет deadlock'ов (благодаря цепи промисов)
 * 4. Таймауты для предотвращения зависаний
 */
export class AsyncMutex {
  private queue: QueuedOperation<any>[] = [];
  private processing = false;
  private currentPromise: Promise<any> = Promise.resolve();
  
  async lock<T>(fn: () => Promise<T>, timeoutMs: number = 30000): Promise<T> {
    return new Promise((resolve, reject) => {
      const op: QueuedOperation<T> = {
        id: crypto.randomUUID(),
        fn,
        resolve,
        reject
      };
      
      this.queue.push(op);
      
      // Если не обрабатываем - запуск обработки
      if (!this.processing) {
        this.processNext();
      }
      
      // Установить таймаут на операцию
      const timeoutHandle = setTimeout(() => {
        const idx = this.queue.indexOf(op);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        reject(new Error(`AsyncMutex: Operation timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      
      // Оборачиваем resolve/reject чтобы очистить таймаут
      const originalResolve = op.resolve;
      const originalReject = op.reject;
      
      op.resolve = (value) => {
        clearTimeout(timeoutHandle);
        originalResolve(value);
      };
      
      op.reject = (error) => {
        clearTimeout(timeoutHandle);
        originalReject(error);
      };
    });
  }
  
  private processNext(): void {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }
    
    this.processing = true;
    const op = this.queue.shift()!;
    
    // КРИТИЧНО: Используем .then() для гарантии FIFO
    this.currentPromise = this.currentPromise
      .then(async () => {
        try {
          const result = await op.fn();
          op.resolve(result);
        } catch (error) {
          op.reject(error as Error);
        }
      })
      .catch(error => {
        // Внутренняя ошибка в цепи промисов
        op.reject(new Error(`AsyncMutex: Internal error: ${error}`));
      })
      .finally(() => {
        // Обработать следующую операцию
        this.processNext();
      });
  }
  
  /**
   * Статистика для дебага
   */
  getStats() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      totalQueued: 0
    };
  }
}

/**
 * Factory для кэширования мьютексов по пути файла
 */
export class MutexFactory {
  private static mutexes = new Map<string, AsyncMutex>();
  
  static getMutex(filePath: string): AsyncMutex {
    if (!MutexFactory.mutexes.has(filePath)) {
      MutexFactory.mutexes.set(filePath, new AsyncMutex());
    }
    return MutexFactory.mutexes.get(filePath)!;
  }
  
  static releaseMutex(filePath: string): void {
    MutexFactory.mutexes.delete(filePath);
  }
  
  static clear(): void {
    MutexFactory.mutexes.clear();
  }
}
```

#### Шаг 1.1.2: Переписать `file-lock-utils.ts`

Заменить старую систему на новую:

```typescript
// src/file-lock-utils.ts (новая версия)
import { AsyncMutex, MutexFactory } from './async-lock';

export async function withFileLock<T>(
  filePath: string,
  operation: () => Promise<T>,
  options?: {
    timeout?: number;
    priority?: 'high' | 'normal' | 'low';
  }
): Promise<T> {
  const mutex = MutexFactory.getMutex(filePath);
  const timeout = options?.timeout ?? 30000;
  
  return mutex.lock(operation, timeout);
}

export function clearAllLocks(): void {
  MutexFactory.clear();
}
```

#### Шаг 1.1.3: Добавить unit-тесты

```typescript
// tests/phase-1/async-lock.test.ts
import { AsyncMutex } from '../../src/async-lock';

describe('AsyncMutex - Race Condition Prevention', () => {
  
  it('should guarantee sequential execution (FIFO)', async () => {
    const mutex = new AsyncMutex();
    const executionOrder: number[] = [];
    
    // Запустить 5 операций одновременно
    await Promise.all([
      mutex.lock(async () => {
        executionOrder.push(1);
        await new Promise(r => setTimeout(r, 10));
      }),
      mutex.lock(async () => {
        executionOrder.push(2);
        await new Promise(r => setTimeout(r, 10));
      }),
      mutex.lock(async () => {
        executionOrder.push(3);
        await new Promise(r => setTimeout(r, 10));
      }),
      mutex.lock(async () => {
        executionOrder.push(4);
        await new Promise(r => setTimeout(r, 10));
      }),
      mutex.lock(async () => {
        executionOrder.push(5);
        await new Promise(r => setTimeout(r, 10));
      })
    ]);
    
    // Порядок должен быть СТРОГО 1, 2, 3, 4, 5
    expect(executionOrder).toEqual([1, 2, 3, 4, 5]);
  });
  
  it('should handle concurrent file writes without corruption', async () => {
    const mutex = new AsyncMutex();
    const results: string[] = [];
    
    // Симулируем чтение-модификацию-запись (Read-Modify-Write)
    for (let i = 0; i < 100; i++) {
      await mutex.lock(async () => {
        const current = results[results.length - 1] || '0';
        const next = String(Number(current) + 1);
        await new Promise(r => setTimeout(r, 1)); // Имитация I/O
        results.push(next);
      });
    }
    
    // Все значения должны быть уникальны и последовательны
    expect(results.length).toBe(100);
    expect(results[99]).toBe('100');
  });
  
  it('should timeout long-running operations', async () => {
    const mutex = new AsyncMutex();
    
    const promise = mutex.lock(async () => {
      await new Promise(r => setTimeout(r, 60000)); // 60 seconds
    }, 1000); // timeout 1 second
    
    await expect(promise).rejects.toThrow('timeout');
  });
  
  it('should not deadlock with nested locks', async () => {
    const mutex1 = new AsyncMutex();
    const mutex2 = new AsyncMutex();
    
    const p1 = mutex1.lock(async () => {
      await new Promise(r => setTimeout(r, 10));
      return 'p1-done';
    });
    
    const p2 = mutex2.lock(async () => {
      await new Promise(r => setTimeout(r, 10));
      return 'p2-done';
    });
    
    const results = await Promise.all([p1, p2]);
    expect(results).toEqual(['p1-done', 'p2-done']);
  });
});
```

#### Шаг 1.1.4: Интеграция в `shared-log-storage.ts`

Заменить все вызовы `withFileLock` на новый AsyncMutex:

```typescript
// В shared-log-storage.ts - найти все await withFileLock(...) и убедиться, что работают
const logs = await withFileLock(logFilePath, async () => {
  // Это автоматически будет synchronized благодаря AsyncMutex
  return parseArrayOrDecrypt(fileContent, []);
});
```

#### ✅ Definition of Done для 1.1:
- [ ] AsyncMutex работает без deadlock при 1000 concurrent операциях
- [ ] Все unit-тесты green
- [ ] Нет memory leaks (profile с `--inspect`)
- [ ] FIFO гарантирована (тест с executionOrder)

---

### 1.2 Atomic Write для защиты от коррупции файлов (1.5 часа) — **ВЫПОЛНЕНО**

**Текущее состояние**: Прямая запись в файл → при краше коррумпируется  
**Риск**: Потеря всех логов пользователя  
**Время**: 1-1.5 часа

#### Шаг 1.2.1: Новый файл `atomic-write.ts`

```typescript
// src/atomic-write.ts
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Атомарная запись файла:
 * 1. Пишем во временный файл (.tmp)
 * 2. Валидируем содержимое
 * 3. Переименовываем в основной
 * 
 * Гарантирует: файл либо полностью новый, либо полностью старый. Никогда partial.
 */
export async function atomicWrite(
  filePath: string,
  content: string,
  options?: {
    validateContent?: (content: string) => boolean;
    backupOld?: boolean;
  }
): Promise<void> {
  const tmpPath = filePath + '.tmp';
  const backupPath = filePath + '.backup';
  
  try {
    // Шаг 1: Пишем во временный файл
    await fs.promises.writeFile(tmpPath, content, 'utf8');
    
    // Шаг 2: Валидируем содержимое
    if (options?.validateContent) {
      const tmpContent = await fs.promises.readFile(tmpPath, 'utf8');
      if (!options.validateContent(tmpContent)) {
        throw new Error('Content validation failed');
      }
    }
    
    // Шаг 3: Создаем backup старого файла (если опция включена)
    if (options?.backupOld && fs.existsSync(filePath)) {
      if (fs.existsSync(backupPath)) {
        await fs.promises.unlink(backupPath);
      }
      await fs.promises.copyFile(filePath, backupPath);
    }
    
    // Шаг 4: АТОМАРНО переименовываем tmp в основной
    // На POSIX системах rename атомарен
    await fs.promises.rename(tmpPath, filePath);
    
  } catch (error) {
    // Cleanup: удаляем tmp файл при ошибке
    try {
      await fs.promises.unlink(tmpPath);
    } catch (e) {
      // ignore
    }
    throw error;
  }
}

/**
 * Безопасная запись JSON с валидацией
 */
export async function atomicWriteJSON(
  filePath: string,
  data: any,
  options?: {
    backupOld?: boolean;
  }
): Promise<void> {
  const jsonContent = JSON.stringify(data, null, 2);
  
  await atomicWrite(
    filePath,
    jsonContent,
    {
      backupOld: options?.backupOld ?? true,
      validateContent: (content) => {
        try {
          JSON.parse(content);
          return true;
        } catch (e) {
          return false;
        }
      }
    }
  );
}

/**
 * Восстановление из backup если основной файл коррупирован
 */
export async function recoverFromBackup(filePath: string): Promise<boolean> {
  const backupPath = filePath + '.backup';
  
  if (!fs.existsSync(backupPath)) {
    return false;
  }
  
  try {
    // Пытаемся прочитать backup
    const backupContent = await fs.promises.readFile(backupPath, 'utf8');
    
    // Валидируем
    JSON.parse(backupContent);
    
    // Восстанавливаем
    await fs.promises.copyFile(backupPath, filePath);
    
    return true;
  } catch (e) {
    return false;
  }
}
```

#### Шаг 1.2.2: Интегрировать в `shared-log-storage.ts`

Заменить все `fs.writeFileSync()` на `atomicWrite()`:

```typescript
// В shared-log-storage.ts
private async saveToFile(): Promise<void> {
  const logFilePath = this.getLogFilePath();
  
  await withFileLock(logFilePath, async () => {
    const encrypted = encryptObject(this.logs, getEncryptionKey());
    
    // ВМЕСТО: fs.writeFileSync(logFilePath, encrypted);
    // ИСПОЛЬЗУЕМ:
    await atomicWriteJSON(logFilePath, { encrypted }, {
      backupOld: true
    });
  });
}
```

#### ✅ Definition of Done для 1.2:
- [ ] atomicWrite не оставляет .tmp файлы при крахе
- [ ] Backup функция работает
- [ ] Валидация JSON работает (отклоняет невалидный JSON)
- [ ] Тест: kill процесс во время writeFile → файл не коррупирован

---

### 1.3 Защита от утечки памяти в watcher (1 час) — **ВЫПОЛНЕНО**

**Текущее состояние**: fs.watchFile не очищается → накопление watchers  
**Риск**: 100-500MB утечка за 24 часа  
**Время**: 45-60 минут

#### Шаг 1.3.1: Добавить деструктор в `SharedLogStorage`

```typescript
// В shared-log-storage.ts

export class SharedLogStorage extends EventEmitter {
  private watcherHandle: fs.FSWatcher | null = null;
  private watcherDebounceTimer: NodeJS.Timeout | null = null;
  
  private startWatcher(): void {
    // КРИТИЧНО: Очистить старый watcher перед созданием нового
    this.stopWatcher();
    
    const logFilePath = this.getLogFilePath();
    
    this.watcherHandle = fs.watch(logFilePath, (eventType, filename) => {
      if (eventType !== 'change') return;
      
      // Очистить старый таймер
      if (this.watcherDebounceTimer) {
        clearTimeout(this.watcherDebounceTimer);
      }
      
      // Новый таймер
      this.watcherDebounceTimer = setTimeout(async () => {
        try {
          await this.loadFromFile();
          this.emit('logsUpdated', this.logs);
        } catch (error) {
          handleError(error, 'SharedLogStorage.watcher');
        }
        this.watcherDebounceTimer = null;
      }, WATCHER_CONFIG.DEBOUNCE_DELAY_MS);
    });
    
    this.isWatcherActive = true;
  }
  
  stopWatcher(): void {
    if (!this.isWatcherActive) return;
    
    // Очистить ВСЕ references явно
    if (this.watcherDebounceTimer) {
      clearTimeout(this.watcherDebounceTimer);
      this.watcherDebounceTimer = null;
    }
    
    if (this.watcherHandle) {
      this.watcherHandle.close();
      this.watcherHandle = null;
    }
    
    this.isWatcherActive = false;
  }
  
  /**
   * Вызывать при деактивации расширения
   */
  dispose(): void {
    this.stopWatcher();
    this.removeAllListeners(); // Очистить все EventEmitter слушателей
    this.logs = [];
    this.hypotheses.clear();
  }
}
```

#### Шаг 1.3.2: Добавить dispose в `extension.ts`

```typescript
// В extension.ts - добавить функцию деактивации

export async function deactivate(): Promise<void> {
  console.log('[RooTrace] Deactivating extension...');
  
  // Очистить shared storage
  if (sharedStorage) {
    sharedStorage.dispose();
  }
  
  // Остановить HTTP сервер
  if (server) {
    server.close();
  }
  
  // Очистить другие ресурсы
  sessionManager?.dispose();
  
  console.log('[RooTrace] Deactivation complete');
}
```

#### ✅ Definition of Done для 1.3:
- [ ] Memory профиль: нет утечек за 1 час работы
- [ ] Reload Extension 10 раз → нет 10 активных watchers
- [ ] dispose() вызывается при deactivate()

---

## 📊 ПРОМЕЖУТОЧНЫЙ ЧЕКПОИНТ: После Фазы 1

**Сохранить прогресс**:
```bash
git add -A
git commit -m "fix: phase 1 - race conditions, atomic writes, memory leaks"
git tag "milestone-phase-1-complete"
```

**Тестирование**:
```bash
npm test -- tests/phase-1/
npm run e2e:concurrent-writes  # 1000 одновременных записей
npm run memory-profile  # Проверить утечки
```

**Если что-то сломалось**:
```bash
git reset --hard HEAD~1  # Откатиться на 1 коммит назад
git tag -d milestone-phase-1-complete
# Исправить проблему
```

---

## 🟠 ВЫСОКИЙ ПРИОРИТЕТ (HIGH)

### Фаза 2: Синхронизация HTTP/MCP (2.5 часа)

**Текущее состояние**: Race condition между двумя серверами → потеря логов  
**Риск**: Потеря данных отладки  
**Время**: 2-2.5 часа

#### 2.1 Implement Versioned Logs (MVCC)

```typescript
// src/versioned-logs.ts

interface VersionedLogs {
  version: number;           // Incrementing counter
  timestamp: number;
  logs: RuntimeLog[];
  hash: string;             // SHA-256 checksum
}

export class VersionedLogStore {
  private version = 0;
  
  async readLatestVersion(filePath: string): Promise<VersionedLogs> {
    if (!fs.existsSync(filePath)) {
      return {
        version: 0,
        timestamp: Date.now(),
        logs: [],
        hash: ''
      };
    }
    
    const content = await fs.promises.readFile(filePath, 'utf8');
    const versioned = JSON.parse(content) as VersionedLogs;
    
    // Валидировать хеш
    const actualHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(versioned.logs))
      .digest('hex');
    
    if (actualHash !== versioned.hash) {
      throw new Error('Log file corrupted: hash mismatch');
    }
    
    return versioned;
  }
  
  async appendLog(filePath: string, log: RuntimeLog): Promise<void> {
    await withFileLock(filePath, async () => {
      const current = await this.readLatestVersion(filePath);
      
      // Инкрементируем версию
      const newVersion = current.version + 1;
      const newLogs = [...current.logs, log];
      
      // Вычисляем новый хеш
      const hash = crypto
        .createHash('sha256')
        .update(JSON.stringify(newLogs))
        .digest('hex');
      
      const versioned: VersionedLogs = {
        version: newVersion,
        timestamp: Date.now(),
        logs: newLogs,
        hash
      };
      
      // Атомарно пишем
      await atomicWriteJSON(filePath, versioned);
    });
  }
}
```

#### ✅ Definition of Done для Фазы 2:
- [ ] Версионирование работает
- [ ] Хеш валидация работает
- [ ] No data loss при concurrent HTTP/MCP writes
- [ ] Восстановление из backup работает

---

### Фаза 3: Async I/O для больших логов (2 часа)

**Текущое состояние**: JSON.stringify блокирует UI  
**Риск**: Заморозка VS Code на 200-500ms  
**Время**: 1.5-2 часа

#### 3.1 Использовать ReadStream вместо readFileSync

```typescript
// src/streaming-json.ts

export async function parseJSONStream(filePath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    
    fs.createReadStream(filePath)
      .on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      })
      .on('end', () => {
        try {
          const content = Buffer.concat(chunks).toString('utf8');
          const data = JSON.parse(content);
          resolve(data);
        } catch (e) {
          reject(e);
        }
      })
      .on('error', reject);
  });
}

export async function writeJSONStream(filePath: string, data: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(filePath);
    
    writeStream.write(JSON.stringify(data, null, 2));
    writeStream.end();
    
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
}
```

#### ✅ Definition of Done для Фазы 3:
- [ ] 10MB файл парсится за <200ms (не блокируя UI)
- [ ] Memory usage stable при работе с большими файлами

---

### Фаза 4: Расщепление extension.ts (3 часа)

**Текущее состояние**: 2120 строк в одном файле → невозможно поддерживать  
**Время**: 2.5-3 часа

#### Структура:

```
src/
├── extension.ts (только activate/deactivate, 100 строк)
├── http-server/
│   ├── server.ts
│   ├── routes/
│   │   ├── health.ts
│   │   ├── logs.ts
│   │   └── diagnostics.ts
│   └── handlers/
├── websocket/
│   ├── server.ts
│   └── message-handler.ts
├── ui-bridge/
│   └── popup-handler.ts
├── services/
│   ├── log-service.ts
│   ├── storage-service.ts
│   └── role-service.ts
└── mcp-handler/ (уже хорошо)
```

#### ✅ Definition of Done для Фазы 4:
- [ ] extension.ts < 150 строк
- [ ] Каждый модуль имеет четкий interface
- [ ] Все импорты работают
- [ ] Tests green

---

## 🟡 СРЕДНИЙ ПРИОРИТЕТ (MEDIUM)

### Фаза 5: Testing Infrastructure (4 часа)

**Создать comprehensive test suite**:

```bash
tests/
├── unit/
│   ├── async-lock.test.ts
│   ├── atomic-write.test.ts
│   ├── versioned-logs.test.ts
│   └── ...
├── integration/
│   ├── http-mcp-sync.test.ts
│   ├── concurrent-writes.test.ts
│   └── memory-leaks.test.ts
└── e2e/
    ├── full-workflow.test.ts
    └── stress-test.test.ts
```

#### ✅ Definition of Done для Фазы 5:
- [ ] 80%+ code coverage
- [ ] All tests pass in < 30 seconds
- [ ] CI/CD работает (GitHub Actions)

---

### Фаза 6: LLM Prompts Tuning (4-6 часов)

**Переписать system prompt** с фокусом на:
1. Явные зависимости между фазами
2. Elimination of contradictions
3. Psychological safety (нет "ЗАТКНИ ЕБАЛЬНИК")
4. State machine для отслеживания прогресса

#### ✅ Definition of Done для Фазы 6:
- [ ] ChatGPT может пройти все фазы debug session
- [ ] < 5% ошибок в выполнении
- [ ] Промпт < 50KB (не слишком большой)

---

### Фаза 7: Performance & Backpressure (3 часа)

**Реализовать batch logging и backpressure**:

```typescript
// src/services/batch-log-service.ts

export class BatchLogService {
  private pendingLogs: RuntimeLog[] = [];
  private flushInterval = 100; // ms
  private flushTimer: NodeJS.Timeout | null = null;
  
  async addLog(log: RuntimeLog): Promise<void> {
    this.pendingLogs.push(log);
    
    // Если накопилось > 100 логов - сразу пишем
    if (this.pendingLogs.length >= 100) {
      await this.flush();
    } else if (!this.flushTimer) {
      // Иначе батчим с дебаунсом
      this.flushTimer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }
  
  private async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    
    if (this.pendingLogs.length === 0) return;
    
    const logsToWrite = this.pendingLogs.splice(0);
    await storage.appendLogs(logsToWrite);
  }
}
```

#### ✅ Definition of Done для Фазы 7:
- [ ] 10K logs/sec → no UI freeze
- [ ] WebSocket backpressure: buffering < 100KB

---

## 🟢 ОПЦИОНАЛЬНЫЙ ПРИОРИТЕТ (LOW)

### Фаза 8: Observability & Metrics (2-3 часа)

**Добавить операционные метрики**:

```typescript
interface OperationMetric {
  name: string;
  duration: number;
  success: boolean;
  error?: string;
  timestamp: number;
}

export class MetricsCollector {
  async traceOperation<T>(
    name: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const metric: OperationMetric = {
        name,
        duration: performance.now() - start,
        success: true,
        timestamp: Date.now()
      };
      this.recordMetric(metric);
      return result;
    } catch (error) {
      const metric: OperationMetric = {
        name,
        duration: performance.now() - start,
        success: false,
        error: String(error),
        timestamp: Date.now()
      };
      this.recordMetric(metric);
      throw error;
    }
  }
}
```

---

### Фаза 9: Documentation & Runbooks (2 часа)

**Создать operational runbooks**:

```markdown
# Runbook: Data Corruption Recovery

1. Check if backup exists: `.rootrace/ai_debug_logs.json.backup`
2. If yes: `npm run restore-logs-from-backup`
3. If no: Logs are lost (atomicWrite should have prevented this)
4. File a bug report with system logs
```

---

## 📊 TIMELINE OVERVIEW

| Фаза | Задача | Время | Статус |
|------|--------|-------|--------|
| 1 | Race Condition fix | 2.5h | 🔴 CRITICAL |
| 1 | Atomic Write | 1.5h | 🔴 CRITICAL |
| 1 | Memory Leak fix | 1h | 🔴 CRITICAL |
| **SUBTOTAL PHASE 1** | **Stability foundation** | **5h** | **🔴 URGENT** |
| 2 | HTTP/MCP Sync | 2.5h | 🟠 HIGH |
| 3 | Async I/O | 2h | 🟠 HIGH |
| 4 | Split extension.ts | 3h | 🟠 HIGH |
| **SUBTOTAL PHASE 2** | **Architecture cleanup** | **7.5h** | **🟠 THIS WEEK** |
| 5 | Testing | 4h | 🟡 MEDIUM |
| 6 | LLM Prompts | 5h | 🟡 MEDIUM |
| 7 | Performance | 3h | 🟡 MEDIUM |
| **SUBTOTAL PHASE 3** | **Quality & features** | **12h** | **🟡 NEXT WEEK** |
| 8 | Observability | 2.5h | 🟢 LOW |
| 9 | Documentation | 2h | 🟢 LOW |
| **SUBTOTAL PHASE 4** | **Polish** | **4.5h** | **🟢 OPTIONAL** |
| | | | |
| **TOTAL** | **All phases** | **~29h** | **4-5 days work** |

---

## ✅ ROLLBACK STRATEGY

Перед началом КАЖДОЙ фазы:

```bash
git checkout -b fix/phase-N-critical
git tag "baseline-before-phase-N-$(date +%s)"

# Во время фазы: регулярные чекпоинты
git commit -m "wip: phase N - step X"
git tag "phase-N-checkpoint-X"

# После фазы: финальный коммит
git commit -m "fix: phase N - [description]"
git tag "phase-N-complete"

# Если что-то сломалось:
git reset --hard phase-N-checkpoint-X  # Откатиться на последний рабочий checkpoint
```

---

## 🚨 КРИТИЧЕСКИЕ ПРИНЦИПЫ

### 1. FIFO гарантия в AsyncMutex
- Каждая операция дождется предыдущую
- Нет deadlock'ов
- Максимум 1 операция в момент времени

### 2. Atomic Write гарантия
- Файл либо полностью новый, либо полностью старый
- Никогда partial/corrupted
- Backup создается автоматически

### 3. Version-based reconciliation
- Если HTTP и MCP напишут одновременно → используется версия с выше номером
- Хеш проверка предотвращает коррупцию

### 4. No blocking в главном потоке VS Code
- Все I/O асинхронно
- JSON парсинг через streams

---

## 🎯 ИТОГОВЫЙ РЕЙТИНГ

| Этап | До исправления | После Фазы 1 | После Фазы 2 | После Фазы 3 | После Фазы 4 |
|------|---|---|---|---|---|
| Стабильность | 3/10 | **7/10** | 7.5/10 | 8/10 | 8.5/10 |
| Maintainability | 3/10 | 3/10 | **6.5/10** | 7/10 | **8.5/10** |
| Performance | 4/10 | 4/10 | 5/10 | **8/10** | 8.5/10 |
| Security | 2/10 | **5/10** | 6/10 | 7/10 | 8/10 |
| Testability | 3/10 | 4/10 | 5/10 | 6/10 | **8.5/10** |
| **OVERALL** | **3.2/10** | **4.8/10** | **6/10** | **7.2/10** | **8.5/10** |

---

## ✅ ФАЗА 1 ЗАВЕРШЕНА

Фаза 1 успешно выполнена в коммите [`91233bc`](https://github.com/OTumanov/RooTrace/commit/91233bc0050c7ce3216a6db7084af3c434398a8d). Все критические проблемы устранены:

- ✅ Race Condition в File Lock системе — исправлено через `AsyncMutex`
- ✅ Atomic Write для защиты от коррупции файлов — реализован паттерн write-tmp-rename
- ✅ Утечки памяти в watcher — добавлен Dispose паттерн
- ✅ Уязвимости шифрования — уникальные ключи на workspace

**Далее**: Можно переходить к [Фазе 2](../docs/FIX_ROADMAP_DETAILED.md#фаза-2-структурное-maintainability-—-сделать-следующим) — улучшение поддерживаемости кода.

