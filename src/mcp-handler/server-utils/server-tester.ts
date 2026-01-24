/**
 * Утилиты для тестирования работоспособности сервера
 * 
 * Этот модуль предоставляет функции для проверки работоспособности
 * HTTP сервера через тестовую запись и чтение данных.
 */

import * as http from 'http';
import { SharedLogStorage } from '../../shared-log-storage';
import { logDebug } from '../../error-handler';
import type { RuntimeLog } from '../../types';

/**
 * Результат тестирования сервера
 */
export interface ServerTestResult {
  success: boolean;
  error?: string;
}

/**
 * Тестирует работоспособность сервера через запись/чтение
 * 
 * Алгоритм тестирования:
 * 1. Отправляет тестовый POST запрос на сервер
 * 2. Ждет завершения записи (200ms)
 * 3. Читает логи из storage
 * 4. Ищет тестовый лог по hypothesisId и message
 * 5. Проверяет, что testId совпадает
 * 
 * @param serverUrl - URL сервера для тестирования
 * @param sharedStorage - Экземпляр SharedLogStorage для чтения логов
 * @returns Результат тестирования
 */
export async function testServerWriteRead(
  serverUrl: string,
  sharedStorage: SharedLogStorage
): Promise<ServerTestResult> {
  const testId = `test_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const testMessage = `Server test: ${testId}`;
  const testData = {
    hypothesisId: 'H1',
    message: testMessage,
    state: { testId, timestamp: new Date().toISOString() }
  };

  return new Promise((resolve) => {
    try {
      // Шаг 1: Отправляем тестовый POST запрос
      const url = new URL(serverUrl);
      const postData = JSON.stringify(testData);
      
      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 51234,
        path: url.pathname || '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 5000
      };

      const req = http.request(options, async (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk.toString();
        });
        
        res.on('end', async () => {
          try {
            // Проверяем ответ сервера
            if (res.statusCode !== 200) {
              resolve({ success: false, error: `Server returned status ${res.statusCode}: ${responseData}` });
              return;
            }

            // Шаг 2: Ждем немного, чтобы запись завершилась
            await new Promise(resolve => setTimeout(resolve, 200));

            // Шаг 3: Читаем логи из storage
            const logs = await sharedStorage.getLogs();
            
            // Шаг 4: Ищем наш тестовый лог
            const testLog = logs.find((log: RuntimeLog) => 
              log.hypothesisId === 'H1' && 
              log.context === testMessage
            );

            if (!testLog) {
              resolve({ 
                success: false, 
                error: `Test log not found in storage. Total logs: ${logs.length}` 
              });
              return;
            }

            // Шаг 5: Проверяем, что данные совпадают
            if (testLog.data && typeof testLog.data === 'object' && 'testId' in testLog.data) {
              const logTestId = (testLog.data as any).testId;
              if (logTestId === testId) {
                // Тестовый лог оставляем в storage - он не помешает и может быть полезен для диагностики
                logDebug(`Server test passed: write/read verified, testId=${testId}`, 'MCPHandler.testServerWriteRead');
                resolve({ success: true });
              } else {
                resolve({ 
                  success: false, 
                  error: `Test ID mismatch: expected ${testId}, got ${logTestId}` 
                });
              }
            } else {
              resolve({ 
                success: false, 
                error: `Test log data format incorrect: ${JSON.stringify(testLog.data)}` 
              });
            }
          } catch (error) {
            resolve({ 
              success: false, 
              error: `Error reading logs: ${error instanceof Error ? error.message : String(error)}` 
            });
          }
        });
      });

      req.on('error', (error) => {
        resolve({ 
          success: false, 
          error: `HTTP request error: ${error.message}` 
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ 
          success: false, 
          error: 'HTTP request timeout' 
        });
      });

      req.write(postData);
      req.end();

    } catch (error) {
      resolve({ 
        success: false, 
        error: `Test setup error: ${error instanceof Error ? error.message : String(error)}` 
      });
    }
  });
}
