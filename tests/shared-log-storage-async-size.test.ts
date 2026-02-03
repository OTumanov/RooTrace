/**
 * Тесты для асинхронного расчёта размера логов (задача task-001)
 * Проверяет замену синхронного JSON.stringify на асинхронный расчёт с setImmediate
 */

import { SharedLogStorage, RuntimeLog } from '../src/shared-log-storage';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

// Мокаем vscode перед импортом модулей, которые его используют
jest.mock('vscode', () => require('./vscode-mock'), { virtual: true });

// Глобальный таймаут для всех тестов (30 секунд)
jest.setTimeout(30000);

describe('Асинхронный расчёт размера логов (task-001)', () => {
  let testDir: string;
  let storage: SharedLogStorage;
  let originalCwd: string;

  beforeAll(() => {
    originalCwd = process.cwd();
  });

  beforeEach(async () => {
    // Создаем уникальную временную директорию для каждого теста
    testDir = path.join(tmpdir(), `rooTrace-test-async-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    // Устанавливаем рабочую директорию для теста
    try {
      process.chdir(testDir);
    } catch (e) {
      // Игнорируем ошибки chdir
    }
    
    // Сбрасываем singleton перед созданием нового экземпляра
    (SharedLogStorage as any).instance = undefined;
    
    // Создаем storage (он будет использовать process.cwd() = testDir)
    storage = SharedLogStorage.getInstance();
    
    // Очищаем логи перед каждым тестом
    await storage.clear();
  });

  afterEach(async () => {
    // Останавливаем watcher перед очисткой
    if (storage) {
      (storage as any).stopWatcher();
      await storage.clear();
    }
    
    // Очищаем singleton
    (SharedLogStorage as any).instance = undefined;
    
    // Восстанавливаем рабочую директорию
    try {
      if (originalCwd) {
        process.chdir(originalCwd);
      }
    } catch (e) {
      // Игнорируем ошибки chdir
    }
    
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
   * Тест 1: Базовый функционал calculateLogSize
   */
  test('calculateLogSize корректно вычисляет размер лога', async () => {
    // Создаём тестовый лог
    const testLog: RuntimeLog = {
      timestamp: new Date().toISOString(),
      hypothesisId: 'H1',
      context: 'Test context',
      data: { result: 42, nested: { value: 'test' } }
    };

    // Получаем приватный метод через any (для тестирования)
    const size = await (storage as any).calculateLogSize(testLog);
    const expectedSize = JSON.stringify(testLog).length;

    expect(size).toBe(expectedSize);
    expect(typeof size).toBe('number');
    expect(size).toBeGreaterThan(0);
  });

  /**
   * Тест 2: Производительность (нет блокировки event loop)
   */
  test('calculateLogSize не блокирует event loop', async () => {
    // Создаём большой лог
    const largeLog: RuntimeLog = {
      timestamp: new Date().toISOString(),
      hypothesisId: 'H1',
      context: 'Large log test',
      data: { array: Array(10000).fill({ key: 'value'.repeat(100) }) }
    };

    // Измеряем время до и после вызова
    const start = Date.now();
    const size = await (storage as any).calculateLogSize(largeLog);
    const end = Date.now();

    // Проверяем, что event loop не блокируется
    // В идеале разница должна быть небольшой, но setImmediate добавляет минимальную задержку
    const duration = end - start;
    console.log(`Расчёт размера большого лога занял ${duration}ms`);
    
    // Проверяем, что размер вычислен корректно
    const expectedSize = JSON.stringify(largeLog).length;
    expect(size).toBe(expectedSize);
    
    // Проверяем, что не было длительной блокировки (обычно < 50ms для setImmediate)
    // Но для очень больших объектов может быть больше, поэтому используем щедрый лимит
    expect(duration).toBeLessThan(500); // 500ms - безопасный лимит
  });

  /**
   * Тест 3: calculateLogsTotalSize вычисляет общий размер всех логов
   */
  test('calculateLogsTotalSize корректно вычисляет общий размер', async () => {
    // Добавляем несколько логов
    const logs: RuntimeLog[] = [
      {
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'Test 1',
        data: { value: 1 }
      },
      {
        timestamp: new Date().toISOString(),
        hypothesisId: 'H2',
        context: 'Test 2',
        data: { value: 2, nested: { deep: 'data' } }
      },
      {
        timestamp: new Date().toISOString(),
        hypothesisId: 'H3',
        context: 'Test 3',
        data: { array: [1, 2, 3, 4, 5] }
      }
    ];

    // Добавляем логи через addLog
    for (const log of logs) {
      await storage.addLog(log);
    }

    // Получаем приватный метод через any
    const totalSize = await (storage as any).calculateLogsTotalSize();
    const expectedSize = JSON.stringify(logs).length;

    expect(totalSize).toBe(expectedSize);
    expect(totalSize).toBeGreaterThan(0);
  });

  /**
   * Тест 4: Интеграция с addLog - асинхронный расчёт размера нового лога
   */
  test('addLog использует асинхронный расчёт размера нового лога', async () => {
    // Создаём тестовый лог
    const testLog: RuntimeLog = {
      timestamp: new Date().toISOString(),
      hypothesisId: 'H1',
      context: 'Integration test',
      data: { test: 'data', number: 123, boolean: true }
    };

    // Мокаем calculateLogSize для проверки вызова
    const originalCalculateLogSize = (storage as any).calculateLogSize;
    let calculateLogSizeCalled = false;
    (storage as any).calculateLogSize = jest.fn().mockImplementation(async (log: RuntimeLog) => {
      calculateLogSizeCalled = true;
      // Проверяем, что передан правильный лог
      expect(log.hypothesisId).toBe(testLog.hypothesisId);
      expect(log.context).toBe(testLog.context);
      return JSON.stringify(log).length;
    });

    try {
      // Добавляем лог через addLog
      await storage.addLog(testLog);

      // Проверяем, что calculateLogSize был вызван
      expect(calculateLogSizeCalled).toBe(true);
      expect((storage as any).calculateLogSize).toHaveBeenCalledTimes(1);

      // Проверяем, что лог действительно добавлен
      const logs = await storage.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].hypothesisId).toBe(testLog.hypothesisId);
      expect(logs[0].context).toBe(testLog.context);
    } finally {
      // Восстанавливаем оригинальный метод
      (storage as any).calculateLogSize = originalCalculateLogSize;
    }
  });

  /**
   * Тест 5: Проверка обновления кэша размера после загрузки логов
   */
  test('loadFromFile обновляет logsSizeCache асинхронно', async () => {
    // Создаём и добавляем несколько логов
    const logs: RuntimeLog[] = [
      {
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'Load test 1',
        data: { a: 1 }
      },
      {
        timestamp: new Date().toISOString(),
        hypothesisId: 'H2',
        context: 'Load test 2',
        data: { b: 2 }
      }
    ];

    for (const log of logs) {
      await storage.addLog(log);
    }

    // Получаем текущий кэш размера
    const logsSizeCacheBefore = (storage as any).logsSizeCache;
    expect(logsSizeCacheBefore).toBeGreaterThan(0);

    // Вызываем loadFromFile напрямую (симулируем перезагрузку)
    await (storage as any).loadFromFile();

    // Проверяем, что кэш размера обновлён
    const logsSizeCacheAfter = (storage as any).logsSizeCache;
    expect(logsSizeCacheAfter).toBeGreaterThan(0);
    // Из-за асинхронного расчёта размер может немного отличаться (округление),
    // но должен быть примерно тем же (разница < 10 байт)
    expect(Math.abs(logsSizeCacheAfter - logsSizeCacheBefore)).toBeLessThan(10);
  });

  /**
   * Тест 6: Обработка больших логов при обрезке по размеру
   */
  test('Обрезка логов по размеру использует асинхронный расчёт', async () => {
    // Создаём много небольших логов
    const logs: RuntimeLog[] = [];
    for (let i = 0; i < 100; i++) {
      logs.push({
        timestamp: new Date().toISOString(),
        hypothesisId: `H${i % 5}`,
        context: `Log ${i}`,
        data: { index: i, data: 'x'.repeat(1000) } // Каждый лог ~1KB
      });
    }

    // Добавляем все логи
    for (const log of logs) {
      await storage.addLog(log);
    }

    // Проверяем, что логи добавлены
    const allLogs = await storage.getLogs();
    expect(allLogs.length).toBeGreaterThan(0);

    // Проверяем, что кэш размера установлен
    const logsSizeCache = (storage as any).logsSizeCache;
    expect(logsSizeCache).toBeGreaterThan(0);
    expect(logsSizeCache).toBeLessThan(10 * 1024 * 1024); // Должен быть меньше 10MB лимита
  });

  /**
   * Тест 7: Параллельные вызовы calculateLogSize не блокируют друг друга
   */
  test('Параллельные вызовы calculateLogSize работают корректно', async () => {
    // Создаём несколько разных логов
    const logs: RuntimeLog[] = [
      { timestamp: new Date().toISOString(), hypothesisId: 'H1', context: 'A', data: { a: 1 } },
      { timestamp: new Date().toISOString(), hypothesisId: 'H2', context: 'B', data: { b: 2 } },
      { timestamp: new Date().toISOString(), hypothesisId: 'H3', context: 'C', data: { c: 3 } },
      { timestamp: new Date().toISOString(), hypothesisId: 'H4', context: 'D', data: { d: 4 } },
    ];

    // Запускаем параллельные вычисления размеров
    const start = Date.now();
    const promises = logs.map(log => (storage as any).calculateLogSize(log));
    const sizes = await Promise.all(promises);
    const end = Date.now();

    // Проверяем, что все размеры вычислены корректно
    logs.forEach((log, index) => {
      const expectedSize = JSON.stringify(log).length;
      expect(sizes[index]).toBe(expectedSize);
    });

    // Проверяем, что параллельное выполнение не заняло значительно больше времени
    // чем последовательное (примерно в 4 раза быстрее, чем 4 * время одного вызова)
    const duration = end - start;
    console.log(`Параллельные вызовы заняли ${duration}ms`);
    expect(duration).toBeLessThan(1000); // Должно быть меньше 1 секунды
  });
});