/**
 * Асинхронный мьютекс с гарантией FIFO и атомарными операциями.
 * Заменяет текущую реализацию file-lock-utils.ts, устраняя race condition.
 */

export interface AsyncMutexOptions {
  /** Таймаут в миллисекундах (по умолчанию 30000) */
  timeout?: number;
  /** Приоритет операции (high, normal, low) */
  priority?: 'high' | 'normal' | 'low';
}

interface QueuedOperation {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  priority: number;
  timestamp: number;
  timeoutHandle?: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 30000;
const PRIORITY_WEIGHTS = { high: 3, normal: 2, low: 1 };

/**
 * Асинхронный мьютекс с очередью и приоритетами.
 * Гарантирует, что только одна операция владеет блокировкой в любой момент.
 * Операции выполняются в порядке FIFO с учетом приоритетов.
 */
export class AsyncMutex {
  private queue: QueuedOperation[] = [];
  private locked = false;
  private readonly defaultTimeout: number;

  constructor(defaultTimeout: number = DEFAULT_TIMEOUT_MS) {
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * Захватывает блокировку. Возвращает функцию release, которую нужно вызвать для освобождения.
   * Если блокировка уже захвачена, операция ставится в очередь.
   * @param options Опции таймаута и приоритета
   * @returns Promise с функцией release
   */
  async acquire(options?: AsyncMutexOptions): Promise<() => void> {
    const timeout = options?.timeout ?? this.defaultTimeout;
    const priority = PRIORITY_WEIGHTS[options?.priority ?? 'normal'];

    return new Promise<() => void>((resolve, reject) => {
      const queuedOperation: QueuedOperation = {
        resolve,
        reject,
        priority,
        timestamp: Date.now(),
      };

      // Таймаут для операции
      if (timeout > 0) {
        queuedOperation.timeoutHandle = setTimeout(() => {
          const index = this.queue.indexOf(queuedOperation);
          if (index !== -1) {
            this.queue.splice(index, 1);
          }
          reject(new Error(`AsyncMutex timeout after ${timeout}ms`));
          this.processQueue();
        }, timeout);
      }

      // Вставка в очередь с учетом приоритета (более высокий приоритет = больше вес)
      const insertIndex = this.queue.findIndex(op => op.priority < priority);
      if (insertIndex === -1) {
        this.queue.push(queuedOperation);
      } else {
        this.queue.splice(insertIndex, 0, queuedOperation);
      }

      this.processQueue();
    });
  }

  /**
   * Выполняет функцию с захватом блокировки, автоматически освобождая после завершения.
   * @param fn Асинхронная функция для выполнения
   * @param options Опции таймаута и приоритета
   * @returns Результат функции
   */
  async run<T>(fn: () => Promise<T>, options?: AsyncMutexOptions): Promise<T> {
    const release = await this.acquire(options);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Обрабатывает очередь, запуская следующую операцию, если блокировка свободна.
   */
  private processQueue(): void {
    if (this.locked || this.queue.length === 0) {
      return;
    }

    const nextOperation = this.queue.shift()!;
    this.locked = true;

    // Очищаем таймаут
    if (nextOperation.timeoutHandle) {
      clearTimeout(nextOperation.timeoutHandle);
    }

    // Создаем функцию release, которая освобождает блокировку и обрабатывает следующую операцию
    const release = () => {
      this.locked = false;
      this.processQueue();
    };

    nextOperation.resolve(release);
  }

  /**
   * Возвращает количество операций в очереди.
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Проверяет, захвачена ли блокировка в данный момент.
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Очищает очередь, отклоняя все ожидающие операции.
   * @param reason Причина очистки
   */
  clearQueue(reason: string = 'Queue cleared'): void {
    while (this.queue.length > 0) {
      const op = this.queue.shift()!;
      if (op.timeoutHandle) {
        clearTimeout(op.timeoutHandle);
      }
      op.reject(new Error(reason));
    }
  }
}

/**
 * Глобальный реестр мьютексов по ключам (например, по пути файла).
 * Гарантирует, что для каждого ключа существует единственный экземпляр AsyncMutex.
 */
export class AsyncMutexRegistry {
  private mutexes = new Map<string, AsyncMutex>();

  /**
   * Получает или создает мьютекс для указанного ключа.
   * @param key Уникальный ключ (например, путь к файлу)
   * @param defaultTimeout Таймаут по умолчанию для нового мьютекса
   */
  getMutex(key: string, defaultTimeout?: number): AsyncMutex {
    let mutex = this.mutexes.get(key);
    if (!mutex) {
      mutex = new AsyncMutex(defaultTimeout);
      this.mutexes.set(key, mutex);
    }
    return mutex;
  }

  /**
   * Удаляет мьютекс из реестра.
   * @param key Ключ мьютекса
   */
  deleteMutex(key: string): void {
    this.mutexes.delete(key);
  }

  /**
   * Очищает весь реестр.
   */
  clear(): void {
    this.mutexes.clear();
  }
}

// Глобальный экземпляр реестра для использования в file-lock-utils.ts
export const globalMutexRegistry = new AsyncMutexRegistry();