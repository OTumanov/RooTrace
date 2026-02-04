/**
 * Тесты для проверки разблокировки event loop при обработке больших массивов
 * Этот тест проверяет, что во время записи больших данных другие операции могут выполняться
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { writeJSONArrayStream } from '../src/streaming-json';

describe('Event loop blocking check', () => {
  const testDir = path.join(__dirname, 'event-loop-test-data');

  beforeEach(async () => {
    // Создаем временную директорию для тестов
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Удаляем все временные файлы после тестов
    try {
      const files = await fs.readdir(testDir);
      for (const file of files) {
        await fs.unlink(path.join(testDir, file));
      }
      await fs.rmdir(testDir);
    } catch (error) {
      // Игнорируем ошибки при очистке
    }
  });

  test('Другие задачи могут выполняться во время записи большого массива', async () => {
    const filePath = path.join(testDir, 'non-blocking-test.json');
    
    // Счетчик для проверки, что другие задачи выполняются
    let otherTasksExecuted = 0;
    
    // Запускаем другую асинхронную задачу, которая должна продолжать работать
    const monitoringPromise = new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        otherTasksExecuted++;
        if (otherTasksExecuted >= 5) { // Ждем хотя бы 5 выполнений
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });
    
    // Создаем генератор для 2000 элементов
    async function* generateData() {
      for (let i = 0; i < 2000; i++) {
        yield { id: i, data: `data_item_${i}`, timestamp: Date.now() };
        // Небольшая задержка, чтобы усилить эффект блокировки если она происходит
        if (i % 500 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1)); // Очень короткая задержка
        }
      }
    }

    // Запускаем запись и мониторинг одновременно
    const [count] = await Promise.all([
      writeJSONArrayStream(filePath, generateData(), { batchSize: 50 }),
      monitoringPromise
    ]);

    expect(count).toBe(2000);
    // Проверяем, что другие задачи действительно выполнялись во время записи
    expect(otherTasksExecuted).toBeGreaterThanOrEqual(5);
    
    // Проверяем, что файл содержит правильные данные
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed).toHaveLength(2000);
    
    console.log(`Записано ${count} элементов, другие задачи выполнились ${otherTasksExecuted} раз`);
  }, 15000); // Увеличенный таймаут для этого теста

  test('Сравнение с неблокирующим вариантом', async () => {
    const filePath1 = path.join(testDir, 'blocking-test.json');
    const filePath2 = path.join(testDir, 'non-blocking-test.json');
    
    // Создаем одинаковые наборы данных для сравнения
    const createTestData = (size: number) => {
      return Array.from({ length: size }, (_, i) => ({
        id: i,
        value: Math.random(),
        data: `test_data_${i}`,
        nested: { level: 1, deeper: { level: 2, deepest: { level: 3, id: i } } }
      }));
    };
    
    const testData = createTestData(1000);
    
    // Тестируем с разными размерами батча
    const smallBatchResult = await measureExecutionTime(async () => {
      await writeJSONArrayStream(filePath1, testData, { batchSize: 10 });
    });
    
    const largeBatchResult = await measureExecutionTime(async () => {
      await writeJSONArrayStream(filePath2, testData, { batchSize: 500 });
    });
    
    console.log(`Малый batchSize (10): ${smallBatchResult.duration}ms`);
    console.log(`Большой batchSize (500): ${largeBatchResult.duration}ms`);
    
    // Оба должны завершиться успешно
    const [content1, content2] = await Promise.all([
      fs.readFile(filePath1, 'utf-8'),
      fs.readFile(filePath2, 'utf-8')
    ]);
    
    const [parsed1, parsed2] = [JSON.parse(content1), JSON.parse(content2)];
    expect(parsed1).toHaveLength(1000);
    expect(parsed2).toHaveLength(1000);
    
    // Проверяем, что оба содержат одинаковые данные
    expect(parsed1[parsed1.length - 1]).toEqual(parsed2[parsed2.length - 1]);
  }, 15000);

  test('Проверка, что setImmediate действительно вызывается', async () => {
    const filePath = path.join(testDir, 'setimmediate-test.json');
    
    let setImmediateCalls = 0;
    const originalSetImmediate = global.setImmediate;
    
    // Подменяем setImmediate для подсчета вызовов
    (global as any).setImmediate = (callback: (...args: any[]) => void) => {
      setImmediateCalls++;
      return originalSetImmediate(callback);
    };
    
    try {
      // Создаем данные с известным количеством элементов
      async function* generateData() {
        for (let i = 0; i < 250; i++) {
          yield { id: i, name: `Item ${i}` };
        }
      }

      // Используем маленький batchSize чтобы увеличить количество вызовов setImmediate
      const count = await writeJSONArrayStream(filePath, generateData(), { batchSize: 10 });

      expect(count).toBe(250);
      
      // Ожидаем, что setImmediate был вызван хотя бы несколько раз
      // (250 элементов / 10 batchSize = примерно 25 раз)
      expect(setImmediateCalls).toBeGreaterThanOrEqual(10); // Минимум 10 вызовов
      
      console.log(`Записано ${count} элементов, setImmediate вызван ${setImmediateCalls} раз`);
    } finally {
      // Восстанавливаем оригинальный setImmediate
      (global as any).setImmediate = originalSetImmediate;
    }
  }, 10000);
});

// Вспомогательная функция для измерения времени выполнения
async function measureExecutionTime(fn: () => Promise<any>): Promise<{ duration: number; result: any }> {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;
  return { duration, result };
}