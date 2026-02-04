import { SharedLogStorage } from '../src/shared-log-storage';
import { RuntimeLog } from '../src/types';

describe('SharedLogStorage - Асинхронный расчёт размера логов', () => {
  let storage: SharedLogStorage;

  beforeEach(async () => {
    storage = SharedLogStorage.getInstance();
    // Очищаем логи перед каждым тестом
    await storage.clear();
  });

  afterEach(async () => {
    // Убедимся, что очистка произошла
    await storage.clear();
  });

  describe('Корректность расчёта размера', () => {
    it('должен корректно вычислять размер пустого массива логов', async () => {
      const size = await storage['calculateTotalLogsSize']();
      expect(size).toBe(0);
    });

    it('должен корректно вычислять размер одного лога', async () => {
      const log: RuntimeLog = {
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'Test context',
        data: { test: 'data' }
      };
      
      await storage.addLog(log);
      
      // Получаем текущие логи для вычисления ожидаемого размера
      const logs = await storage.getLogs();
      const expectedSize = JSON.stringify(logs).length;
      
      const calculatedSize = await storage['calculateTotalLogsSize']();
      expect(calculatedSize).toBe(expectedSize);
    });

    it('должен корректно вычислять размер нескольких логов', async () => {
      const logs: RuntimeLog[] = [
        {
          timestamp: new Date().toISOString(),
          hypothesisId: 'H1',
          context: 'Test context 1',
          data: { test: 'data1' }
        },
        {
          timestamp: new Date().toISOString(),
          hypothesisId: 'H2',
          context: 'Test context 2',
          data: { test: 'data2' }
        },
        {
          timestamp: new Date().toISOString(),
          hypothesisId: 'H3',
          context: 'Test context 3',
          data: { test: 'data3' }
        }
      ];

      for (const log of logs) {
        await storage.addLog(log);
      }

      const currentLogs = await storage.getLogs();
      const expectedSize = JSON.stringify(currentLogs).length;

      const calculatedSize = await storage['calculateTotalLogsSize']();
      expect(calculatedSize).toBe(expectedSize);
    });

    it('должен возвращать тот же результат, что и синхронный метод', async () => {
      const logs: RuntimeLog[] = [
        {
          timestamp: new Date().toISOString(),
          hypothesisId: 'H1',
          context: 'Test context 1',
          data: { test: 'data1', nested: { value: 123, array: [1, 2, 3] } }
        },
        {
          timestamp: new Date().toISOString(),
          hypothesisId: 'H2',
          context: 'Test context 2',
          data: { test: 'data2', nested: { value: 456, array: [4, 5, 6] } }
        }
      ];

      for (const log of logs) {
        await storage.addLog(log);
      }

      const syncSize = JSON.stringify(storage['logs']).length;
      const asyncSize = await storage['calculateTotalLogsSize']();

      expect(asyncSize).toBe(syncSize);
    });
  });

  describe('Производительность на больших данных', () => {
    it('должен обрабатывать 5000 логов менее чем за 200ms', async () => {
      const logs: RuntimeLog[] = [];
      for (let i = 0; i < 5000; i++) {
        logs.push({
          timestamp: new Date().toISOString(),
          hypothesisId: `H${i % 5}`,
          context: `Test context ${i}`,
          data: { 
            test: `data${i}`, 
            counter: i, 
            nested: { 
              value: i * 2, 
              array: [i, i + 1, i + 2] 
            }
          }
        });
      }

      // Добавляем логи по одному
      for (const log of logs) {
        await storage.addLog(log);
      }

      // Измеряем время выполнения асинхронного расчета
      const startTime = Date.now();
      const size = await storage['calculateTotalLogsSize']();
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(200); // Меньше 200ms
      expect(size).toBeGreaterThan(0);
    }, 10000); // Увеличиваем таймаут для этого теста

    it('должен обрабатывать 1000 логов с батчингом', async () => {
      const logs: RuntimeLog[] = [];
      for (let i = 0; i < 1000; i++) {
        logs.push({
          timestamp: new Date().toISOString(),
          hypothesisId: `H${i % 3}`,
          context: `Context for log ${i}`,
          data: { id: i, payload: `payload_${i}_with_some_data_that_makes_it_larger` }
        });
      }

      for (const log of logs) {
        await storage.addLog(log);
      }

      // Проверяем, что батчинг работает корректно
      const size = await storage['calculateTotalLogsSize']();
      expect(size).toBeGreaterThan(0);

      // Проверяем, что размер соответствует синхронному методу
      const syncSize = JSON.stringify(storage['logs']).length;
      expect(size).toBe(syncSize);
    });
  });

  describe('Интеграция с addLog', () => {
    it('должен использовать асинхронный расчет размера в addLog', async () => {
      // Создаем лог с известным размером
      const log: RuntimeLog = {
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'Integration test context',
        data: { test: 'integration_data', value: 12345 }
      };

      // Получаем размер до добавления
      const sizeBefore = await storage['calculateTotalLogsSize']();

      // Добавляем лог
      await storage.addLog(log);

      // Получаем размер после добавления
      const sizeAfter = await storage['calculateTotalLogsSize']();
      
      // Размер после должен быть больше
      expect(sizeAfter).toBeGreaterThan(sizeBefore);
      
      // Проверяем, что лог действительно добавился
      const logs = await storage.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].hypothesisId).toBe('H1');
    });

    it('должен корректно обновлять кэш размера при добавлении логов', async () => {
      const log1: RuntimeLog = {
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'First log',
        data: { test: 'data1' }
      };

      const log2: RuntimeLog = {
        timestamp: new Date().toISOString(),
        hypothesisId: 'H2',
        context: 'Second log',
        data: { test: 'data2' }
      };

      await storage.addLog(log1);
      const sizeAfterFirst = await storage['calculateTotalLogsSize']();

      await storage.addLog(log2);
      const sizeAfterSecond = await storage['calculateTotalLogsSize']();

      expect(sizeAfterSecond).toBeGreaterThan(sizeAfterFirst);

      // Проверяем, что оба лога присутствуют
      const logs = await storage.getLogs();
      expect(logs.length).toBe(2);
    });
  });
});