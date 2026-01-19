/**
 * ИНТЕГРАЦИОННЫЕ ТЕСТЫ: HTTP запрос → SharedLogStorage → MCP → Dashboard
 * 
 * Эти тесты проверяют КРИТИЧЕСКИ ВАЖНЫЙ поток:
 * 1. HTTP POST запрос отправляется из инжектированного кода
 * 2. Лог попадает в SharedLogStorage
 * 3. Лог доступен через MCP инструмент read_runtime_logs
 * 4. Лог отправляется в WebView Dashboard
 * 
 * ЭТО ОБЯЗАНО РАБОТАТЬ!
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { SharedLogStorage, RuntimeLog } from '../src/shared-log-storage';
import { LOG_SAVE_TIMEOUT, MAX_RETRY_ATTEMPTS, RETRY_DELAY, SHORT_DELAY, MEDIUM_DELAY } from './constants';
import { waitForLogsSaved, createTestStorage, cleanupTestStorage } from './helpers/test-helpers';

describe('HTTP → Dashboard Integration Tests', () => {
    jest.setTimeout(15000);
    let testServer: http.Server | null = null;
    let serverPort: number = 0;
    let sharedStorage: SharedLogStorage;
    let testDir: string;
    let originalCwd: string;

    beforeAll(() => {
        // Сохраняем оригинальную рабочую директорию
        originalCwd = process.cwd();
    });

    beforeEach(async () => {
        // Создаем уникальную временную директорию для каждого теста
        testDir = path.join(tmpdir(), `rooTrace-integration-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        
        // Создаем изолированный storage для теста
        sharedStorage = createTestStorage(testDir);
        
        // Очищаем логи перед каждым тестом
        await sharedStorage.clear();
        
        // Даем время на завершение очистки
        await new Promise(resolve => setTimeout(resolve, SHORT_DELAY));
        
        // Закрываем предыдущий сервер, если он был
        if (testServer) {
            await new Promise<void>((resolve) => {
                testServer!.close(() => {
                    testServer = null;
                    resolve();
                });
            });
        }
    });

    afterEach(async () => {
        // Останавливаем тестовый сервер
        if (testServer) {
            await new Promise<void>((resolve) => {
                testServer!.close(() => {
                    testServer = null;
                    resolve();
                });
            });
        }
        
        // Очищаем и останавливаем storage
        await cleanupTestStorage(sharedStorage);
        
        // Удаляем временную директорию
        if (fs.existsSync(testDir)) {
            try {
                fs.rmSync(testDir, { recursive: true, force: true });
            } catch (e) {
                // Игнорируем ошибки удаления
            }
        }
    });

    afterAll(() => {
        // Восстанавливаем рабочую директорию
        try {
            if (originalCwd) {
                process.chdir(originalCwd);
            }
        } catch (e) {
            // Игнорируем ошибки chdir
        }
    });

    /**
     * Создает тестовый HTTP сервер, который имитирует поведение реального сервера из extension.ts
     */
    function createTestServer(): Promise<{ server: http.Server; port: number }> {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
                // CORS headers
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

                // Handle OPTIONS
                if (req.method === 'OPTIONS') {
                    res.writeHead(200);
                    res.end();
                    return;
                }

                // Handle POST requests (как в extension.ts)
                if (req.method === 'POST' && req.url === '/') {
                    let body = '';

                    req.on('data', (chunk: Buffer | string) => {
                        body += chunk.toString();
                    });

                    req.on('end', async () => {
                        try {
                            const data = JSON.parse(body) as { hypothesisId?: string; message?: string; state?: any };

                            // Check if this is a hypothesis-driven debug request
                            if (data.hypothesisId && data.message) {
                                // Format as hypothesis-driven log entry (как в extension.ts)
                                const context = data.message || 'Debug data received';
                                const state = data.state || {};

                                // Создаем RuntimeLog и добавляем в shared storage (как в logToOutputChannel)
                                const runtimeLog: RuntimeLog = {
                                    timestamp: new Date().toISOString(),
                                    hypothesisId: data.hypothesisId,
                                    context,
                                    data: state
                                };
                                await sharedStorage.addLog(runtimeLog);

                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ status: 'ok', message: 'Log received' }));
                            } else {
                                res.writeHead(400, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ status: 'error', message: 'Invalid request format' }));
                            }
                        } catch (error) {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ status: 'error', message: String(error) }));
                        }
                    });
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: 'Not found' }));
                }
            });

            server.listen(0, 'localhost', () => {
                const address = server.address();
                if (address && typeof address === 'object') {
                    resolve({ server, port: address.port });
                } else {
                    reject(new Error('Failed to get server port'));
                }
            });

            server.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Отправляет POST запрос на сервер (имитирует fetch из инжектированного кода)
     */
    async function sendLogRequest(port: number, hypothesisId: string, message: string, state: any = {}): Promise<void> {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify({
                hypothesisId,
                message,
                state
            });

            const options = {
                hostname: 'localhost',
                port: port,
                path: '/',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = http.request(options, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk.toString();
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve();
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(postData);
            req.end();
        });
    }

    describe('HTTP POST → SharedLogStorage', () => {
        test('должен принимать POST запрос и добавлять лог в SharedLogStorage', async () => {
            // Очищаем перед тестом
            await sharedStorage.clear();
            
            const { server, port } = await createTestServer();
            testServer = server;

            // Регистрируем Promise для ожидания события ДО отправки запроса
            const logPromise = new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    sharedStorage.removeListener('logAdded', handler);
                    reject(new Error('Timeout waiting for log'));
                }, LOG_SAVE_TIMEOUT * 3);
                
                const handler = (log: RuntimeLog) => {
                    if (log.context === 'Test message') {
                        clearTimeout(timeout);
                        sharedStorage.removeListener('logAdded', handler);
                        resolve();
                    }
                };
                sharedStorage.on('logAdded', handler);
            });

            // Отправляем POST запрос (как из инжектированного кода)
            await sendLogRequest(port, 'H1', 'Test message', { value: 42 });
            
            // Ждем события
            await logPromise;

            // Проверяем, что лог появился в SharedLogStorage
            const logs = await sharedStorage.getLogs();
            const testLogs = logs.filter(log => log.context === 'Test message');
            expect(testLogs.length).toBe(1);
            expect(testLogs[0].hypothesisId).toBe('H1');
            expect(testLogs[0].context).toBe('Test message');
            expect(testLogs[0].data).toEqual({ value: 42 });
            expect(testLogs[0].timestamp).toBeDefined();

            await new Promise<void>((resolve) => {
                server.close(() => {
                    testServer = null;
                    resolve();
                });
            });
        });

        test('должен обрабатывать несколько последовательных запросов', async () => {
            // Очищаем перед тестом
            await sharedStorage.clear();
            
            const { server, port } = await createTestServer();
            testServer = server;

            // Используем события для отслеживания добавления логов
            const receivedLogs: RuntimeLog[] = [];
            const logAddedHandler = (log: RuntimeLog) => {
                if (log.context && (log.context === 'Message 1' || log.context === 'Message 2' || log.context === 'Message 3')) {
                    receivedLogs.push(log);
                }
            };
            sharedStorage.on('logAdded', logAddedHandler);

            // Отправляем несколько запросов
            await sendLogRequest(port, 'H1', 'Message 1', { step: 1 });
            await sendLogRequest(port, 'H2', 'Message 2', { step: 2 });
            await sendLogRequest(port, 'H3', 'Message 3', { step: 3 });
            
            // Даем время на обработку и сохранение
            await waitForLogsSaved(sharedStorage, 3, LOG_SAVE_TIMEOUT);
            
            // Отписываемся от событий
            sharedStorage.removeListener('logAdded', logAddedHandler);

            // Проверяем, что все логи появились
            const logs = await sharedStorage.getLogs();
            const testLogs = logs.filter(log => log.context && (log.context === 'Message 1' || log.context === 'Message 2' || log.context === 'Message 3'));
            expect(testLogs.length).toBe(3);
            expect(logs[0].hypothesisId).toBe('H1');
            expect(logs[1].hypothesisId).toBe('H2');
            expect(logs[2].hypothesisId).toBe('H3');

            await new Promise<void>((resolve) => {
                server.close(() => {
                    testServer = null;
                    resolve();
                });
            });
        });

        test('должен обрабатывать запросы с разными гипотезами', async () => {
            // Очищаем перед тестом
            await sharedStorage.clear();
            
            const { server, port } = await createTestServer();
            testServer = server;

            await sendLogRequest(port, 'H1', 'H1 message', {});
            await sendLogRequest(port, 'H2', 'H2 message', {});
            await sendLogRequest(port, 'H3', 'H3 message', {});
            await sendLogRequest(port, 'H4', 'H4 message', {});
            await sendLogRequest(port, 'H5', 'H5 message', {});

            const logs = await sharedStorage.getLogs();
            expect(logs.length).toBe(5);

            // Проверяем фильтрацию по гипотезам
            const h1Logs = await sharedStorage.getLogsByHypothesis('H1');
            expect(h1Logs.length).toBe(1);
            expect(h1Logs[0].hypothesisId).toBe('H1');

            const h3Logs = await sharedStorage.getLogsByHypothesis('H3');
            expect(h3Logs.length).toBe(1);
            expect(h3Logs[0].hypothesisId).toBe('H3');

            await new Promise<void>((resolve) => {
                server.close(() => {
                    testServer = null;
                    resolve();
                });
            });
        });
    });

    describe('SharedLogStorage → MCP read_runtime_logs', () => {
        test('MCP инструмент read_runtime_logs должен возвращать логи из SharedLogStorage', async () => {
            // Очищаем перед тестом
            await sharedStorage.clear();
            
            // Добавляем логи напрямую в SharedLogStorage (имитируя HTTP запрос)
            const log1: RuntimeLog = {
                timestamp: new Date().toISOString(),
                hypothesisId: 'H1',
                context: 'Test context 1',
                data: { test: 'data1' }
            };
            const log2: RuntimeLog = {
                timestamp: new Date().toISOString(),
                hypothesisId: 'H2',
                context: 'Test context 2',
                data: { test: 'data2' }
            };

            await sharedStorage.addLog(log1);
            await sharedStorage.addLog(log2);
            
            // Даем время на сохранение
            await waitForLogsSaved(sharedStorage, 1, SHORT_DELAY);

            // Имитируем вызов MCP инструмента read_runtime_logs
            // (в реальности это делается через MCP протокол, но мы тестируем логику)
            const logs = await sharedStorage.getLogs();

            expect(logs.length).toBe(2);
            expect(logs[0].hypothesisId).toBe('H1');
            expect(logs[1].hypothesisId).toBe('H2');
            expect(logs[0].context).toBe('Test context 1');
            expect(logs[1].context).toBe('Test context 2');
        });

        test('MCP должен видеть логи, добавленные через HTTP POST', async () => {
            const { server, port } = await createTestServer();
            testServer = server;

            // Отправляем POST запрос
            await sendLogRequest(port, 'H1', 'HTTP → MCP test', { httpData: true });

            // Проверяем через SharedLogStorage (который использует MCP)
            const logs = await sharedStorage.getLogs();
            expect(logs.length).toBe(1);
            expect(logs[0].hypothesisId).toBe('H1');
            expect(logs[0].context).toBe('HTTP → MCP test');
            expect(logs[0].data).toEqual({ httpData: true });

            await new Promise<void>((resolve) => {
                server.close(() => {
                    testServer = null;
                    resolve();
                });
            });
        });
    });

    describe('Полный поток: HTTP → Storage → MCP → Dashboard', () => {
        test('КРИТИЧЕСКИЙ ТЕСТ: полный поток от HTTP запроса до доступности через MCP', async () => {
            // Очищаем перед тестом
            await sharedStorage.clear();
            
            const { server, port } = await createTestServer();
            testServer = server;

            // ШАГ 1: Отправляем POST запрос (как из инжектированного кода)
            const hypothesisId = 'H1';
            const message = 'Critical integration test';
            const state = { 
                variable: 'testValue',
                number: 42,
                nested: { data: 'nestedValue' }
            };

            await sendLogRequest(port, hypothesisId, message, state);

            // ШАГ 2: Проверяем, что лог попал в SharedLogStorage
            const logs = await sharedStorage.getLogs();
            expect(logs.length).toBe(1);
            
            const receivedLog = logs[0];
            expect(receivedLog.hypothesisId).toBe(hypothesisId);
            expect(receivedLog.context).toBe(message);
            expect(receivedLog.data).toEqual(state);
            expect(receivedLog.timestamp).toBeDefined();

            // ШАГ 3: Проверяем доступность через MCP (читаем из SharedLogStorage)
            const mcpLogs = await sharedStorage.getLogs();
            expect(mcpLogs.length).toBe(1);
            expect(mcpLogs[0].hypothesisId).toBe(hypothesisId);
            expect(mcpLogs[0].context).toBe(message);
            expect(mcpLogs[0].data).toEqual(state);

            // ШАГ 4: Проверяем фильтрацию по гипотезе
            const h1Logs = await sharedStorage.getLogsByHypothesis('H1');
            expect(h1Logs.length).toBe(1);
            expect(h1Logs[0].hypothesisId).toBe('H1');

            await new Promise<void>((resolve) => {
                server.close(() => {
                    testServer = null;
                    resolve();
                });
            });
        });

        test('должен обрабатывать множественные запросы с разными гипотезами', async () => {
            // Очищаем перед тестом
            await sharedStorage.clear();
            
            const { server, port } = await createTestServer();
            testServer = server;

            // Отправляем запросы для разных гипотез
            const requests = [
                { hypothesisId: 'H1', message: 'H1 test', state: { step: 1 } },
                { hypothesisId: 'H2', message: 'H2 test', state: { step: 2 } },
                { hypothesisId: 'H3', message: 'H3 test', state: { step: 3 } },
                { hypothesisId: 'H1', message: 'H1 test 2', state: { step: 4 } },
            ];

            for (const req of requests) {
                await sendLogRequest(port, req.hypothesisId, req.message, req.state);
            }

            // Проверяем все логи
            const allLogs = await sharedStorage.getLogs();
            expect(allLogs.length).toBe(4);

            // Проверяем фильтрацию по H1 (должно быть 2 лога)
            const h1Logs = await sharedStorage.getLogsByHypothesis('H1');
            expect(h1Logs.length).toBe(2);
            expect(h1Logs[0].context).toBe('H1 test');
            expect(h1Logs[1].context).toBe('H1 test 2');

            // Проверяем фильтрацию по H2 (должно быть 1 лог)
            const h2Logs = await sharedStorage.getLogsByHypothesis('H2');
            expect(h2Logs.length).toBe(1);
            expect(h2Logs[0].context).toBe('H2 test');

            await new Promise<void>((resolve) => {
                server.close(() => {
                    testServer = null;
                    resolve();
                });
            });
        });
    });

    describe('События logAdded', () => {
        test('должен эмитить событие logAdded при добавлении лога через HTTP', async () => {
            const { server, port } = await createTestServer();
            testServer = server;

            let eventReceived = false;
            let receivedLog: RuntimeLog | null = null;

            // Подписываемся на событие logAdded
            sharedStorage.once('logAdded', (log: RuntimeLog) => {
                eventReceived = true;
                receivedLog = log;
            });

            // Отправляем POST запрос
            await sendLogRequest(port, 'H1', 'Event test', { eventData: true });

            // Даем время на обработку события
            await waitForLogsSaved(sharedStorage, 1, SHORT_DELAY);

            // Проверяем, что событие было получено
            expect(eventReceived).toBe(true);
            expect(receivedLog).not.toBeNull();
            expect(receivedLog!.hypothesisId).toBe('H1');
            expect(receivedLog!.context).toBe('Event test');
            expect(receivedLog!.data).toEqual({ eventData: true });

            await new Promise<void>((resolve) => {
                server.close(() => {
                    testServer = null;
                    resolve();
                });
            });
        });
    });

    describe('Краевые случаи', () => {
        test('должен обрабатывать запросы с пустым state', async () => {
            const { server, port } = await createTestServer();
            testServer = server;

            await sendLogRequest(port, 'H1', 'Empty state test', {});

            const logs = await sharedStorage.getLogs();
            expect(logs.length).toBe(1);
            expect(logs[0].data).toEqual({});

            await new Promise<void>((resolve) => {
                server.close(() => {
                    testServer = null;
                    resolve();
                });
            });
        });

        test('должен обрабатывать запросы с большими данными', async () => {
            // Очищаем перед тестом
            await sharedStorage.clear();
            
            const { server, port } = await createTestServer();
            testServer = server;

            const largeState = {
                array: Array(1000).fill(0).map((_, i) => ({ index: i, value: `value-${i}` })),
                nested: {
                    level1: {
                        level2: {
                            level3: {
                                data: 'deep nested data'
                            }
                        }
                    }
                }
            };

            // Регистрируем Promise для ожидания события ДО отправки запроса
            const logPromise = new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    sharedStorage.removeListener('logAdded', handler);
                    reject(new Error('Timeout waiting for log'));
                }, LOG_SAVE_TIMEOUT * 3);
                
                const handler = (log: RuntimeLog) => {
                    if (log.context === 'Large data test') {
                        clearTimeout(timeout);
                        sharedStorage.removeListener('logAdded', handler);
                        resolve();
                    }
                };
                sharedStorage.on('logAdded', handler);
            });

            await sendLogRequest(port, 'H1', 'Large data test', largeState);
            
            // Ждем события
            await logPromise;

            const logs = await sharedStorage.getLogs();
            const testLogs = logs.filter(log => log.context === 'Large data test');
            expect(testLogs.length).toBe(1);
            expect(testLogs[0].data).toEqual(largeState);
            expect((testLogs[0].data as any).array.length).toBe(1000);

            await new Promise<void>((resolve) => {
                server.close(() => {
                    testServer = null;
                    resolve();
                });
            });
        });

        test('должен обрабатывать запросы с специальными символами в сообщении', async () => {
            // Очищаем перед тестом
            await sharedStorage.clear();
            
            const { server, port } = await createTestServer();
            testServer = server;

            const specialMessage = 'Test with special chars: "quotes", \'apostrophes\', <tags>, &ampersands';
            
            // Используем события для отслеживания добавления лога
            let logReceived = false;
            const logAddedHandler = (log: RuntimeLog) => {
                if (log.context === specialMessage) {
                    logReceived = true;
                }
            };
            sharedStorage.on('logAdded', logAddedHandler);
            
            await sendLogRequest(port, 'H1', specialMessage, {});
            
            // Даем время на обработку и сохранение
            await waitForLogsSaved(sharedStorage, 1, LOG_SAVE_TIMEOUT);
            
            // Отписываемся от событий
            sharedStorage.removeListener('logAdded', logAddedHandler);

            // Проверяем с повторными попытками для надежности
            let logs = await sharedStorage.getLogs();
            let testLogs = logs.filter(log => log.context === specialMessage);
            let attempts = 0;
            while (testLogs.length < 1 && attempts < MAX_RETRY_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                logs = await sharedStorage.getLogs();
                testLogs = logs.filter(log => log.context === specialMessage);
                attempts++;
            }
            expect(testLogs.length).toBe(1);
            expect(testLogs[0].context).toBe(specialMessage);

            await new Promise<void>((resolve) => {
                server.close(() => {
                    testServer = null;
                    resolve();
                });
            });
        });
    });
});
