import * as crypto from 'crypto';

/**
 * Проверяет наличие и валидность ключа шифрования
 * @throws Error если ключ не установлен или недействителен
 */
export function validateEncryptionKey(): void {
  const envKey = process.env.ROO_TRACE_ENCRYPTION_KEY;
  const secretPhrase = process.env.ROO_TRACE_SECRET_PHRASE;

  // Проверяем наличие хотя бы одного из ключей
  if (!envKey && !secretPhrase) {
    throw new Error(
      'Encryption key is not configured. Please set either ROO_TRACE_ENCRYPTION_KEY or ROO_TRACE_SECRET_PHRASE environment variable.'
    );
  }

  // Если используется ROO_TRACE_ENCRYPTION_KEY, проверяем его формат
  if (envKey) {
    // Проверяем, что строка состоит только из шестнадцатеричных символов
    if (!/^[0-9a-fA-F]+$/.test(envKey)) {
      throw new Error(
        `Invalid ROO_TRACE_ENCRYPTION_KEY format. Must be a 64-character hex string.`
      );
    }
    // Проверяем длину
    if (envKey.length !== 64) {
      throw new Error(
        `Invalid ROO_TRACE_ENCRYPTION_KEY length. Expected 64 hex characters (32 bytes), got ${envKey.length}.`
      );
    }
    // Дополнительная проверка через Buffer для гарантии
    let keyBuffer: Buffer;
    try {
      keyBuffer = Buffer.from(envKey, 'hex');
    } catch (error) {
      // Эта ошибка не должна происходить после проверки hex, но на всякий случай
      throw new Error(
        `Invalid ROO_TRACE_ENCRYPTION_KEY format. Must be a 64-character hex string.`
      );
    }
    if (keyBuffer.length !== 32) {
      // Эта ошибка также не должна происходить при корректном hex, но оставляем как защиту
      throw new Error(
        `Invalid ROO_TRACE_ENCRYPTION_KEY length. Expected 64 hex characters (32 bytes), got ${envKey.length}.`
      );
    }
  }

  // Если используется ROO_TRACE_SECRET_PHRASE, проверяем её качество
  if (secretPhrase) {
    if (secretPhrase === 'roo-trace-default-secret') {
      throw new Error(
        'Default secret phrase is not allowed. Please set a secure ROO_TRACE_SECRET_PHRASE environment variable.'
      );
    }

    if (secretPhrase.length < 12) {
      throw new Error(
        `ROO_TRACE_SECRET_PHRASE must be at least 12 characters long. Current length: ${secretPhrase.length}.`
      );
    }
  }
}

/**
 * Проверяет, настроен ли ключ шифрования
 * @returns true если ключ настроен, false в противном случае
 */
export function isEncryptionKeyConfigured(): boolean {
  const envKey = process.env.ROO_TRACE_ENCRYPTION_KEY;
  const secretPhrase = process.env.ROO_TRACE_SECRET_PHRASE;

  if (!envKey && !secretPhrase) {
    return false;
  }

  if (envKey) {
    try {
      const keyBuffer = Buffer.from(envKey, 'hex');
      return keyBuffer.length === 32;
    } catch {
      return false;
    }
  }

  if (secretPhrase) {
    return secretPhrase !== 'roo-trace-default-secret' && secretPhrase.length >= 12;
  }

  return false;
}