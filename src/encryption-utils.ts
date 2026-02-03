import * as crypto from 'crypto';
import * as path from 'path';
import { getWorkspaceRoot } from './utils/workspace-utils';
import { logDebug, handleError } from './error-handler';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

// Константы для валидации
const DEFAULT_SECRET_PHRASE = 'roo-trace-default-secret';
const MIN_SECRET_PHRASE_LENGTH = 12;
const MIN_ENTROPY_BITS = 80;

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
 * Вычисляет энтропию строки (приблизительно)
 * @param str Входная строка
 * @returns Энтропия в битах
 */
function calculateEntropy(str: string): number {
  const freq: Record<string, number> = {};
  for (const ch of str) {
    freq[ch] = (freq[ch] || 0) + 1;
  }
  let entropy = 0;
  const len = str.length;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Валидирует секретную фразу
 * @param secretPhrase Секретная фраза
 * @throws Error если фраза небезопасна
 */
export function validateSecretPhrase(secretPhrase: string): void {
  if (secretPhrase === DEFAULT_SECRET_PHRASE) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Default secret phrase is not allowed in production. Please set ROO_TRACE_SECRET_PHRASE environment variable.');
    } else {
      handleError(new Error('Using default secret phrase in development. This is insecure for production.'), 'encryption-utils');
    }
  }

  if (secretPhrase.length < MIN_SECRET_PHRASE_LENGTH) {
    throw new Error(`Secret phrase must be at least ${MIN_SECRET_PHRASE_LENGTH} characters long.`);
  }

  const entropy = calculateEntropy(secretPhrase);
  if (entropy < MIN_ENTROPY_BITS) {
    logDebug(`Secret phrase entropy is low (${entropy.toFixed(2)} bits). Consider using a more random phrase.`, 'encryption-utils');
  }
}

/**
 * Генерирует уникальный salt на основе workspace path
 * @returns Уникальный salt в виде строки
 */
export function generateWorkspaceSalt(): string {
  try {
    const workspaceRoot = getWorkspaceRoot();
    // Хешируем путь workspace для получения детерминированного salt
    const hash = crypto.createHash('sha256').update(workspaceRoot).digest('hex');
    return hash.substring(0, 16); // Используем первые 16 символов
  } catch (error) {
    // Если workspace не доступен, используем fallback на основе текущей директории
    const cwd = process.cwd();
    const hash = crypto.createHash('sha256').update(cwd).digest('hex');
    return hash.substring(0, 16);
  }
}

/**
 * Получает ключ шифрования с уникальным salt для workspace
 * @returns Ключ шифрования
 * @throws Error если ключ не настроен или недействителен
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
  }
  
  // Проверяем наличие секретной фразы
  const secretPhrase = process.env.ROO_TRACE_SECRET_PHRASE;
  
  if (!secretPhrase) {
    throw new Error(
      'Encryption key is not configured. Please set either ROO_TRACE_ENCRYPTION_KEY or ROO_TRACE_SECRET_PHRASE environment variable.'
    );
  }
  
  // Проверяем, что не используется дефолтная фраза
  if (secretPhrase === DEFAULT_SECRET_PHRASE) {
    throw new Error(
      'Default secret phrase is not allowed. Please set a secure ROO_TRACE_SECRET_PHRASE environment variable.'
    );
  }
  
  // Валидация фразы (проверка длины)
  if (secretPhrase.length < MIN_SECRET_PHRASE_LENGTH) {
    throw new Error(
      `Secret phrase must be at least ${MIN_SECRET_PHRASE_LENGTH} characters long.`
    );
  }
  
  // Генерируем уникальный salt для workspace
  const salt = generateWorkspaceSalt();
  
  // Используем scrypt с увеличенной стоимостью (N=16384, r=8, p=1)
  return crypto.scryptSync(secretPhrase, salt, KEY_LENGTH, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024 // 128 MB
  });
}

/**
 * Мигрирует зашифрованные данные с одного ключа на другой
 * @param encryptedData Зашифрованные данные (base64)
 * @param oldKey Старый ключ
 * @param newKey Новый ключ
 * @returns Перешифрованные данные
 */
export function migrateEncryptionKey(
  encryptedData: string,
  oldKey: Buffer,
  newKey: Buffer
): string {
  try {
    const decrypted = decryptString(encryptedData, oldKey);
    return encryptString(decrypted, newKey);
  } catch (error) {
    throw new Error(`Failed to migrate encryption key: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Проверяет, используется ли default secret phrase
 * @returns true если используется дефолтная фраза
 */
export function isUsingDefaultSecretPhrase(): boolean {
  const secretPhrase = process.env.ROO_TRACE_SECRET_PHRASE || DEFAULT_SECRET_PHRASE;
  return secretPhrase === DEFAULT_SECRET_PHRASE;
}

/**
 * Генерирует новый ключ на основе секретной фразы и salt
 * @param secretPhrase Секретная фраза
 * @param salt Соль (опционально, если не указана - генерируется из workspace)
 * @returns Ключ шифрования
 */
export function deriveKeyFromPhrase(secretPhrase: string, salt?: string): Buffer {
  const actualSalt = salt || generateWorkspaceSalt();
  return crypto.scryptSync(secretPhrase, actualSalt, KEY_LENGTH, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024
  });
}