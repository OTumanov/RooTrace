/**
 * Утилиты для retry механизма при инъекции проб
 * 
 * Этот модуль предоставляет механизм повторных попыток для инъекции проб,
 * что позволяет обрабатывать временные ошибки (блокировка файлов, таймауты и т.д.).
 */

import { logDebug } from '../../error-handler';

/**
 * Определяет, является ли ошибка временной
 * 
 * Временные ошибки - это ошибки, которые могут быть решены повторной попыткой:
 * - ENOENT - File not found (может быть временным)
 * - EACCES - Permission denied (может быть временным)
 * - EBUSY - Resource busy
 * - ETIMEDOUT - Timeout
 * - ECONNRESET - Connection reset
 * 
 * @param error - Ошибка для проверки
 * @returns true, если ошибка временная и стоит повторить попытку
 */
export function isTemporaryError(error: Error): boolean {
  const temporaryErrorPatterns = [
    /ENOENT/, // File not found (может быть временным)
    /EACCES/, // Permission denied (может быть временным)
    /EBUSY/,  // Resource busy
    /ETIMEDOUT/, // Timeout
    /ECONNRESET/ // Connection reset
  ];

  return temporaryErrorPatterns.some(pattern => pattern.test(error.message));
}

/**
 * Параметры для инъекции пробы с retry
 */
export interface InjectProbeWithRetryParams {
  filePath: string;
  lineNumber: number;
  probeType: 'log' | 'trace' | 'error';
  message: string | undefined;
  probeCode?: string;
  hypothesisId?: string;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Инъекция пробы с retry механизмом для временных ошибок
 * 
 * Выполняет инъекцию пробы с автоматическими повторными попытками
 * в случае временных ошибок (блокировка файлов, таймауты и т.д.).
 * 
 * @param params - Параметры инъекции
 * @param injectProbe - Функция для выполнения инъекции пробы
 * @returns Результат инъекции
 */
export async function injectProbeWithRetry(
  params: InjectProbeWithRetryParams,
  injectProbe: (
    filePath: string,
    lineNumber: number,
    probeType: 'log' | 'trace' | 'error',
    message: string,
    probeCode?: string,
    hypothesisId?: string
  ) => Promise<any>
): Promise<any> {
  const {
    filePath,
    lineNumber,
    probeType,
    message,
    probeCode,
    hypothesisId,
    maxRetries = 3,
    retryDelay = 100
  } = params;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await injectProbe(filePath, lineNumber, probeType, message || '', probeCode, hypothesisId);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Проверяем, является ли ошибка временной (например, файл заблокирован)
      const isTemporary = isTemporaryError(lastError);
      
      if (!isTemporary || attempt === maxRetries - 1) {
        throw lastError;
      }

      // Ждем перед повторной попыткой
      await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
      logDebug(`Retry attempt ${attempt + 1}/${maxRetries} for inject_probe`, 'RooTraceMCPHandler', {
        attempt: attempt + 1,
        maxRetries,
        filePath
      });
    }
  }

  throw lastError || new Error('Unknown error in injectProbeWithRetry');
}
