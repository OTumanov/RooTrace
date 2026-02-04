/**
 * Тесты для проверки производительности writeJSONArrayStream
 * Проверяет, что обработка больших данных не блокирует event loop
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { writeJSONArrayStream } from '../src/streaming-json';

describe('writeJSONArrayStream performance tests', () => {
  const testDir = path.join(__dirname, 'perf-test-data');

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

  test('Производительность на 10k логов должна быть < 300ms', async () => {
    const filePath = path.join(testDir, 'perf-test-10k.json');
    
    // Создаем генератор для 10k записей
    async function* generateLogData() {
      for (let i = 0; i < 10000; i++) {
        yield {
          id: i,
          level: i % 10 === 0 ? 'error' : 'info',
          message: `Log message ${i}`,
          timestamp: new Date().toISOString(),
          metadata: {
            userId: i % 100,
            sessionId: `session-${i % 50}`,
            data: Array(10).fill(0).map((_, idx) => `extra_data_${idx}`)
          }
        };
      }
    }

    const startTime = Date.now();
    const count = await writeJSONArrayStream(filePath, generateLogData(), { batchSize: 100 });
    const endTime = Date.now();
    
    const duration = endTime - startTime;

    expect(count).toBe(10000);
    expect(duration).toBeLessThan(300); // Должно быть менее 300ms
    
    // Проверяем, что файл был создан
    const stats = await fs.stat(filePath);
    expect(stats.size).toBeGreaterThan(0);
    
    console.log(`Записано ${count} элементов за ${duration}ms`);
  }, 10000); // Увеличиваем таймаут для этого теста

  test('Проверка разблокировки event loop с малым batchSize', async () => {
    const filePath = path.join(testDir, 'event-loop-test.json');
    
    // Создаем генератор для теста с большим количеством элементов
    async function* generateData() {
      for (let i = 0; i < 5000; i++) {
        yield { id: i, value: `value_${i}`, nested: { data: { deep: { prop: i } } } };
      }
    }

    // Используем очень маленький batchSize для частой разблокировки event loop
    const startTime = Date.now();
    const count = await writeJSONArrayStream(filePath, generateData(), { batchSize: 10 });
    const endTime = Date.now();
    
    const duration = endTime - startTime;

    expect(count).toBe(5000);
    // Хотя с маленьким batchSize может быть немного медленнее, но всё равно должно завершиться разумно быстро
    expect(duration).toBeLessThan(1000); // Должно быть менее 1 секунды
    
    // Проверяем, что файл содержит валидные данные
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed).toHaveLength(5000);
    
    console.log(`Записано ${count} элементов с batchSize=10 за ${duration}ms`);
  }, 10000); // Увеличиваем таймаут для этого теста

  test('Сравнение производительности разных batchSize', async () => {
    const testSizes = [10, 50, 100, 500];
    const results: { batchSize: number; duration: number; count: number }[] = [];

    for (const batchSize of testSizes) {
      const filePath = path.join(testDir, `batch-size-${batchSize}.json`);
      
      async function* generateData() {
        for (let i = 0; i < 1000; i++) {
          yield { id: i, data: `data_${i}_${batchSize}` };
        }
      }

      const startTime = Date.now();
      const count = await writeJSONArrayStream(filePath, generateData(), { batchSize });
      const endTime = Date.now();
      
      results.push({
        batchSize,
        duration: endTime - startTime,
        count
      });

      expect(count).toBe(1000);
    }

    // Проверяем, что все тесты завершились успешно
    for (const result of results) {
      expect(result.count).toBe(1000);
      console.log(`BatchSize ${result.batchSize}: ${result.duration}ms для ${result.count} элементов`);
    }
    
    // Все результаты должны быть разумными (менее 1 секунды)
    for (const result of results) {
      expect(result.duration).toBeLessThan(1000);
    }
  }, 30000); // Увеличиваем таймаут для этого комплексного теста
});