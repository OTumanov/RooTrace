/**
 * Утилита для файловых блокировок с очередью операций
 * Предотвращает race conditions при одновременном доступе к файлам
 * 
 * Улучшения:
 * - Таймауты для предотвращения зависаний
 * - Приоритеты операций
 * - Автоматическая очистка зависших операций
 */

interface QueuedOperation {
  operation: () => Promise<void>;
  priority: 'high' | 'normal' | 'low';
  timeout: number;
  timestamp: number;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timeoutHandle?: NodeJS.Timeout;
}

interface FileLock {
  queue: QueuedOperation[];
  processing: boolean;
  timeout: NodeJS.Timeout | null;
}

const fileLocks: Map<string, FileLock> = new Map();

// Константы по умолчанию
const DEFAULT_TIMEOUT_MS = 30000; // 30 секунд
const DEFAULT_PRIORITY: 'high' | 'normal' | 'low' = 'normal';

/**
 * Выполняет операцию с файлом с гарантией последовательного доступа
 * Операции для одного файла выполняются последовательно через очередь
 * 
 * @param filePath - путь к файлу
 * @param operation - асинхронная операция для выполнения
 * @param options - опции: timeout (мс), priority ('high' | 'normal' | 'low')
 * @returns результат операции
 */
export async function withFileLock<T>(
  filePath: string,
  operation: () => Promise<T>,
  options?: {
    timeout?: number;
    priority?: 'high' | 'normal' | 'low';
  }
): Promise<T> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  const priority = options?.priority ?? DEFAULT_PRIORITY;
  
  // Получаем или создаем блокировку для файла
  let lock = fileLocks.get(filePath);
  if (!lock) {
    lock = { queue: [], processing: false, timeout: null };
    fileLocks.set(filePath, lock);
  }

  // Создаем Promise для текущей операции
  return new Promise<T>((resolve, reject) => {
    // Создаем таймаут для операции
    const timeoutHandle = setTimeout(() => {
      const error = new Error(`File lock operation timeout after ${timeout}ms for file: ${filePath}`);
      reject(error);
      // Удаляем операцию из очереди если она еще там
      const index = lock.queue.findIndex(op => op.timeoutHandle === timeoutHandle);
      if (index !== -1) {
        lock.queue.splice(index, 1);
      }
      // Продолжаем обработку очереди
      processNextInQueue(lock, filePath);
    }, timeout);

    const queuedOperation: QueuedOperation = {
      operation: async () => {
        clearTimeout(timeoutHandle);
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          processNextInQueue(lock, filePath);
        }
      },
      priority,
      timeout,
      timestamp: Date.now(),
      resolve,
      reject,
      timeoutHandle
    };

    // Добавляем операцию в очередь с учетом приоритета (сортировка: high > normal > low)
    const priorityOrder = { 'high': 3, 'normal': 2, 'low': 1 };
    const insertIndex = lock.queue.findIndex(op => 
      priorityOrder[op.priority] < priorityOrder[priority]
    );
    
    if (insertIndex === -1) {
      // Нет операций с меньшим приоритетом - добавляем в конец
      lock.queue.push(queuedOperation);
    } else {
      // Вставляем перед первой операцией с меньшим приоритетом
      lock.queue.splice(insertIndex, 0, queuedOperation);
    }

    // Если нет активной операции, запускаем обработку очереди
    if (!lock.processing) {
      processNextInQueue(lock, filePath);
    }
  });
}

/**
 * Обрабатывает следующую операцию в очереди
 */
function processNextInQueue(lock: FileLock, filePath: string): void {
  lock.processing = false;
  
  if (lock.queue.length > 0) {
    const nextOperation = lock.queue.shift()!;
    lock.processing = true;
    // Очищаем таймаут операции при запуске (защита от утечек)
    if (nextOperation.timeoutHandle) {
      clearTimeout(nextOperation.timeoutHandle);
    }
    nextOperation.operation();
  } else {
    // Если очередь пуста, удаляем блокировку для экономии памяти
    if (lock.timeout) {
      clearTimeout(lock.timeout);
      lock.timeout = null;
    }
    fileLocks.delete(filePath);
  }
}

/**
 * Очищает все блокировки (используется для тестов)
 */
export function clearAllLocks(): void {
  fileLocks.clear();
}
