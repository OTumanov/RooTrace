/**
 * Тесты для потокового чтения/записи JSON (Фаза 2.2)
 * 
 * КАЖДЫЙ тест с timeout: 5000
 * Тесты МАЛЕНЬКИЕ и ПРОСТЫЕ
 * Не используем waitForLogsSaved или сложные хелперы
 */

import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import {
  parseJSONStream,
  writeJSONStream,
  streamJSONArray,
  writeJSONArrayStream
} from '../src/streaming-json';

describe('Streaming JSON (Phase 2.2)', () => {
  const testDir = path.join(tmpdir(), 'rooTrace-streaming-test');
  let testFilePath: string;

  beforeAll(() => {
    // Создаем тестовую директорию
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Очищаем тестовую директорию
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      for (const file of files) {
        const filePath = path.join(testDir, file);
        try {
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          }
        } catch (e) {
          // игнорируем ошибки
        }
      }
      try {
        fs.rmdirSync(testDir);
      } catch (e) {
        // игнорируем ошибки
      }
    }
  });

  beforeEach(() => {
    // Создаем уникальный файл для каждого теста
    testFilePath = path.join(testDir, `test-${Date.now()}-${Math.random().toString(36).substring(2)}.json`);
  });

  afterEach(() => {
    // Удаляем тестовый файл после каждого теста
    if (fs.existsSync(testFilePath)) {
      try {
        fs.unlinkSync(testFilePath);
      } catch (e) {
        // игнорируем ошибки
      }
    }
  });

  describe('parseJSONStream', () => {
    it('читает пустой JSON файл', async () => {
      // Создаем пустой файл
      fs.writeFileSync(testFilePath, '{}', 'utf-8');
      
      const result = await parseJSONStream(testFilePath);
      expect(result).toEqual({});
    }, 5000);

    it('читает простой JSON объект', async () => {
      const data = { name: 'test', value: 42, nested: { foo: 'bar' } };
      fs.writeFileSync(testFilePath, JSON.stringify(data), 'utf-8');
      
      const result = await parseJSONStream(testFilePath);
      expect(result).toEqual(data);
    }, 5000);

    it('читает JSON массив', async () => {
      const data = [1, 2, 3, { a: 1 }, 'test'];
      fs.writeFileSync(testFilePath, JSON.stringify(data), 'utf-8');
      
      const result = await parseJSONStream<any>(testFilePath);
      expect(result).toEqual(data);
    }, 5000);

    it('возвращает пустой объект если файл не существует', async () => {
      const nonExistentPath = path.join(testDir, 'non-existent.json');
      const result = await parseJSONStream(nonExistentPath);
      expect(result).toEqual({});
    }, 5000);

    it('бросает ошибку при невалидном JSON', async () => {
      fs.writeFileSync(testFilePath, '{ invalid json }', 'utf-8');
      
      await expect(parseJSONStream(testFilePath)).rejects.toThrow(/Failed to parse JSON/);
    }, 5000);

    it('обрабатывает большой JSON файл (10KB)', async () => {
      // Создаем большой JSON объект
      const largeObject: any = {};
      for (let i = 0; i < 1000; i++) {
        largeObject[`key${i}`] = `value${i}`.repeat(10);
      }
      fs.writeFileSync(testFilePath, JSON.stringify(largeObject), 'utf-8');
      
      const result = await parseJSONStream(testFilePath);
      expect(Object.keys(result)).toHaveLength(1000);
    }, 5000);
  });

  describe('writeJSONStream', () => {
    it('записывает простой JSON объект', async () => {
      const data = { test: 'value', number: 123 };
      
      await writeJSONStream(testFilePath, data);
      
      expect(fs.existsSync(testFilePath)).toBe(true);
      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(JSON.parse(content)).toEqual(data);
    }, 5000);

    it('записывает JSON с форматированием (pretty)', async () => {
      const data = { a: 1, b: 2 };
      
      await writeJSONStream(testFilePath, data, { pretty: true });
      
      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(content).toContain('\n');
      expect(JSON.parse(content)).toEqual(data);
    }, 5000);

    it('записывает JSON без форматирования (not pretty)', async () => {
      const data = { a: 1, b: 2 };
      
      await writeJSONStream(testFilePath, data, { pretty: false });
      
      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(content).not.toContain('\n');
      expect(JSON.parse(content)).toEqual(data);
    }, 5000);

    it('записывает вложенную структуру', async () => {
      const data = {
        array: [1, 2, 3],
        nested: { deep: { deeper: 'value' } },
        null: null,
        bool: true
      };
      
      await writeJSONStream(testFilePath, data);
      
      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(JSON.parse(content)).toEqual(data);
    }, 5000);

    it('создает директорию если её нет', async () => {
      const nestedPath = path.join(testDir, 'nested', 'deep', 'file.json');
      
      await writeJSONStream(nestedPath, { test: 'value' });
      
      expect(fs.existsSync(nestedPath)).toBe(true);
      // Очистка
      fs.unlinkSync(nestedPath);
      fs.rmdirSync(path.join(testDir, 'nested', 'deep'));
      fs.rmdirSync(path.join(testDir, 'nested'));
    }, 5000);
  });

  describe('streamJSONArray', () => {
    it('обрабатывает пустой массив', async () => {
      fs.writeFileSync(testFilePath, '[]', 'utf-8');
      
      const items: any[] = [];
      const count = await streamJSONArray(testFilePath, (item) => {
        items.push(item);
      });
      
      expect(count).toBe(0);
      expect(items).toEqual([]);
    }, 5000);

    it('обрабатывает массив из нескольких объектов', async () => {
      const data = [
        { id: 1, name: 'first' },
        { id: 2, name: 'second' },
        { id: 3, name: 'third' }
      ];
      fs.writeFileSync(testFilePath, JSON.stringify(data), 'utf-8');
      
      const items: any[] = [];
      const indices: number[] = [];
      const count = await streamJSONArray(testFilePath, (item, index) => {
        items.push(item);
        indices.push(index);
      });
      
      expect(count).toBe(3);
      expect(items).toEqual(data);
      expect(indices).toEqual([0, 1, 2]);
    }, 5000);

    it('обрабатывает большой массив (100 элементов)', async () => {
      const data = Array.from({ length: 100 }, (_, i) => ({ id: i, value: `item${i}` }));
      fs.writeFileSync(testFilePath, JSON.stringify(data), 'utf-8');
      
      let count = 0;
      const processed = await streamJSONArray(testFilePath, (item, index) => {
        expect(item.id).toBe(index);
        count++;
      });
      
      expect(processed).toBe(100);
      expect(count).toBe(100);
    }, 5000);

    it('возвращает 0 если файл не существует', async () => {
      const nonExistentPath = path.join(testDir, 'non-existent-array.json');
      const count = await streamJSONArray(nonExistentPath, () => {});
      expect(count).toBe(0);
    }, 5000);

    it('обрабатывает массив с вложенными объектами', async () => {
      const data = [
        { id: 1, data: { nested: true } },
        { id: 2, data: { nested: false } }
      ];
      fs.writeFileSync(testFilePath, JSON.stringify(data), 'utf-8');
      
      const items: any[] = [];
      await streamJSONArray(testFilePath, (item) => { items.push(item); });
      
      expect(items).toEqual(data);
    }, 5000);
  });

  describe('writeJSONArrayStream', () => {
    it('записывает пустой массив', async () => {
      const items: any[] = [];
      
      const count = await writeJSONArrayStream(testFilePath, items);
      
      expect(count).toBe(0);
      expect(fs.existsSync(testFilePath)).toBe(true);
      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(JSON.parse(content)).toEqual([]);
    }, 5000);

    it('записывает массив из нескольких элементов', async () => {
      const items = [
        { id: 1, name: 'item1' },
        { id: 2, name: 'item2' },
        { id: 3, name: 'item3' }
      ];
      
      const count = await writeJSONArrayStream(testFilePath, items);
      
      expect(count).toBe(3);
      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(JSON.parse(content)).toEqual(items);
    }, 5000);

    it('записывает большой массив (50 элементов)', async () => {
      const items = Array.from({ length: 50 }, (_, i) => ({ index: i }));
      
      const count = await writeJSONArrayStream(testFilePath, items);
      
      expect(count).toBe(50);
      const content = fs.readFileSync(testFilePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(50);
      expect(parsed[0].index).toBe(0);
      expect(parsed[49].index).toBe(49);
    }, 5000);

    it('записывает массив с форматированием (pretty)', async () => {
      const items = [{ a: 1 }, { b: 2 }];
      
      const count = await writeJSONArrayStream(testFilePath, items, { pretty: true });
      
      expect(count).toBe(2);
      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(content).toContain('\n');
      expect(JSON.parse(content)).toEqual(items);
    }, 5000);

    it('записывает массив без форматирования (not pretty)', async () => {
      const items = [{ a: 1 }, { b: 2 }];
      
      const count = await writeJSONArrayStream(testFilePath, items, { pretty: false });
      
      expect(count).toBe(2);
      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(content).not.toContain('\n');
      expect(JSON.parse(content)).toEqual(items);
    }, 5000);

    it('работает с асинхронным итератором', async () => {
      async function* asyncItems() {
        yield { id: 1 };
        yield { id: 2 };
        yield { id: 3 };
      }
      
      const count = await writeJSONArrayStream(testFilePath, asyncItems());
      
      expect(count).toBe(3);
      const content = fs.readFileSync(testFilePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    }, 5000);
  });

  describe('Интеграция: чтение после записи', () => {
    it('parseJSONStream читает то, что записал writeJSONStream', async () => {
      const original = { complex: true, array: [1, 2, 3], nested: { key: 'value' } };
      
      await writeJSONStream(testFilePath, original);
      const read = await parseJSONStream(testFilePath);
      
      expect(read).toEqual(original);
    }, 5000);

    it('streamJSONArray читает то, что записал writeJSONArrayStream', async () => {
      const items = [
        { id: 1, data: 'a' },
        { id: 2, data: 'b' },
        { id: 3, data: 'c' }
      ];
      
      await writeJSONArrayStream(testFilePath, items);
      
      const readItems: any[] = [];
      await streamJSONArray(testFilePath, (item) => { readItems.push(item); });
      
      expect(readItems).toEqual(items);
    }, 5000);
  });
});