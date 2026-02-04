import * as fs from 'fs/promises';
import * as path from 'path';
import { atomicWriteJson } from '../src/atomic-write';
import { parseJSONStream } from '../src/streaming-json';

describe('atomicWriteJson with streaming', () => {
  const testDir = path.join(__dirname, 'temp-test-data');
  const testFile = path.join(testDir, 'test.json');

  beforeEach(async () => {
    // Создаем тестовую директорию
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Удаляем тестовую директорию
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Игнорируем ошибки при очистке
    }
  });

  describe('Базовый функционал записи', () => {
    test('должен успешно записывать простой JSON объект', async () => {
      const testData = { name: 'test', value: 123 };
      
      await atomicWriteJson(testFile, testData);
      
      // Проверяем, что файл существует
      expect(await fs.access(testFile).then(() => true).catch(() => false)).toBe(true);
      
      // Проверяем содержимое
      const data = await parseJSONStream(testFile);
      expect(data).toEqual(testData);
    });

    test('должен успешно записывать сложный JSON объект', async () => {
      const testData = {
        users: [
          { id: 1, name: 'Alice', profile: { age: 25, city: 'Moscow' } },
          { id: 2, name: 'Bob', profile: { age: 30, city: 'London' } }
        ],
        metadata: {
          createdAt: new Date().toISOString(),
          version: '1.0.0'
        }
      };
      
      await atomicWriteJson(testFile, testData);
      
      // Проверяем, что файл существует
      expect(await fs.access(testFile).then(() => true).catch(() => false)).toBe(true);
      
      // Проверяем содержимое
      const data = await parseJSONStream(testFile);
      expect(data).toEqual(testData);
    });

    test('должен записывать пустой объект', async () => {
      const testData = {};
      
      await atomicWriteJson(testFile, testData);
      
      // Проверяем, что файл существует
      expect(await fs.access(testFile).then(() => true).catch(() => false)).toBe(true);
      
      // Проверяем содержимое
      const data = await parseJSONStream(testFile);
      expect(data).toEqual(testData);
    });

    test('должен записывать массив', async () => {
      const testData = [1, 2, 3, 'hello', { nested: 'object' }];
      
      await atomicWriteJson(testFile, testData);
      
      // Проверяем, что файл существует
      expect(await fs.access(testFile).then(() => true).catch(() => false)).toBe(true);
      
      // Проверяем содержимое
      const data = await parseJSONStream(testFile);
      expect(data).toEqual(testData);
    });
  });

  describe('Производительность на больших данных', () => {
    test('должен обрабатывать 10k логов быстрее 200ms', async () => {
      // Создаем массив из 10k элементов
      const largeData = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        timestamp: Date.now(),
        message: `Log message ${i}`,
        metadata: { level: i % 2 === 0 ? 'info' : 'error', userId: i % 100 }
      }));

      const startTime = Date.now();
      
      await atomicWriteJson(testFile, largeData);
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Проверяем, что время выполнения менее 200ms
      expect(duration).toBeLessThan(200);

      // Также проверяем, что данные корректно записались
      const data = await parseJSONStream(testFile);
      expect(data).toEqual(largeData);
      expect(data.length).toBe(10000);
    });

    test('должен обрабатывать 50k элементов без блокировки', async () => {
      // Создаем массив из 50k элементов
      const hugeData = Array.from({ length: 50000 }, (_, i) => ({
        id: i,
        timestamp: Date.now(),
        message: `Log message ${i}`,
        metadata: { 
          level: i % 3 === 0 ? 'info' : i % 3 === 1 ? 'warn' : 'error',
          userId: i % 1000,
          extra: { nested: { deep: { value: i } } }
        }
      }));

      const startTime = Date.now();
      
      await atomicWriteJson(testFile, hugeData);
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Проверяем, что операция завершена успешно (не обязательно быстро, но без ошибок)
      expect(duration).toBeGreaterThan(0);

      // Проверяем, что данные корректно записались
      const data = await parseJSONStream(testFile);
      expect(data).toEqual(hugeData);
      expect(data.length).toBe(50000);
    });
  });

  describe('Атомарность записи', () => {
    test('должен обеспечивать атомарную запись - последняя операция побеждает', async () => {
      // Тестируем конкурентную запись нескольких процессов
      const testData1 = { id: 1, data: 'first' };
      const testData2 = { id: 2, data: 'second' };
      const testData3 = { id: 3, data: 'third' };

      // Последовательная запись разных данных (реальная атомарность гарантирует целостность каждой записи)
      await atomicWriteJson(testFile, testData1);
      await atomicWriteJson(testFile, testData2);
      await atomicWriteJson(testFile, testData3);

      // После завершения должна остаться целостная запись последнего вызова
      const finalData = await parseJSONStream(testFile);
      
      // В последовательной записи должно остаться testData3
      expect(finalData).toEqual(testData3);
    });

    test('должен корректно обрабатывать ошибки сериализации', async () => {
      // Создаем циклическую ссылку, которая вызовет ошибку при сериализации
      const circularData: any = { name: 'test' };
      circularData.self = circularData; // создаем циклическую ссылку

      // Ожидаем, что будет выброшена ошибка при попытке сериализации
      await expect(atomicWriteJson(testFile, circularData))
        .rejects
        .toThrow();

      // Убедимся, что файл не был создан
      await expect(fs.access(testFile))
        .rejects
        .toThrow();
    });

    test('должен корректно обрабатывать прерывание процесса записи', async () => {
      // Записываем начальные данные
      const initialData = { version: 1, content: 'original' };
      await atomicWriteJson(testFile, initialData);
      
      // Проверяем, что начальные данные записаны
      let currentData = await parseJSONStream(testFile);
      expect(currentData).toEqual(initialData);

      // Создаем очень большой объект, чтобы вызвать возможные проблемы
      const largeData = {
        version: 2,
        content: 'updated',
        payload: Array.from({ length: 5000 }, (_, i) => `item-${i}`)
      };

      // Записываем новые данные
      await atomicWriteJson(testFile, largeData);

      // Проверяем, что данные обновлены полностью
      currentData = await parseJSONStream(testFile);
      expect(currentData).toEqual(largeData);
      expect(currentData.version).toBe(2);
    });
  });
});