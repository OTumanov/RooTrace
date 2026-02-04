// Тесты для метода createAIDebugConfig в ConfigManager
import { ConfigManager } from '../src/config/config-manager';

describe('ConfigManager.createAIDebugConfig()', () => {
    let configManager: ConfigManager;

    beforeEach(() => {
        configManager = ConfigManager.getInstance();
    });

    test('должен создавать конфигурацию с правильным форматом URL', () => {
        // Тестируем с различными портами
        const ports = [3000, 8080, 9000, 12345];
        
        ports.forEach(port => {
            const config = configManager.createAIDebugConfig(port);
            
            // Проверяем формат URL
            expect(config.url).toBe(`http://localhost:${port}/`);
            expect(config.status).toBe('active');
            expect(typeof config.timestamp).toBe('number');
            expect(config.timestamp).toBeLessThanOrEqual(Date.now());
        });
    });

    test('должен создавать конфигурацию с корректным статусом', () => {
        const config = configManager.createAIDebugConfig(3000);
        
        expect(config.status).toBe('active');
    });

    test('должен создавать конфигурацию с текущим временем', () => {
        const beforeCall = Date.now();
        const config = configManager.createAIDebugConfig(3000);
        const afterCall = Date.now();
        
        expect(typeof config.timestamp).toBe('number');
        expect(config.timestamp).toBeGreaterThanOrEqual(beforeCall);
        expect(config.timestamp).toBeLessThanOrEqual(afterCall);
    });

    test('должен создавать разные временные метки для разных вызовов', () => {
        const config1 = configManager.createAIDebugConfig(3000);
        // Небольшая задержка, чтобы гарантировать разницу во времени
        const config2 = configManager.createAIDebugConfig(4000);
        
        expect(typeof config1.timestamp).toBe('number');
        expect(typeof config2.timestamp).toBe('number');
    });

    test('должен возвращать объект с необходимыми полями', () => {
        const config = configManager.createAIDebugConfig(5000);
        
        expect(config).toHaveProperty('url');
        expect(config).toHaveProperty('status');
        expect(config).toHaveProperty('timestamp');
        
        expect(config.url).toMatch(/^http:\/\/localhost:\d+\/$/);
        expect(config.status).toBe('active');
        expect(typeof config.timestamp).toBe('number');
    });
});