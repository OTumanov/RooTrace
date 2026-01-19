import * as fs from 'fs';
import * as path from 'path';
import { withFileLock, clearAllLocks } from '../src/file-lock-utils';
import { LOCK_TEST_DELAY_SHORT, LOCK_TEST_DELAY_MEDIUM, LOCK_TEST_DELAY_LONG, LOCK_TEST_DELAY_VERY_LONG } from './constants';

/**
 * Unit-тесты для file-lock-utils.ts
 * 
 * Проверяет:
 * - Последовательное выполнение операций для одного файла
 * - Отсутствие race conditions
 * - Корректную обработку ошибок
 * - Очистку блокировок
 */
describe('FileLockUtils', () => {
  const testDir = path.join(__dirname, 'temp-test-files');
  const testFile = path.join(testDir, 'lock-test.txt');
  let originalCwd: string;

  beforeAll(() => {
    // Сохраняем оригинальную рабочую директорию
    originalCwd = process.cwd();
    
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    // Устанавливаем рабочую директорию для тестов
    try {
      process.chdir(testDir);
    } catch (e) {
      // Игнорируем ошибки chdir
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
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Очищаем блокировки перед каждым тестом
    clearAllLocks();
    // Удаляем тестовый файл, если существует
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  test('should execute operations sequentially for the same file', async () => {
    const results: number[] = [];

    // Запускаем несколько операций параллельно
    const promises = [
      withFileLock(testFile, async () => {
        await new Promise(resolve => setTimeout(resolve, LOCK_TEST_DELAY_LONG));
        results.push(1);
        await fs.promises.writeFile(testFile, '1', 'utf8');
      }),
      withFileLock(testFile, async () => {
        await new Promise(resolve => setTimeout(resolve, LOCK_TEST_DELAY_MEDIUM));
        results.push(2);
        await fs.promises.writeFile(testFile, '2', 'utf8');
      }),
      withFileLock(testFile, async () => {
        await new Promise(resolve => setTimeout(resolve, LOCK_TEST_DELAY_SHORT));
        results.push(3);
        await fs.promises.writeFile(testFile, '3', 'utf8');
      })
    ];

    await Promise.all(promises);

    // Проверяем, что операции выполнились последовательно
    expect(results).toEqual([1, 2, 3]);
    
    // Проверяем, что последняя операция записала свое значение
    const content = await fs.promises.readFile(testFile, 'utf8');
    expect(content).toBe('3');
  });

  test('should allow parallel operations on different files', async () => {
    const file1 = path.join(testDir, 'file1.txt');
    const file2 = path.join(testDir, 'file2.txt');
    const results: string[] = [];

    // Запускаем операции на разных файлах параллельно
    await Promise.all([
      withFileLock(file1, async () => {
        await new Promise(resolve => setTimeout(resolve, LOCK_TEST_DELAY_LONG));
        results.push('file1');
        await fs.promises.writeFile(file1, 'content1', 'utf8');
      }),
      withFileLock(file2, async () => {
        await new Promise(resolve => setTimeout(resolve, LOCK_TEST_DELAY_MEDIUM));
        results.push('file2');
        await fs.promises.writeFile(file2, 'content2', 'utf8');
      })
    ]);

    // Операции на разных файлах могут выполняться параллельно
    // Порядок может быть разным, но оба должны выполниться
    expect(results).toContain('file1');
    expect(results).toContain('file2');
    expect(results.length).toBe(2);

    // Проверяем содержимое файлов
    const content1 = await fs.promises.readFile(file1, 'utf8');
    const content2 = await fs.promises.readFile(file2, 'utf8');
    expect(content1).toBe('content1');
    expect(content2).toBe('content2');
  });

  test('should handle errors correctly', async () => {
    await expect(
      withFileLock(testFile, async () => {
        throw new Error('Test error');
      })
    ).rejects.toThrow('Test error');

    // После ошибки блокировка должна быть освобождена
    // Проверяем, что следующая операция может выполниться
    await withFileLock(testFile, async () => {
      await fs.promises.writeFile(testFile, 'success', 'utf8');
    });

    const content = await fs.promises.readFile(testFile, 'utf8');
    expect(content).toBe('success');
  });

  test('should return operation result', async () => {
    const result = await withFileLock(testFile, async () => {
      await fs.promises.writeFile(testFile, 'test', 'utf8');
      return 'operation completed';
    });

    expect(result).toBe('operation completed');
  });

  test('should clean up locks when queue is empty', async () => {
    // Выполняем операцию
    await withFileLock(testFile, async () => {
      await fs.promises.writeFile(testFile, 'test', 'utf8');
    });

    // После завершения операции блокировка должна быть удалена
    // Проверяем, что следующая операция создает новую блокировку
    await withFileLock(testFile, async () => {
      await fs.promises.writeFile(testFile, 'test2', 'utf8');
    });

    const content = await fs.promises.readFile(testFile, 'utf8');
    expect(content).toBe('test2');
  });

  test('clearAllLocks should remove all locks', () => {
    // Создаем несколько блокировок
    const file1 = path.join(testDir, 'lock1.txt');
    const file2 = path.join(testDir, 'lock2.txt');

    // Запускаем операции, но не ждем их завершения
    withFileLock(file1, async () => {
      await new Promise(resolve => setTimeout(resolve, LOCK_TEST_DELAY_VERY_LONG));
    });
    withFileLock(file2, async () => {
      await new Promise(resolve => setTimeout(resolve, LOCK_TEST_DELAY_VERY_LONG));
    });

    // Очищаем все блокировки
    clearAllLocks();

    // После очистки новые операции должны работать нормально
    return expect(
      withFileLock(file1, async () => {
        await fs.promises.writeFile(file1, 'test', 'utf8');
      })
    ).resolves.toBeUndefined();
  });
});
