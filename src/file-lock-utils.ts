/**
 * Утилита для файловых блокировок с очередью операций
 * Предотвращает race conditions при одновременном доступе к файлам
 * 
 * Использует AsyncMutex для атомарности и гарантии FIFO.
 * 
 * Улучшения:
 * - Таймауты для предотвращения зависаний
 * - Приоритеты операций
 * - Автоматическая очистка зависших операций
 */

import { globalMutexRegistry, AsyncMutex } from './async-lock';

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

  const mutex = globalMutexRegistry.getMutex(filePath, timeout);
  
  try {
    return await mutex.run(operation, { timeout, priority });
  } catch (error) {
    // Если ошибка таймаута, выбрасываем более информативное сообщение
    if (error instanceof Error && error.message.includes('AsyncMutex timeout')) {
      throw new Error(`File lock operation timeout after ${timeout}ms for file: ${filePath}`);
    }
    throw error;
  }
}

/**
 * Очищает все блокировки (используется для тестов)
 */
export function clearAllLocks(): void {
  globalMutexRegistry.clear();
}

/**
 * Возвращает количество ожидающих операций для указанного файла (для отладки)
 */
export function getQueueLength(filePath: string): number {
  const mutex = globalMutexRegistry.getMutex(filePath);
  return mutex.getQueueLength();
}

/**
 * Проверяет, заблокирован ли файл в данный момент (для отладки)
 */
export function isFileLocked(filePath: string): boolean {
  const mutex = globalMutexRegistry.getMutex(filePath);
  return mutex.isLocked();
}
