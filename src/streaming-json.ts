/**
 * Потоковое чтение и запись JSON для больших файлов логов
 * 
 * Решает проблему блокировки UI на 200-500ms при использовании JSON.stringify
 * с большими массивами логов (10k+ записей).
 * 
 * Использует Node.js streams для инкрементальной обработки данных.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Readable, Writable } from 'stream';
import { promisify } from 'util';
import { logDebug } from './error-handler';

const pipeline = promisify(require('stream').pipeline);

/**
 * Опции для потокового чтения JSON
 */
export interface ParseJSONStreamOptions {
  /**
   * Максимальный размер файла в байтах (по умолчанию 100MB)
   */
  maxFileSize?: number;
  
  /**
   * Кодировка файла (по умолчанию 'utf-8')
   */
  encoding?: BufferEncoding;
  
  /**
   * Валидировать JSON перед парсингом (по умолчанию true)
   */
  validateJson?: boolean;
}

/**
 * Опции для потоковой записи JSON
 */
export interface WriteJSONStreamOptions {
  /**
   * Форматировать JSON с отступами (по умолчанию true)
   */
  pretty?: boolean;
  
  /**
   * Кодировка файла (по умолчанию 'utf-8')
   */
  encoding?: BufferEncoding;
  
  /**
   * Режим файла (по умолчанию 0o644)
   */
  mode?: number;
}

/**
 * Читает JSON файл через поток, предотвращая блокировку Event Loop
 * 
 * @param filePath Путь к JSON файлу
 * @param options Опции чтения
 * @returns Промис с распарсенными данными
 * 
 * @example
 * ```typescript
 * const data = await parseJSONStream('/path/to/large-log.json');
 * ```
 */
export async function parseJSONStream<T = any>(
  filePath: string,
  options: ParseJSONStreamOptions = {}
): Promise<T> {
  const {
    maxFileSize = 100 * 1024 * 1024, // 100MB
    encoding = 'utf-8',
    validateJson = true
  } = options;
  
  logDebug(`parseJSONStream: reading ${filePath}`, 'streaming-json');
  
  return new Promise<T>((resolve, reject) => {
    // Проверяем существование файла
    fs.stat(filePath, (statErr, stats) => {
      if (statErr) {
        if (statErr.code === 'ENOENT') {
          // Файл не существует - возвращаем null или пустой объект в зависимости от ожидаемого типа
          logDebug(`File ${filePath} does not exist, returning empty object`, 'streaming-json');
          return resolve({} as T);
        }
        return reject(statErr);
      }
      
      // Проверяем размер файла
      if (stats.size > maxFileSize) {
        return reject(new Error(`File size ${stats.size} bytes exceeds maximum ${maxFileSize} bytes`));
      }
      
      // Создаем поток для чтения
      const readStream = fs.createReadStream(filePath, { encoding });
      let data = '';
      
      readStream.on('data', (chunk: string) => {
        data += chunk;
      });
      
      readStream.on('end', () => {
        try {
          if (validateJson) {
            // Валидируем JSON перед парсингом
            JSON.parse(data);
          }
          const parsed = JSON.parse(data);
          logDebug(`parseJSONStream: successfully parsed ${filePath}, size: ${stats.size} bytes`, 'streaming-json');
          resolve(parsed);
        } catch (parseError) {
          reject(new Error(`Failed to parse JSON from ${filePath}: ${parseError instanceof Error ? parseError.message : String(parseError)}`));
        }
      });
      
      readStream.on('error', (streamError) => {
        reject(new Error(`Failed to read file ${filePath}: ${streamError.message}`));
      });
    });
  });
}

/**
 * Записывает данные в JSON файл через поток
 * 
 * @param filePath Путь к JSON файлу
 * @param data Данные для записи (любой JSON-сериализуемый объект)
 * @param options Опции записи
 * @returns Промис, который разрешается после завершения записи
 * 
 * @example
 * ```typescript
 * await writeJSONStream('/path/to/output.json', largeData);
 * ```
 */
