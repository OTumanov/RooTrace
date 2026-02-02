import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { VersionedLogStore, VersionedLogs } from '../src/versioned-logs';
import { RuntimeLog } from '../src/types';

// Мокаем vscode перед импортом модулей, которые его используют
jest.mock('vscode', () => require('./vscode-mock'), { virtual: true });

// Глобальный таймаут для всех тестов (5 секунд как требуется)
jest.setTimeout(5000);

/**
 * Малые тесты для Фазы 2.1 (MVCC версионирование) с жесткими 5-секундными таймаутами
 * 
 * Тесты должны быть маленькими и простыми, без сложных хелперов.
 * Каждый тест проверяет одну конкретную функциональность.
 */
describe('VersionedLogStore - MVCC версионирование', () => {
  let testDir: string;
  let logFilePath: string;

  beforeEach(() => {
    // Создаем уникальную временную директорию для каждого теста
    testDir = path.join(tmpdir(), `versioned-logs-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    logFilePath = path.join(testDir, '.ai_debug_logs.json');
  });

  afterEach(() => {
    // Очищаем временные файлы
    try {
      if (fs.existsSync(logFilePath)) {
        fs.unlinkSync(logFilePath);
      }
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch (error) {
      // Игнорируем ошибки очистки
    }
  });

  /**
   * Тест 1: Создание VersionedLogs с правильными полями (timeout: 5000)
   */
  test('should create VersionedLogs with correct fields', async () => {
    // Создаем простой объект VersionedLogs
    const logs: RuntimeLog[] = [
      {
        timestamp: '2026-01-01T12:00:00.000Z',
        hypothesisId: 'test-hypothesis-1',
        context: 'test context',
        data: { message: 'test message', value: 42 }
      }
    ];

    // Вычисляем хеш через приватный метод (используем рефлексию)
    const hash = (VersionedLogStore as any).calculateHash(logs);
    const versionId = (VersionedLogStore as any).generateVersionId();

    const versionedLogs: VersionedLogs = {
      versionId,
      timestamp: new Date().toISOString(),
      logs,
      hash,
      version: 1,
      previousHash: undefined
    };

    // Проверяем поля
    expect(versionedLogs.versionId).toBeDefined();
    expect(versionedLogs.versionId).toMatch(/^\d+-[a-z0-9]+$/); // timestamp-random
    expect(versionedLogs.timestamp).toBeDefined();
    expect(new Date(versionedLogs.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    expect(versionedLogs.logs).toEqual(logs);
    expect(versionedLogs.hash).toBe(hash);
    expect(versionedLogs.hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    expect(versionedLogs.version).toBe(1);
  });

  /**
   * Тест 2: SHA-256 хеш вычисляется правильно (timeout: 5000)
   */
  test('should calculate SHA-256 hash correctly', async () => {
    const logs: RuntimeLog[] = [
      {
        timestamp: '2026-01-01T12:00:00.000Z',
        hypothesisId: 'test-hypothesis-1',
        context: 'test context 1',
        data: { value: 1, note: 'first' }
      },
      {
        timestamp: '2026-01-01T12:01:00.000Z',
        hypothesisId: 'test-hypothesis-2',
        context: 'test context 2',
        data: { value: 2, extra: 'data' }
      }
    ];

    // Вызываем приватный метод calculateHash
    const hash = (VersionedLogStore as any).calculateHash(logs);

    // Проверяем, что хеш соответствует ожидаемому SHA-256
    expect(hash).toBeDefined();
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    // Проверяем детерминированность: тот же вход -> тот же хеш
    const hash2 = (VersionedLogStore as any).calculateHash(logs);
    expect(hash2).toBe(hash);

    // Проверяем, что разные логи дают разные хеши
    const differentLogs: RuntimeLog[] = [...logs, {
      timestamp: '2026-01-01T12:02:00.000Z',
      hypothesisId: 'test-hypothesis-3',
      context: 'test context 3',
      data: { value: 3 }
    }];
    const hash3 = (VersionedLogStore as any).calculateHash(differentLogs);
    expect(hash3).not.toBe(hash);
  });

  /**
   * Тест 3: Версия инкрементируется при append (timeout: 5000)
   */
  test('should increment version on append', async () => {
    // Сначала создаем файл с начальной версией
    const initialLogs: RuntimeLog[] = [
      {
        timestamp: '2026-01-01T12:00:00.000Z',
        hypothesisId: 'hyp-1',
        context: 'initial',
        data: { step: 'start', value: 100 }
      }
    ];

    // Используем replaceLogs для создания начального файла
    const result1 = await VersionedLogStore.replaceLogs(logFilePath, initialLogs, {
      useLock: false, // Упрощаем тест без блокировок
      incrementVersion: true
    });

    expect(result1.version).toBe(1);

    // Добавляем новый лог
    const newLog: RuntimeLog = {
      timestamp: '2026-01-01T12:01:00.000Z',
      hypothesisId: 'hyp-2',
      context: 'new',
      data: { step: 'next', value: 200 }
    };

    const result2 = await VersionedLogStore.appendLog(logFilePath, newLog, {
      useLock: false,
      incrementVersion: true
    });

    // Версия должна увеличиться на 1
    expect(result2.version).toBe(2);
    expect(result2.version).toBe(result1.version + 1);

    // Проверяем, что файл существует и содержит правильное количество логов
    const readResult = await VersionedLogStore.readLatestVersion(logFilePath, {
      validateHash: true,
      useLock: false
    });

    expect(readResult.logs).toHaveLength(2);
    expect(readResult.metadata.version).toBe(2);
  });

  /**
   * Тест 4: Хеш валидация работает (timeout: 5000)
   */
  test('should validate hash correctly', async () => {
    // Создаем корректные логи
    const logs: RuntimeLog[] = [
      {
        timestamp: '2026-01-01T12:00:00.000Z',
        hypothesisId: 'valid-hyp',
        context: 'valid context',
        data: { status: 'ok', score: 0.9 }
      }
    ];

    // Записываем через replaceLogs (создаст правильный хеш)
    await VersionedLogStore.replaceLogs(logFilePath, logs, { useLock: false });

    // Читаем с валидацией хеша - должно пройти успешно
    const validResult = await VersionedLogStore.readLatestVersion(logFilePath, {
      validateHash: true,
      strictValidation: false,
      useLock: false
    });

    expect(validResult.isValid).toBe(true);
    expect(validResult.validationMessage).toBeUndefined();

    // Теперь портим файл, изменив содержимое
    const corruptedContent = JSON.stringify({
      versionId: 'corrupted',
      timestamp: new Date().toISOString(),
      logs: [...logs, { extra: 'malicious' }], // Добавляем лишний элемент
      hash: 'incorrecthash123', // Неправильный хеш
      version: 1
    });

    fs.writeFileSync(logFilePath, corruptedContent, 'utf-8');

    // Читаем с валидацией хеша, но без strictValidation
    const invalidResult = await VersionedLogStore.readLatestVersion(logFilePath, {
      validateHash: true,
      strictValidation: false,
      useLock: false
    });

    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.validationMessage).toContain('Hash mismatch');

    // Теперь с strictValidation должно бросить ошибку
    await expect(
      VersionedLogStore.readLatestVersion(logFilePath, {
        validateHash: true,
        strictValidation: true,
        useLock: false
      })
    ).rejects.toThrow(/Data integrity check failed|Hash mismatch/);
  });

  /**
   * Тест 5: Атомарная запись через atomicWriteJSON (timeout: 5000)
   */
  test('should write atomically via atomicWriteJSON', async () => {
    const logs: RuntimeLog[] = [
      {
        timestamp: '2026-01-01T12:00:00.000Z',
        hypothesisId: 'atomic-test',
        context: 'atomic context',
        data: { atomic: true, value: 999 }
      }
    ];

    // Записываем через replaceLogs, который использует atomicWriteJSON внутри
    const writeResult = await VersionedLogStore.replaceLogs(logFilePath, logs, {
      useLock: false
    });

    expect(writeResult.version).toBe(1);
    expect(writeResult.hash).toMatch(/^[a-f0-9]{64}$/);

    // Проверяем, что файл существует и содержит валидный JSON
    expect(fs.existsSync(logFilePath)).toBe(true);
    
    const fileContent = fs.readFileSync(logFilePath, 'utf-8');
    expect(() => JSON.parse(fileContent)).not.toThrow();

    const parsed = JSON.parse(fileContent);
    expect(parsed.versionId).toBe(writeResult.versionId);
    expect(parsed.version).toBe(1);
    expect(parsed.logs).toHaveLength(1);
    expect(parsed.logs[0].hypothesisId).toBe('atomic-test');

    // Проверяем, что хеш в файле совпадает с вычисленным
    const expectedHash = (VersionedLogStore as any).calculateHash(logs);
    expect(parsed.hash).toBe(expectedHash);
  });
});