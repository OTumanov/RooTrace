/**
 * Утилита для файловых блокировок с очередью операций
 * Предотвращает race conditions при одновременном доступе к файлам
 */

interface FileLock {
  queue: Array<() => Promise<void>>;
  processing: boolean;
}

const fileLocks: Map<string, FileLock> = new Map();

/**
 * Выполняет операцию с файлом с гарантией последовательного доступа
 * Операции для одного файла выполняются последовательно через очередь
 * 
 * @param filePath - путь к файлу
 * @param operation - асинхронная операция для выполнения
 * @returns результат операции
 */
export async function withFileLock<T>(
  filePath: string,
  operation: () => Promise<T>
): Promise<T> {
  // Получаем или создаем блокировку для файла
  let lock = fileLocks.get(filePath);
  if (!lock) {
    lock = { queue: [], processing: false };
    fileLocks.set(filePath, lock);
  }

  // Создаем Promise для текущей операции
  return new Promise<T>((resolve, reject) => {
    const executeOperation = async () => {
      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        // После завершения операции обрабатываем следующую в очереди
        lock.processing = false;
        if (lock.queue.length > 0) {
          const nextOperation = lock.queue.shift()!;
          lock.processing = true;
          nextOperation();
        } else {
          // Если очередь пуста, удаляем блокировку для экономии памяти
          fileLocks.delete(filePath);
        }
      }
    };

    // Добавляем операцию в очередь
    lock.queue.push(executeOperation);

    // Если нет активной операции, запускаем обработку очереди
    if (!lock.processing) {
      lock.processing = true;
      const operationToExecute = lock.queue.shift()!;
      operationToExecute();
    }
  });
}

/**
 * Очищает все блокировки (используется для тестов)
 */
export function clearAllLocks(): void {
  fileLocks.clear();
}
