import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Генерирует случайный ключ шифрования
 * @returns Буфер сгенерированного ключа
 */
export function generateEncryptionKey(): Buffer {
  return crypto.randomBytes(KEY_LENGTH);
}

/**
 * Шифрует строку с использованием ключа
 * @param text Текст для шифрования
 * @param key Ключ шифрования
 * @returns Зашифрованные данные в формате base64
 */
export function encryptString(text: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Соединяем IV, тег аутентификации и зашифрованные данные
  const result = Buffer.concat([iv, authTag, encrypted]);
  
  return result.toString('base64');
}

/**
 * Расшифровывает строку с использованием ключа
 * @param encryptedText Зашифрованный текст в формате base64
 * @param key Ключ шифрования
 * @returns Расшифрованный текст
 */
export function decryptString(encryptedText: string, key: Buffer): string {
  const buffer = Buffer.from(encryptedText, 'base64');
  
  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encryptedData = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  
  return decrypted.toString('utf8');
}

/**
 * Шифрует объект и возвращает его в виде строки
 * @param obj Объект для шифрования
 * @param key Ключ шифрования
 * @returns Зашифрованная строка
 */
export function encryptObject(obj: any, key: Buffer): string {
  const jsonString = JSON.stringify(obj);
  return encryptString(jsonString, key);
}

/**
 * Расшифровывает строку и возвращает объект
 * @param encryptedText Зашифрованный текст
 * @param key Ключ шифрования
 * @returns Расшифрованный объект
 */
export function decryptObject(encryptedText: string, key: Buffer): any {
  const decryptedString = decryptString(encryptedText, key);
  return JSON.parse(decryptedString);
}

/**
 * Получает ключ шифрования из переменной окружения или создает новый
 * @returns Ключ шифрования
 */
export function getEncryptionKey(): Buffer {
  const envKey = process.env.ROO_TRACE_ENCRYPTION_KEY;
  if (envKey) {
    // Если ключ задан в переменной окружения, используем его
    const keyBuffer = Buffer.from(envKey, 'hex');
    if (keyBuffer.length !== KEY_LENGTH) {
      throw new Error(`Invalid encryption key length. Expected ${KEY_LENGTH} bytes.`);
    }
    return keyBuffer;
  } else {
    // В противном случае, генерируем ключ из секретной фразы (в реальном приложении лучше использовать безопасное хранилище)
    const secretPhrase = process.env.ROO_TRACE_SECRET_PHRASE || 'roo-trace-default-secret';
    return crypto.scryptSync(secretPhrase, 'salt', KEY_LENGTH);
  }
}