export async function writeJSONStream(
  filePath: string,
  data: any,
  options: WriteJSONStreamOptions = {}
): Promise<void> {
  const {
    pretty = true,
    encoding = 'utf-8',
    mode = 0o644
  } = options;
  
  logDebug(`writeJSONStream: writing to ${filePath}`, 'streaming-json');
  
  return new Promise<void>((resolve, reject) => {
    // Создаем директорию если её нет
    const dir = path.dirname(filePath);
    fs.mkdir(dir, { recursive: true }, (mkdirErr) => {
      if (mkdirErr) {
        return reject(new Error(`Failed to create directory ${dir}: ${mkdirErr.message}`));
      }
      
      // Создаем временный файл для атомарной записи
      const tempPath = `${filePath}.tmp`;
      const writeStream = fs.createWriteStream(tempPath, { encoding, mode });
      
      // Сериализуем данные в JSON строку
      const jsonString = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
      
      // Создаем readable stream из строки
      const readable = Readable.from([jsonString]);
      
      // Используем pipeline для эффективной передачи данных
      readable.pipe(writeStream);
      
      writeStream.on('finish', () => {
        // Атомарно переименовываем временный файл в целевой
        fs.rename(tempPath, filePath, (renameErr) => {
          if (renameErr) {
            // Удаляем временный файл при ошибке
            fs.unlink(tempPath, () => {});
            return reject(new Error(`Failed to rename temporary file: ${renameErr.message}`));
          }
          
          logDebug(`writeJSONStream: successfully wrote ${filePath}, size: ${jsonString.length} bytes`, 'streaming-json');
          resolve();
        });
      });
      
      writeStream.on('error', (streamError) => {
        // Удаляем временный файл при ошибке
        fs.unlink(tempPath, () => {});
        reject(new Error(`Failed to write file ${filePath}: ${streamError.message}`));
      });
    });
  });
}

/**
 * Потоковое чтение больших JSON массивов с обработкой по частям
 * 
 * @param filePath Путь к JSON файлу
 * @param onChunk Колбек, вызываемый для каждого элемента массива
 * @param options Опции чтения
 * @returns Промис с общим количеством обработанных элементов
 * 
 * @example
 * ```typescript
 * let count = 0;
 * await streamJSONArray('/path/to/large-array.json', (item) => {
 *   count++;
 *   console.log(`Processed item ${count}:`, item);
 * });
 * ```
 */
export async function streamJSONArray<T = any>(
  filePath: string,
  onChunk: (item: T, index: number) => void | Promise<void>,
  options: ParseJSONStreamOptions = {}
): Promise<number> {
  const {
    maxFileSize = 100 * 1024 * 1024,
    encoding = 'utf-8'
  } = options;
  
  logDebug(`streamJSONArray: streaming from ${filePath}`, 'streaming-json');
  
  return new Promise<number>((resolve, reject) => {
    fs.stat(filePath, (statErr, stats) => {
      if (statErr) {
        if (statErr.code === 'ENOENT') {
          logDebug(`File ${filePath} does not exist, returning 0 items`, 'streaming-json');
          return resolve(0);
        }
        return reject(statErr);
      }
      
      if (stats.size > maxFileSize) {
        return reject(new Error(`File size ${stats.size} bytes exceeds maximum ${maxFileSize} bytes`));
      }
      
      const readStream = fs.createReadStream(filePath, { encoding });
      let buffer = '';
      let inArray = false;
      let depth = 0;
      let itemIndex = 0;
      let itemBuffer = '';
      
      readStream.on('data', (chunk: string) => {
        buffer += chunk;
        
        // Обрабатываем буфер для извлечения элементов массива
        let pos = 0;
        while (pos < buffer.length) {
          const char = buffer[pos];
          
          if (!inArray) {
            // Ищем начало массива '['
            if (char === '[') {
              inArray = true;
              depth = 1;
              pos++;
              continue;
            }
            pos++;
            continue;
          }
          
          // Мы внутри массива
          if (char === '[' || char === '{') {
            depth++;
            itemBuffer += char;
          } else if (char === ']' || char === '}') {
            depth--;
            itemBuffer += char;
            
            // Если мы вышли из массива верхнего уровня
            if (depth === 0 && char === ']') {
              // Массив закончился
              buffer = buffer.substring(pos + 1);
              break;
            }
            
            // Если мы закончили объект/массив внутри
            if (depth === 1 && char === '}') {
              // Завершили объект - это может быть элемент массива
              // Проверяем следующий символ
              const nextPos = pos + 1;
              if (nextPos < buffer.length && buffer[nextPos] === ',') {
                // Элемент массива завершен, следующий - запятая
                try {
                  const item = JSON.parse(itemBuffer);
                  // Вызываем колбек асинхронно
                  Promise.resolve(onChunk(item, itemIndex++)).catch(err => {
                    logDebug(`Error in onChunk callback: ${err.message}`, 'streaming-json');
                  });
                } catch (parseErr) {
                  logDebug(`Failed to parse array item at index ${itemIndex}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`, 'streaming-json');
                }
                itemBuffer = '';
                pos = nextPos; // Пропускаем запятую
                continue;
              } else if (nextPos < buffer.length && buffer[nextPos] === ']') {
                // Последний элемент массива
                try {
                  const item = JSON.parse(itemBuffer);
                  Promise.resolve(onChunk(item, itemIndex++)).catch(err => {
                    logDebug(`Error in onChunk callback: ${err.message}`, 'streaming-json');
                  });
                } catch (parseErr) {
                  logDebug(`Failed to parse last array item: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`, 'streaming-json');
                }
                itemBuffer = '';
                buffer = buffer.substring(nextPos);
                break;
              }
            }
          } else if (depth === 1 && char === ',') {
            // Запятая на уровне массива - элемент завершен
            if (itemBuffer.trim()) {
              try {
                const item = JSON.parse(itemBuffer);
                Promise.resolve(onChunk(item, itemIndex++)).catch(err => {
                  logDebug(`Error in onChunk callback: ${err.message}`, 'streaming-json');
                });
              } catch (parseErr) {
                logDebug(`Failed to parse array item at index ${itemIndex}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`, 'streaming-json');
              }
              itemBuffer = '';
            }
          } else {
            itemBuffer += char;
          }
          
          pos++;
        }
        
        // Сохраняем остаток буфера
        if (pos < buffer.length) {
          buffer = buffer.substring(pos);
        } else {
          buffer = '';
        }
      });
      
      readStream.on('end', () => {
        // Обрабатываем последний элемент если есть
        if (itemBuffer.trim()) {
          try {
            const item = JSON.parse(itemBuffer);
            Promise.resolve(onChunk(item, itemIndex++)).catch(err => {
              logDebug(`Error in onChunk callback: ${err.message}`, 'streaming-json');
            });
          } catch (parseErr) {
            logDebug(`Failed to parse final array item: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`, 'streaming-json');
          }
        }
        
        logDebug(`streamJSONArray: processed ${itemIndex} items from ${filePath}`, 'streaming-json');
        resolve(itemIndex);
      });
      
      readStream.on('error', (streamError) => {
        reject(new Error(`Failed to read file ${filePath}: ${streamError.message}`));
      });
    });
  });
}

