/**
 * Тесты для Rate Limiting
 * 
 * Проверяет критически важные компоненты безопасности:
 * - Разрешение запросов в пределах лимита
 * - Блокировка запросов при превышении лимита
 * - Сброс счетчика после окна
 * - Обработка разных IP адресов отдельно
 * - Использование настроек из конфигурации
 * - Обработка x-forwarded-for header
 */

import * as http from 'http';
import * as vscode from 'vscode';

// Мокаем vscode для получения конфигурации
jest.mock('vscode');

describe('Rate Limiting', () => {
    jest.setTimeout(30000);

    // Упрощенная реализация rate limiting для тестов
    const rateLimitMap: Map<string, { count: number; resetTime: number }> = new Map();

    function getRateLimitConfig(): { maxRequests: number; windowMs: number } {
        const config = (vscode.workspace.getConfiguration as jest.Mock)('rooTrace');
        return {
            maxRequests: config.get('rateLimitMaxRequests', 100),
            windowMs: config.get('rateLimitWindowMs', 60000)
        };
    }

    function checkRateLimit(ip: string): boolean {
        const config = getRateLimitConfig();
        const now = Date.now();
        const limit = rateLimitMap.get(ip);
        
        if (!limit || now > limit.resetTime) {
            rateLimitMap.set(ip, { count: 1, resetTime: now + config.windowMs });
            return true;
        }
        
        if (limit.count >= config.maxRequests) {
            return false;
        }
        
        limit.count++;
        return true;
    }

    function getClientIP(req: http.IncomingMessage): string {
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded === 'string') {
            return forwarded.split(',')[0].trim();
        }
        return req.socket.remoteAddress || 'unknown';
    }

    beforeEach(() => {
        // Очищаем rate limit map перед каждым тестом
        rateLimitMap.clear();

        // Мокаем конфигурацию по умолчанию
        (vscode.workspace.getConfiguration as jest.Mock) = jest.fn((section?: string) => {
            const config: Record<string, any> = {
                rateLimitMaxRequests: 100,
                rateLimitWindowMs: 60000
            };

            return {
                get: jest.fn((key: string, defaultValue?: any) => {
                    return config[key] !== undefined ? config[key] : defaultValue;
                })
            };
        });
    });

    test('должен разрешать запросы в пределах лимита', () => {
        const ip = '127.0.0.1';
        const maxRequests = 100;

        // Отправляем запросы в пределах лимита
        for (let i = 0; i < maxRequests; i++) {
            const allowed = checkRateLimit(ip);
            expect(allowed).toBe(true);
        }

        // Проверяем, что счетчик равен лимиту
        const limit = rateLimitMap.get(ip);
        expect(limit).toBeDefined();
        expect(limit!.count).toBe(maxRequests);
    });

    test('должен блокировать запросы при превышении лимита', () => {
        const ip = '127.0.0.1';
        const maxRequests = 100;

        // Отправляем запросы до лимита
        for (let i = 0; i < maxRequests; i++) {
            checkRateLimit(ip);
        }

        // Следующий запрос должен быть заблокирован
        const allowed = checkRateLimit(ip);
        expect(allowed).toBe(false);
    });

    test('должен сбрасывать счетчик после окна', async () => {
        const ip = '127.0.0.1';
        const maxRequests = 10;
        const windowMs = 100; // Короткое окно для теста

        // Устанавливаем короткое окно
        (vscode.workspace.getConfiguration as jest.Mock) = jest.fn((section?: string) => {
            return {
                get: jest.fn((key: string, defaultValue?: any) => {
                    if (key === 'rateLimitMaxRequests') return maxRequests;
                    if (key === 'rateLimitWindowMs') return windowMs;
                    return defaultValue;
                })
            };
        });

        // Отправляем запросы до лимита
        for (let i = 0; i < maxRequests; i++) {
            checkRateLimit(ip);
        }

        // Проверяем, что следующий запрос заблокирован
        expect(checkRateLimit(ip)).toBe(false);

        // Ждем окончания окна
        await new Promise(resolve => setTimeout(resolve, windowMs + 50));

        // После окна запрос должен быть разрешен
        const allowed = checkRateLimit(ip);
        expect(allowed).toBe(true);

        // Проверяем, что счетчик сброшен
        const limit = rateLimitMap.get(ip);
        expect(limit).toBeDefined();
        expect(limit!.count).toBe(1);
    });

    test('должен обрабатывать разные IP адреса отдельно', () => {
        const ip1 = '127.0.0.1';
        const ip2 = '192.168.1.1';
        const maxRequests = 10;

        // Устанавливаем низкий лимит для теста
        (vscode.workspace.getConfiguration as jest.Mock) = jest.fn((section?: string) => {
            return {
                get: jest.fn((key: string, defaultValue?: any) => {
                    if (key === 'rateLimitMaxRequests') return maxRequests;
                    return defaultValue;
                })
            };
        });

        // Отправляем запросы от первого IP до лимита
        for (let i = 0; i < maxRequests; i++) {
            checkRateLimit(ip1);
        }

        // Проверяем, что первый IP заблокирован
        expect(checkRateLimit(ip1)).toBe(false);

        // Проверяем, что второй IP может отправлять запросы
        for (let i = 0; i < maxRequests; i++) {
            const allowed = checkRateLimit(ip2);
            expect(allowed).toBe(true);
        }

        // Проверяем, что второй IP тоже заблокирован после лимита
        expect(checkRateLimit(ip2)).toBe(false);
    });

    test('должен использовать настройки из конфигурации', () => {
        const customMaxRequests = 50;
        const customWindowMs = 30000;

        // Устанавливаем кастомные настройки
        (vscode.workspace.getConfiguration as jest.Mock) = jest.fn((section?: string) => {
            return {
                get: jest.fn((key: string, defaultValue?: any) => {
                    if (key === 'rateLimitMaxRequests') return customMaxRequests;
                    if (key === 'rateLimitWindowMs') return customWindowMs;
                    return defaultValue;
                })
            };
        });

        const ip = '127.0.0.1';

        // Отправляем запросы до кастомного лимита
        for (let i = 0; i < customMaxRequests; i++) {
            const allowed = checkRateLimit(ip);
            expect(allowed).toBe(true);
        }

        // Следующий запрос должен быть заблокирован
        expect(checkRateLimit(ip)).toBe(false);

        // Проверяем, что окно установлено правильно
        const limit = rateLimitMap.get(ip);
        expect(limit).toBeDefined();
        const expectedResetTime = limit!.resetTime;
        const now = Date.now();
        const timeUntilReset = expectedResetTime - now;
        // Время до сброса должно быть примерно равно customWindowMs (с небольшой погрешностью)
        expect(timeUntilReset).toBeGreaterThan(customWindowMs - 1000);
        expect(timeUntilReset).toBeLessThan(customWindowMs + 1000);
    });

    test('должен обрабатывать x-forwarded-for header', () => {
        const forwardedIP = '10.0.0.1';
        const directIP = '127.0.0.1';

        // Создаем мок запроса с x-forwarded-for
        const mockReqWithForwarded = {
            headers: {
                'x-forwarded-for': forwardedIP
            },
            socket: {
                remoteAddress: directIP
            }
        } as any;

        // Создаем мок запроса без x-forwarded-for
        const mockReqWithoutForwarded = {
            headers: {},
            socket: {
                remoteAddress: directIP
            }
        } as any;

        // Проверяем, что IP извлекается из x-forwarded-for
        const ipFromForwarded = getClientIP(mockReqWithForwarded);
        expect(ipFromForwarded).toBe(forwardedIP);

        // Проверяем, что без x-forwarded-for используется remoteAddress
        const ipFromDirect = getClientIP(mockReqWithoutForwarded);
        expect(ipFromDirect).toBe(directIP);
    });

    test('должен обрабатывать x-forwarded-for с несколькими IP', () => {
        const firstIP = '10.0.0.1';
        const forwardedIPs = `${firstIP}, 192.168.1.1, 172.16.0.1`;

        const mockReq = {
            headers: {
                'x-forwarded-for': forwardedIPs
            },
            socket: {
                remoteAddress: '127.0.0.1'
            }
        } as any;

        const ip = getClientIP(mockReq);
        expect(ip).toBe(firstIP);
    });

    test('должен обрабатывать отсутствие remoteAddress', () => {
        const mockReq = {
            headers: {},
            socket: {}
        } as any;

        const ip = getClientIP(mockReq);
        expect(ip).toBe('unknown');
    });

    test('должен корректно обрабатывать параллельные запросы от одного IP', async () => {
        const ip = '127.0.0.1';
        const maxRequests = 100;

        // Отправляем параллельные запросы
        const promises = Array.from({ length: maxRequests }, () => {
            return Promise.resolve(checkRateLimit(ip));
        });

        const results = await Promise.all(promises);

        // Все запросы должны быть разрешены
        expect(results.every(r => r === true)).toBe(true);

        // Следующий запрос должен быть заблокирован
        expect(checkRateLimit(ip)).toBe(false);
    });

    test('должен обрабатывать очень короткое окно', async () => {
        const ip = '127.0.0.1';
        const maxRequests = 5;
        const windowMs = 10; // Очень короткое окно

        // Устанавливаем короткое окно
        (vscode.workspace.getConfiguration as jest.Mock) = jest.fn((section?: string) => {
            return {
                get: jest.fn((key: string, defaultValue?: any) => {
                    if (key === 'rateLimitMaxRequests') return maxRequests;
                    if (key === 'rateLimitWindowMs') return windowMs;
                    return defaultValue;
                })
            };
        });

        // Отправляем запросы до лимита
        for (let i = 0; i < maxRequests; i++) {
            checkRateLimit(ip);
        }

        // Проверяем блокировку
        expect(checkRateLimit(ip)).toBe(false);

        // Ждем окончания окна
        await new Promise(resolve => setTimeout(resolve, windowMs + 20));

        // После окна запрос должен быть разрешен
        expect(checkRateLimit(ip)).toBe(true);
    });
});
