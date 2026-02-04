/**
 * Утилита для атомарной записи файлов с использованием паттерна write-temporary-rename.
 * Гарантирует, что файл никогда не остаётся в повреждённом состоянии (только целый старый или целый новый).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logDebug } from './error-handler';

/**
 * Опции атомарной записи.
 */
export interface AtomicWriteOptions {
  /**
   * Валидировать JSON перед переименованием (по умолчанию false).
   * Если true, данные будут проверены на корректность JSON.
   */
  validateJson?: boolean;

  /**
   * Кодировка файла (по умолчанию 'utf-8').
   */
  encoding?: BufferEncoding;

  /**
   * Удалять временные файлы старше указанного возраста (в миллисекундах).
   * По умолчанию 3600000 (1 час). Установите 0 для отключения очистки.
   */
  cleanupOldTempFiles?: number;

  /**
   * Режим файла (по умолчанию 0o644).
   */
  mode?: number;
}

/**
 * Атомарно записывает данные в файл.
 * 
 * Алгоритм:
 * 1. Создаёт временный файл в той же директории с суффиксом .tmp
 * 2. Записывает данные во временный файл
 * 3. При необходимости валидирует JSON
 * 4. Атомарно переименовывает временный файл в целевой (fs.rename)
 * 5. В случае ошибки удаляет временный файл, оставляя целевой неизменным
 * 
 * @param filePath Целевой путь к файлу
 * @param data Данные для записи (строка или Buffer)
 * @param options Опции атомарной записи
 */
export async function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const {
    validateJson = false,
    encoding = 'utf-8',
    cleanupOldTempFiles = 3600000, // 1 час
    mode = 0o644
  } = options;

  const dir = path.dirname(filePath);
  const filename = path.basename(filePath);
  const tempPath = path.join(dir, `.${filename}.tmp`);

  // Очистка старых временных файлов (если включено)
  if (cleanupOldTempFiles > 0) {
    await cleanupTempFiles(dir, cleanupOldTempFiles).catch(err => {
      logDebug(`Failed to cleanup temp files: ${err.message}`);
    });
  }

  // Преобразуем данные в строку для валидации JSON, если нужно
  const dataString = typeof data === 'string' ? data : data.toString(encoding);

  // Валидация JSON перед записью
  if (validateJson) {
    try {
      JSON.parse(dataString);
    } catch (error) {
      throw new Error(`Invalid JSON data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Создаём директорию, если её нет
  await fs.mkdir(dir, { recursive: true });

  // Записываем во временный файл
  try {
    await fs.writeFile(tempPath, data, { encoding: typeof data === 'string' ? encoding : undefined, mode });
  } catch (writeError) {
    // Удаляем временный файл, если он был частично создан
    await fs.unlink(tempPath).catch(() => {});
    throw new Error(`Failed to write temporary file: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
  }

  // Атомарное переименование
  try {
    await fs.rename(tempPath, filePath);
    logDebug(`Atomic write successful: ${filePath}`);
  } catch (renameError) {
    // Удаляем временный файл при ошибке переименования
    await fs.unlink(tempPath).catch(() => {});
    throw new Error(`Failed to rename temporary file: ${renameError instanceof Error ? renameError.message : String(renameError)}`);
  }
}

/**
 * Очищает старые временные файлы в указанной директории.
 * @param dir Директория для очистки
 * @param maxAge Максимальный возраст файла в миллисекундах
 */
async function cleanupTempFiles(dir: string, maxAge: number): Promise<void> {
  try {
    const files = await fs.readdir(dir);
    const now = Date.now();

    for (const file of files) {
      if (file.endsWith('.tmp') && file.startsWith('.')) {
        const filePath = path.join(dir, file);
        try {
          const stats = await fs.stat(filePath);
          if (now - stats.mtimeMs > maxAge) {
            await fs.unlink(filePath);
            logDebug(`Cleaned up old temp file: ${filePath}`);
          }
        } catch (err) {
          // Игнорируем ошибки доступа к файлу
        }
      }
    }
  } catch (err) {
    // Игнорируем ошибки чтения директории
  }
}

/**
 * Читает файл и возвращает его содержимое.
 * Если файл не существует, возвращает null.
 * @param filePath Путь к файлу
 * @param encoding Кодировка (по умолчанию 'utf-8')
 */
export async function readFileIfExists(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string | null> {
  try {
    return await fs.readFile(filePath, encoding);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Атомарно записывает JSON объект в файл.
 * @param filePath Целевой путь к файлу
 * @param jsonData JSON-совместимые данные
 * @param options Опции атомарной записи (validateJson будет проигнорировано, так как всегда true)
 */
export async function atomicWriteJson(
  filePath: string,
  jsonData: any,
  options: Omit<AtomicWriteOptions, 'validateJson'> = {}
): Promise<void> {
  const {
    encoding = 'utf-8',
    cleanupOldTempFiles = 3600000,
    mode = 0o644
  } = options;
  
  // Используем потоковую запись вместо синхронного JSON.stringify
  await writeJSONStream(filePath, jsonData, {
    pretty: true,  // для совместимости с JSON.stringify(jsonData, null, 2)
    encoding: encoding as BufferEncoding,
    mode
  });
  
  // Очистка старых временных файлов
  if (cleanupOldTempFiles > 0) {
    await cleanupTempFiles(path.dirname(filePath), cleanupOldTempFiles).catch(err => {
      logDebug(`Failed to cleanup temp files: ${err.message}`);
    });
  }
}

// Импорт необходим для работы с потоковой записью
import { writeJSONStream } from './streaming-json';