/**
 * Потоковая запись больших JSON массивов
 * 
 * @param filePath Путь к JSON файлу
 * @param items Итератор или массив элементов
 * @param options Опции записи
 * @returns Промис с количеством записанных элементов
 * 
 * @example
 * ```typescript
 * const largeArray = Array.from({ length: 10000 }, (_, i) => ({ id: i }));
 * await writeJSONArrayStream('/path/to/output.json', largeArray);
 * ```
 */
export async function writeJSONArrayStream<T = any>(
  filePath: string,
  items: Iterable<T> | AsyncIterable<T>,
  options: WriteJSONStreamOptions = {}
): Promise<number> {
  const {
    pretty = false, // Для массивов обычно не форматируем для экономии места
    encoding = 'utf-8',
    mode = 0o644
  } = options;
  
  logDebug(`writeJSONArrayStream: writing array to ${filePath}`, 'streaming-json');
  
  return new Promise<number>((resolve, reject) => {
    const dir = path.dirname(filePath);
    fs.mkdir(dir, { recursive: true }, (mkdirErr) => {
      if (mkdirErr) {
        return reject(new Error(`Failed to create directory ${dir}: ${mkdirErr.message}`));
      }
      
      const tempPath = `${filePath}.tmp`;
      const writeStream = fs.createWriteStream(tempPath, { encoding, mode });
      let itemCount = 0;
      let isFirstItem = true;
      
      // Пишем открывающую скобку массива
      writeStream.write('[');
      
      const processItems = async () => {
        try {
          for await (const item of items) {
            const separator = isFirstItem ? '' : ',';
            const jsonString = pretty ? 
              `${separator}\n${JSON.stringify(item, null, 2)}` : 
              `${separator}${JSON.stringify(item)}`;
            
            if (!writeStream.write(jsonString)) {
              // Буфер полон, ждем drain события
              await new Promise<void>((resolveDrain) => {
                writeStream.once('drain', resolveDrain);
              });
            }
            
            itemCount++;
            isFirstItem = false;
          }
          
          // Закрываем массив
          writeStream.write(pretty ? '\n]' : ']');
          writeStream.end();
        } catch (error) {
          writeStream.destroy();
          fs.unlink(tempPath, () => {});
          reject(new Error(`Failed to write array items: ${error instanceof Error ? error.message : String(error)}`));
        }
      };
      
      writeStream.on('finish', () => {
        // Атомарно переименовываем
        fs.rename(tempPath, filePath, (renameErr) => {
          if (renameErr) {
            fs.unlink(tempPath, () => {});
            return reject(new Error(`Failed to rename temporary file: ${renameErr.message}`));
          }
          
          logDebug(`writeJSONArrayStream: wrote ${itemCount} items to ${filePath}`, 'streaming-json');
          resolve(itemCount);
        });
      });
      
      writeStream.on('error', (streamError) => {
        fs.unlink(tempPath, () => {});
        reject(new Error(`Failed to write file ${filePath}: ${streamError.message}`));
      });
      
      // Запускаем обработку элементов
      processItems().catch(reject);
    });
  });
}

/**
 * Экспортируем утилиты для совместимости с существующим API
 */
export default {
  parseJSONStream,
  writeJSONStream,
  streamJSONArray,
  writeJSONArrayStream
};