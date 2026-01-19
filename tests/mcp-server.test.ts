import { RooTraceMCPHandler } from '../src/mcp-handler';

/**
 * Тесты для MCP Server Handler
 * 
 * Проверяет:
 * - Запуск и остановку MCP handler
 * - Методы handler
 * - Экспорт из mcp-server.ts
 */
describe('MCP Server Handler', () => {
  let handlers: RooTraceMCPHandler[] = [];

  beforeEach(() => {
    // Увеличиваем лимит слушателей для предотвращения предупреждений
    // MCP handler создает слушатели на stdin/stdout при каждом запуске
    process.setMaxListeners(50);
    if (process.stdin) {
      process.stdin.setMaxListeners(50);
    }
    if (process.stdout) {
      process.stdout.setMaxListeners(50);
    }
    if (process.stderr) {
      process.stderr.setMaxListeners(50);
    }
  });

  afterEach(async () => {
    // Останавливаем все созданные handlers
    for (const handler of handlers) {
      try {
        await handler.stop();
      } catch (e) {
        // Игнорируем ошибки при остановке
      }
    }
    handlers = [];
    
    // Очищаем все обработчики сигналов
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    
    process.setMaxListeners(10);
  });

  describe('Server Initialization', () => {
    test('должен создавать экземпляр RooTraceMCPHandler', () => {
      const handler = new RooTraceMCPHandler();
      handlers.push(handler);
      expect(handler).toBeInstanceOf(RooTraceMCPHandler);
    });

    test('должен иметь метод start', () => {
      const handler = new RooTraceMCPHandler();
      handlers.push(handler);
      expect(typeof handler.start).toBe('function');
    });

    test('должен иметь метод stop', () => {
      const handler = new RooTraceMCPHandler();
      handlers.push(handler);
      expect(typeof handler.stop).toBe('function');
    });
  });

  describe('Server Lifecycle', () => {
    test('должен успешно запускаться', async () => {
      const handler = new RooTraceMCPHandler();
      await expect(handler.start()).resolves.not.toThrow();
      await handler.stop();
    });

    test('должен успешно останавливаться', async () => {
      const handler = new RooTraceMCPHandler();
      await handler.start();
      await expect(handler.stop()).resolves.not.toThrow();
    });

    test('должен позволять множественные вызовы stop', async () => {
      const handler = new RooTraceMCPHandler();
      await handler.start();
      await handler.stop();
      await expect(handler.stop()).resolves.not.toThrow();
    });

    test('должен позволять повторный запуск после остановки', async () => {
      const handler = new RooTraceMCPHandler();
      await handler.start();
      await handler.stop();
      await expect(handler.start()).resolves.not.toThrow();
      await handler.stop();
    });
  });

  describe('Module Exports', () => {
    test('должен экспортировать handler из mcp-server.ts', () => {
      // Проверяем что модуль mcp-server.ts экспортирует handler
      const mcpServerModule = require('../src/mcp-server');
      expect(mcpServerModule.handler).toBeDefined();
      expect(mcpServerModule.handler).toBeInstanceOf(RooTraceMCPHandler);
    });

    test('экспортированный handler должен быть экземпляром RooTraceMCPHandler', () => {
      const mcpServerModule = require('../src/mcp-server');
      const handler = mcpServerModule.handler;
      expect(handler).toBeInstanceOf(RooTraceMCPHandler);
      expect(typeof handler.start).toBe('function');
      expect(typeof handler.stop).toBe('function');
    });
  });

  describe('Handler State', () => {
    test('должен корректно обрабатывать состояние до запуска', async () => {
      const handler = new RooTraceMCPHandler();
      handlers.push(handler);
      // До запуска stop не должен выбрасывать ошибку
      await expect(handler.stop()).resolves.not.toThrow();
    });

    test('должен корректно обрабатывать состояние после остановки', async () => {
      const handler = new RooTraceMCPHandler();
      handlers.push(handler);
      await handler.start();
      await handler.stop();
      // После остановки повторный stop не должен выбрасывать ошибку
      await expect(handler.stop()).resolves.not.toThrow();
    });
  });

  describe('Concurrent Operations', () => {
    test('должен обрабатывать параллельные вызовы start', async () => {
      const handler = new RooTraceMCPHandler();
      handlers.push(handler);
      
      // Запускаем несколько раз параллельно
      await Promise.all([
        handler.start(),
        handler.start(),
        handler.start()
      ]);

      await handler.stop();
    });

    test('должен обрабатывать параллельные вызовы stop', async () => {
      const handler = new RooTraceMCPHandler();
      handlers.push(handler);
      await handler.start();
      
      // Останавливаем несколько раз параллельно
      await Promise.all([
        handler.stop(),
        handler.stop(),
        handler.stop()
      ]);
    });
  });

  describe('Error Handling', () => {
    test('должен корректно обрабатывать ошибки при остановке не запущенного сервера', async () => {
      const handler = new RooTraceMCPHandler();
      handlers.push(handler);
      // Остановка не запущенного сервера не должна выбрасывать ошибку
      await expect(handler.stop()).resolves.not.toThrow();
    });

    test('должен корректно обрабатывать множественные остановки', async () => {
      const handler = new RooTraceMCPHandler();
      handlers.push(handler);
      await handler.start();
      
      // Множественные остановки не должны вызывать ошибки
      await handler.stop();
      await handler.stop();
      await handler.stop();
    });
  });
});
