/**
 * Тесты для проверки оптимизации writeJSONArrayStream с разблокировкой event loop
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { writeJSONArrayStream } from '../src/streaming-json';

describe('writeJSONArrayStream event loop optimization', () => {
  const testDir = path.join(__dirname, 'temp-test-data');

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

  test('Должен успешно записывать базовые данные', async () => {
    const filePath = path.join(testDir, 'basic-test.json');
    const testData = [
      { id: 1, name: 'Test 1' },
      { id: 2, name: 'Test 2' },
      { id: 3, name: 'Test 3' }
    ];

    const count = await writeJSONArrayStream(filePath, testData);

    expect(count).toBe(3);
    
    // Проверяем, что файл был создан и содержит правильные данные
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed).toEqual(testData);
  });

  test('Должен обрабатывать большие объемы данных без блокировки', async () => {
    const filePath = path.join(testDir, 'large-test.json');
    
    // Создаем генератор для больших данных
    async function* generateLargeDataset() {
      for (let i = 0; i < 1000; i++) {
        yield { id: i, data: `test_data_${i}`, timestamp: Date.now() };
      }
    }

    const startTime = Date.now();
    const count = await writeJSONArrayStream(filePath, generateLargeDataset(), { batchSize: 50 });
    const endTime = Date.now();

    expect(count).toBe(1000);
    
    // Проверяем, что файл был создан
    const stats = await fs.stat(filePath);
    expect(stats.size).toBeGreaterThan(0);
    
    // Время выполнения должно быть разумным (менее 5 секунд для 1000 записей)
    expect(endTime - startTime).toBeLessThan(5000);
  });

  test('Должен использовать настраиваемый размер батча', async () => {
    const filePath = path.join(testDir, 'batch-size-test.json');
    
    async function* generateData() {
      for (let i = 0; i < 250; i++) {
        yield { id: i, value: Math.random() };
      }
    }

    // Используем маленький размер батча для тестирования
    const count = await writeJSONArrayStream(filePath, generateData(), { batchSize: 10 });

    expect(count).toBe(250);
    
    // Проверяем, что файл содержит валидный JSON
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed).toHaveLength(250);
    expect(parsed[0]).toHaveProperty('id');
    expect(parsed[0]).toHaveProperty('value');
  });

  test('Должен поддерживать форматирование pretty', async () => {
    const filePath = path.join(testDir, 'pretty-test.json');
    
    const testData = [
      { id: 1, name: 'First Item' },
      { id: 2, name: 'Second Item' }
    ];

    const count = await writeJSONArrayStream(filePath, testData, { pretty: true });

    expect(count).toBe(2);
    
    // Проверяем, что файл содержит форматированный JSON
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('\n'); // Должен содержать переносы строк
    expect(content).toContain('  '); // Должен содержать отступы
    
    const parsed = JSON.parse(content);
    expect(parsed).toEqual(testData);
  });

  test('Должен обрабатывать пустой массив', async () => {
    const filePath = path.join(testDir, 'empty-test.json');
    const testData: any[] = [];

    const count = await writeJSONArrayStream(filePath, testData);

    expect(count).toBe(0);
    
    // Проверяем, что файл содержит пустой массив
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content.trim()).toBe('[]');
  });
});