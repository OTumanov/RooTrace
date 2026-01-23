/**
 * Утилиты для парсинга конфигурационных файлов
 * 
 * Обеспечивает единый подход к чтению конфигурации с поддержкой:
 * - Парсинг JSON (для обратной совместимости с незашифрованными файлами)
 * - Дешифровка зашифрованных файлов (fallback)
 * 
 * Используется в:
 * - extension.ts: loadAIDebugConfig()
 * - code-injector.ts: getServerUrl()
 * - shared-log-storage.ts: loadFromFile()
 * - session-manager.ts: loadSessions()
 */

import { getEncryptionKey, decryptObject } from '../encryption-utils';

/**
 * Парсит конфигурацию с fallback на дешифровку
 * 
 * Сначала пытается распарсить как JSON (для обратной совместимости),
 * если не получается - пытается расшифровать.
 * 
 * @param content Содержимое файла (JSON строка или зашифрованный текст)
 * @param defaultValue Значение по умолчанию, возвращаемое при ошибке парсинга/дешифровки
 * @returns Распарсенный объект или defaultValue
 * 
 * @example
 * ```typescript
 * const config = parseConfigOrDecrypt<AIDebugConfig>(
 *   fileContent,
 *   { url: 'http://localhost:51234/', status: 'inactive', timestamp: 0 }
 * );
 * ```
 */
export function parseConfigOrDecrypt<T>(content: string, defaultValue: T): T {
  // Пытаемся распарсить как JSON (для обратной совместимости)
  try {
    return JSON.parse(content) as T;
  } catch (parseError) {
    // Если JSON парсинг не удался, пытаемся расшифровать
    try {
      const encryptionKey = getEncryptionKey();
      return decryptObject(content, encryptionKey) as T;
    } catch (decryptError) {
      // Если расшифровка не удалась, возвращаем значение по умолчанию
      return defaultValue;
    }
  }
}

/**
 * Парсит конфигурацию с fallback на дешифровку и обработкой ошибок
 * 
 * Отличается от parseConfigOrDecrypt тем, что вызывает onError при ошибке
 * 
 * @param content Содержимое файла
 * @param defaultValue Значение по умолчанию
 * @param onError Callback для обработки ошибок
 * @returns Распарсенный объект или defaultValue
 */
export function parseConfigOrDecryptWithError<T>(
  content: string,
  defaultValue: T,
  onError?: (error: Error, stage: 'parse' | 'decrypt') => void
): T {
  try {
    return JSON.parse(content) as T;
  } catch (parseError) {
    try {
      const encryptionKey = getEncryptionKey();
      return decryptObject(content, encryptionKey) as T;
    } catch (decryptError) {
      const error = decryptError instanceof Error ? decryptError : new Error(String(decryptError));
      if (onError) {
        onError(error, 'decrypt');
      }
      return defaultValue;
    }
  }
}

/**
 * Парсит массив с fallback на дешифровку
 * 
 * Специализированная версия для парсинга массивов (логи, сессии и т.д.)
 * 
 * @param content Содержимое файла
 * @param defaultValue Значение по умолчанию (обычно пустой массив)
 * @returns Распарсенный массив или defaultValue
 */
export function parseArrayOrDecrypt<T>(content: string, defaultValue: T[]): T[] {
  const parsed = parseConfigOrDecrypt<T[]>(content, defaultValue);
  return Array.isArray(parsed) ? parsed : defaultValue;
}
