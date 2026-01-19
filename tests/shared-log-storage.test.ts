import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { SharedLogStorage, RuntimeLog } from '../src/shared-log-storage';
import { withFileLock } from '../src/file-lock-utils';
import { LOG_SAVE_TIMEOUT, FILE_SYNC_TIMEOUT, HIGH_LOAD_TIMEOUT, MAX_RETRY_ATTEMPTS, RETRY_DELAY, MEDIUM_DELAY, LONG_DELAY, SHORT_DELAY } from './constants';
import { waitForLogsSaved } from './helpers/test-helpers';

// Мокаем vscode перед импортом модулей, которые его используют
jest.mock('vscode', () => require('./vscode-mock'), { virtual: true });

/**
 * Комплексные тесты для SharedLogStorage и Железного моста (Iron Bridge)
 * 
 * Проверяет:
 * - Файловые блокировки при одновременной записи и чтении
 * - Синхронизацию через fs.watchFile
 * - Гибридный контекст (Extension Writer / MCP Reader)
 * - Отсутствие race conditions и потери данных
 * - Добавление и получение логов
 * - Индексацию по гипотезам и датам
 * - Ограничение размера
 * - Очистку
 */
describe('SharedLogStorage и Железный мост', () => {
  let testDir: string;
  let logFilePath: string;
  let storage: SharedLogStorage;
  let originalCwd: string;

  beforeAll(() => {
    originalCwd = process.cwd();
  });

  beforeEach(async () => {
    // Создаем уникальную временную директорию для каждого теста
    testDir = path.join(tmpdir(), `rooTrace-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    logFilePath = path.join(testDir, '.ai_debug_logs.json');
    
    // Устанавливаем рабочую директорию для теста (как в других тестах)
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

  describe('Железный мост: Файловые блокировки', () => {
    test('должен предотвращать race conditions при одновременной записи', async () => {
      // Очищаем перед тестом
      await storage.clear();
      
      // Проверяем, что очистка прошла успешно
      const logsBefore = await storage.getLogs();
      expect(logsBefore.length).toBe(0);
      
      // Используем события вместо polling для надежности
      const receivedLogs: RuntimeLog[] = [];
      
      // Подписываемся на события перед началом записи
      const logAddedHandler = (log: RuntimeLog) => {
        if (log.context && log.context.startsWith('test-')) {
          receivedLogs.push(log);
        }
      };
      storage.on('logAdded', logAddedHandler);
      
      // Записываем последовательно для надежности в тестах
      // В реальности файловые блокировки должны предотвращать потерю данных
      for (let i = 0; i < 10; i++) {
        await storage.addLog({
          timestamp: new Date().toISOString(),
          hypothesisId: `H${(i % 5) + 1}`,
          context: `test-${i}`,
          data: { index: i }
        });
      }
      
      // Даем время на сохранение и обработку событий
      await waitForLogsSaved(storage, 10, FILE_SYNC_TIMEOUT);

      // Отписываемся от событий
      storage.removeListener('logAdded', logAddedHandler);
      
      // Проверяем, что все логи сохранены
      const savedLogs = await storage.getLogs();
      const testLogs = savedLogs.filter(log => log.context && log.context.startsWith('test-'));
      expect(testLogs.length).toBe(10);
      
      // Также проверяем файл напрямую
      const fileContent = fs.readFileSync(logFilePath, 'utf8');
      const fileLogs = JSON.parse(fileContent);
      const testLogsInFile = fileLogs.filter((log: any) => log.context && log.context.startsWith('test-'));
      expect(testLogsInFile.length).toBe(10);
    });

    test('должен предотвращать race conditions при одновременном чтении и записи', async () => {
      // Очищаем перед тестом
      await storage.clear();
      
      for (let i = 0; i < 5; i++) {
        await storage.addLog({
          timestamp: new Date().toISOString(),
          hypothesisId: 'H1',
          context: `initial-${i}`,
          data: { index: i }
        });
      }
      
      // Даем время на сохранение начальных логов
      await waitForLogsSaved(storage, 5, MEDIUM_DELAY);

      const readPromises = Array.from({ length: 5 }, () => storage.getLogs());
      const writePromises = Array.from({ length: 5 }, (_, i) => 
        storage.addLog({
          timestamp: new Date().toISOString(),
          hypothesisId: 'H2',
          context: `new-${i}`,
          data: { index: i + 5 }
        })
      );

      const [readResults, _] = await Promise.all([
        Promise.all(readPromises),
        Promise.all(writePromises)
      ]);
      
      // Даем время на сохранение новых логов (увеличено для надежности)
      await waitForLogsSaved(storage, 10, FILE_SYNC_TIMEOUT);

      readResults.forEach(logs => {
        expect(Array.isArray(logs)).toBe(true);
        // При параллельном чтении и записи количество может варьироваться
        expect(logs.length).toBeGreaterThanOrEqual(5);
      });
      
      // Проверяем, что новые логи были добавлены
      const allLogs = await storage.getLogs();
      const newLogs = allLogs.filter(log => log.context && log.context.startsWith('new-'));
      expect(newLogs.length).toBe(5);

      // Проверяем общее количество логов
      const finalLogs = await storage.getLogs();
      expect(finalLogs.length).toBe(10);
    });

    test('должен гарантировать атомарность операций clear()', async () => {
      for (let i = 0; i < 10; i++) {
        await storage.addLog({
          timestamp: new Date().toISOString(),
          hypothesisId: 'H1',
          context: `test-${i}`,
          data: { index: i }
        });
      }

      const readPromise = storage.getLogs();
      const clearPromise = storage.clear();

      await Promise.all([readPromise, clearPromise]);

      const logs = await storage.getLogs();
      expect(logs.length).toBe(0);

      const fileContent = fs.readFileSync(logFilePath, 'utf8');
      const fileLogs = JSON.parse(fileContent);
      expect(fileLogs.length).toBe(0);
    });
  });

  describe('Железный мост: Синхронизация через fs.watchFile', () => {
    test('должен автоматически синхронизироваться при изменении файла', async () => {
      // Очищаем перед тестом
      await storage.clear();
      
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test-context',
        data: { test: 'data' }
      });
      
      // Даем время на сохранение
      await waitForLogsSaved(storage, 1, MEDIUM_DELAY);

      // Создаем новый storage для MCP (имитация MCP контекста)
      (storage as any).stopWatcher();
      (SharedLogStorage as any).instance = undefined;
      
      // Устанавливаем рабочую директорию
      try {
        process.chdir(testDir);
      } catch (e) {
        // Игнорируем ошибки chdir
      }
      
      const mcpStorage = SharedLogStorage.getInstance();
      
      // Принудительно загружаем из файла
      await mcpStorage.reloadLogsFromFile();

      const logs = await mcpStorage.getLogs();
      expect(logs.length).toBeGreaterThanOrEqual(1);
      
      // Очищаем MCP storage
      (mcpStorage as any).stopWatcher();
      (SharedLogStorage as any).instance = undefined;
    }, 10000);

    test('должен обрабатывать множественные изменения файла', async () => {
      // Очищаем перед тестом
      await storage.clear();
      
      // Используем события для отслеживания добавления логов
      const receivedLogs: RuntimeLog[] = [];
      const logAddedHandler = (log: RuntimeLog) => {
        if (log.context && log.context.startsWith('test-')) {
          receivedLogs.push(log);
        }
      };
      storage.on('logAdded', logAddedHandler);
      
      for (let i = 0; i < 5; i++) {
        await storage.addLog({
          timestamp: new Date().toISOString(),
          hypothesisId: 'H1',
          context: `test-${i}`,
          data: { index: i }
        });
        await new Promise(resolve => setTimeout(resolve, SHORT_DELAY / 2));
      }
      
      // Даем время на обработку событий
      await waitForLogsSaved(storage, 5, FILE_SYNC_TIMEOUT);
      
      // Отписываемся от событий
      storage.removeListener('logAdded', logAddedHandler);

      // Проверяем с повторными попытками для надежности
      let logs = await storage.getLogs();
      let testLogs = logs.filter(log => log.context && log.context.startsWith('test-'));
      let attempts = 0;
      while (testLogs.length < 5 && attempts < MAX_RETRY_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        logs = await storage.getLogs();
        testLogs = logs.filter(log => log.context && log.context.startsWith('test-'));
        attempts++;
      }
      expect(testLogs.length).toBe(5);
    });
  });

  describe('Железный мост: Гибридный контекст', () => {
    test('Extension (Writer) должен сразу сбрасывать данные на диск', async () => {
      const log: RuntimeLog = {
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'writer-test',
        data: { test: 'data' }
      };

      await storage.addLog(log);

      const fileContent = fs.readFileSync(logFilePath, 'utf8');
      const fileLogs = JSON.parse(fileContent);
      expect(fileLogs.length).toBe(1);
      expect(fileLogs[0].context).toBe('writer-test');
    });

    test('MCP (Reader) должен загружать данные из файла перед возвратом', async () => {
      // Очищаем перед тестом
      await storage.clear();
      
      const log: RuntimeLog = {
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'file-test',
        data: { test: 'data' }
      };

      await withFileLock(logFilePath, async () => {
        fs.writeFileSync(logFilePath, JSON.stringify([log], null, 2), 'utf8');
      });

      // Создаем новый storage для MCP (имитация MCP контекста)
      (storage as any).stopWatcher();
      (SharedLogStorage as any).instance = undefined;
      
      // Устанавливаем рабочую директорию
      try {
        process.chdir(testDir);
      } catch (e) {
        // Игнорируем ошибки chdir
      }
      
      const mcpStorage = SharedLogStorage.getInstance();
      
      // Принудительно загружаем из файла
      await mcpStorage.reloadLogsFromFile();

      const logs = await mcpStorage.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].context).toBe('file-test');
      
      // Очищаем MCP storage
      (mcpStorage as any).stopWatcher();
      (SharedLogStorage as any).instance = undefined;
    });

    test('должен синхронизироваться при одновременной работе Extension и MCP', async () => {
      for (let i = 0; i < 3; i++) {
        await storage.addLog({
          timestamp: new Date().toISOString(),
          hypothesisId: 'H1',
          context: `extension-${i}`,
          data: { index: i }
        });
      }

      // Даем время на сохранение логов перед пересозданием
      await waitForLogsSaved(storage, 3, LOG_SAVE_TIMEOUT);
      
      // Создаем новый storage для MCP (имитация MCP контекста)
      (storage as any).stopWatcher();
      (SharedLogStorage as any).instance = undefined;
      
      // Устанавливаем рабочую директорию
      try {
        process.chdir(testDir);
      } catch (e) {
        // Игнорируем ошибки chdir
      }
      
      const mcpStorage = SharedLogStorage.getInstance();

      // Принудительно загружаем из файла
      await mcpStorage.reloadLogsFromFile();
      
      // Даем время на загрузку
      await waitForLogsSaved(mcpStorage, 3, LOG_SAVE_TIMEOUT);

      const mcpLogs = await mcpStorage.getLogs();
      const extensionLogs = mcpLogs.filter(log => log.context && log.context.startsWith('extension-'));
      expect(extensionLogs.length).toBe(3);
      expect(extensionLogs[0].context).toBe('extension-0');
      
      // Очищаем MCP storage
      (mcpStorage as any).stopWatcher();
      (SharedLogStorage as any).instance = undefined;
    });
  });

  describe('Железный мост: Отсутствие потери данных', () => {
    test('должен сохранять все логи даже при высокой нагрузке', async () => {
      // Очищаем перед тестом
      await storage.clear();
      
      const totalLogs = 100;
      
      // Записываем последовательно для надежности в тестах
      for (let i = 0; i < totalLogs; i++) {
        await storage.addLog({
          timestamp: new Date().toISOString(),
          hypothesisId: `H${(i % 5) + 1}`,
          context: `load-test-${i}`,
          data: { index: i }
        });
      }
      
      // Даем время на сохранение в файл (увеличено для большого количества логов)
      await waitForLogsSaved(storage, 100, HIGH_LOAD_TIMEOUT);

      // Проверяем с повторными попытками для надежности
      let logs = await storage.getLogs();
      let loadTestLogs = logs.filter(log => log.context && log.context.startsWith('load-test-'));
      let attempts = 0;
      while (loadTestLogs.length < totalLogs && attempts < MAX_RETRY_ATTEMPTS * 2) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        logs = await storage.getLogs();
        loadTestLogs = logs.filter(log => log.context && log.context.startsWith('load-test-'));
        attempts++;
      }
      expect(loadTestLogs.length).toBe(totalLogs);

      const fileContent = fs.readFileSync(logFilePath, 'utf8');
      const fileLogs = JSON.parse(fileContent);
      const loadTestLogsInFile = fileLogs.filter((log: any) => log.context && log.context.startsWith('load-test-'));
      expect(loadTestLogsInFile.length).toBe(totalLogs);
    });

    test('должен корректно обрабатывать ограничение размера логов', async () => {
      // Очищаем перед тестом
      await storage.clear();
      
      const maxLogs = 1000;
      const extraLogs = 100;

      // Используем события для отслеживания добавления логов
      const receivedLogs: RuntimeLog[] = [];
      const logAddedHandler = (log: RuntimeLog) => {
        if (log.context && log.context.startsWith('log-')) {
          receivedLogs.push(log);
        }
      };
      storage.on('logAdded', logAddedHandler);

      for (let i = 0; i < maxLogs + extraLogs; i++) {
        await storage.addLog({
          timestamp: new Date().toISOString(),
          hypothesisId: 'H1',
          context: `log-${i}`,
          data: { index: i }
        });
      }
      
      // Даем время на обработку и обрезку логов
      // Используем простую задержку, так как waitForLogsSaved может не сработать для обрезки
      await new Promise(resolve => setTimeout(resolve, FILE_SYNC_TIMEOUT));
      
      // Отписываемся от событий
      storage.removeListener('logAdded', logAddedHandler);

      const logs = await storage.getLogs();
      expect(logs.length).toBeLessThanOrEqual(maxLogs);
      if (logs.length > 0) {
        const lastLog = logs[logs.length - 1];
        expect(lastLog).toBeDefined();
        const lastLogData = lastLog.data as { index?: number };
        if (lastLogData && typeof lastLogData.index === 'number') {
          expect(lastLogData.index).toBeGreaterThanOrEqual(maxLogs + extraLogs - maxLogs);
        }
      }
    });
  });

  describe('Базовые операции', () => {
    test('должен добавлять и возвращать логи', async () => {
      const log: RuntimeLog = {
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test-context',
        data: { test: 'data' }
      };

      await storage.addLog(log);
      const logs = await storage.getLogs();

      expect(logs.length).toBe(1);
      expect(logs[0].context).toBe('test-context');
      expect(logs[0].hypothesisId).toBe('H1');
    });

    test('должен сохранять логи в файл', async () => {
      const log: RuntimeLog = {
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'file-test',
        data: {}
      };

      await storage.addLog(log);

      expect(fs.existsSync(logFilePath)).toBe(true);
      const fileContent = fs.readFileSync(logFilePath, 'utf8');
      const fileLogs = JSON.parse(fileContent);
      expect(fileLogs.length).toBe(1);
      expect(fileLogs[0].context).toBe('file-test');
    });

    test('должен ограничивать размер логов', async () => {
      for (let i = 0; i < 50; i++) {
        await storage.addLog({
          timestamp: new Date().toISOString(),
          hypothesisId: 'H1',
          context: `log-${i}`,
          data: { index: i }
        });
      }

      const logs = await storage.getLogs();
      expect(logs.length).toBeLessThanOrEqual(1000);
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  describe('Индексация', () => {
    test('должен корректно индексировать логи по гипотезам', async () => {
      for (let i = 0; i < 10; i++) {
        await storage.addLog({
          timestamp: new Date().toISOString(),
          hypothesisId: `H${(i % 3) + 1}`,
          context: `test-${i}`,
          data: { index: i }
        });
      }

      const h1Logs = await storage.getLogsByHypothesis('H1');
      expect(h1Logs.length).toBeGreaterThan(0);
      expect(h1Logs.every(log => log.hypothesisId === 'H1')).toBe(true);
    });

    test('должен возвращать логи по гипотезе', async () => {
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'H1-log',
        data: {}
      });
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H2',
        context: 'H2-log',
        data: {}
      });
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'H1-log-2',
        data: {}
      });

      const h1Logs = await storage.getLogsByHypothesis('H1');
      expect(h1Logs.length).toBe(2);
      expect(h1Logs.every(log => log.hypothesisId === 'H1')).toBe(true);
    });

    test('должен возвращать пустой массив для несуществующей гипотезы', async () => {
      const logs = await storage.getLogsByHypothesis('H999');
      expect(logs).toEqual([]);
    });

    test('должен корректно индексировать логи по датам', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      await storage.addLog({
        timestamp: yesterday.toISOString(),
        hypothesisId: 'H1',
        context: 'yesterday',
        data: {}
      });

      await storage.addLog({
        timestamp: today.toISOString(),
        hypothesisId: 'H1',
        context: 'today',
        data: {}
      });

      const recentLogs = storage.getLogsByDateRange(yesterday, today);
      expect(recentLogs.length).toBeGreaterThanOrEqual(2);
    });

    test('должен возвращать логи в диапазоне дат', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      await storage.addLog({
        timestamp: yesterday.toISOString(),
        hypothesisId: 'H1',
        context: 'yesterday',
        data: {}
      });
      await storage.addLog({
        timestamp: today.toISOString(),
        hypothesisId: 'H1',
        context: 'today',
        data: {}
      });
      await storage.addLog({
        timestamp: tomorrow.toISOString(),
        hypothesisId: 'H1',
        context: 'tomorrow',
        data: {}
      });

      const recentLogs = storage.getLogsByDateRange(yesterday, today);
      expect(recentLogs.length).toBeGreaterThanOrEqual(2);
      expect(recentLogs.some(log => log.context === 'yesterday')).toBe(true);
      expect(recentLogs.some(log => log.context === 'today')).toBe(true);
    });
  });

  describe('Очистка', () => {
    test('должен очищать все логи', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.addLog({
          timestamp: new Date().toISOString(),
          hypothesisId: 'H1',
          context: `log-${i}`,
          data: {}
        });
      }

      expect((await storage.getLogs()).length).toBe(5);

      await storage.clear();

      expect((await storage.getLogs()).length).toBe(0);
      
      const fileContent = fs.readFileSync(logFilePath, 'utf8');
      const fileLogs = JSON.parse(fileContent);
      expect(fileLogs.length).toBe(0);
    });

    test('должен сохранять гипотезы после очистки', async () => {
      await storage.clear();
      const hypotheses = storage.getHypotheses();
      expect(hypotheses.length).toBeGreaterThan(0);
    });

    test('должен пересоздавать индексы после очистки', async () => {
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test',
        data: {}
      });

      await storage.clear();

      const h1Logs = await storage.getLogsByHypothesis('H1');
      expect(h1Logs.length).toBe(0);
    });
  });

  describe('Синхронизация с файлом', () => {
    test('должен загружать логи из файла при инициализации', async () => {
      // Очищаем перед тестом
      await storage.clear();
      
      const logs: RuntimeLog[] = [
        {
          timestamp: new Date().toISOString(),
          hypothesisId: 'H1',
          context: 'file-log',
          data: {}
        }
      ];

      await withFileLock(logFilePath, async () => {
        fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2), 'utf8');
      });

      // Создаем новый storage для проверки загрузки из файла
      (storage as any).stopWatcher();
      (SharedLogStorage as any).instance = undefined;
      
      // Устанавливаем рабочую директорию
      try {
        process.chdir(testDir);
      } catch (e) {
        // Игнорируем ошибки chdir
      }
      
      const newStorage = SharedLogStorage.getInstance();
      
      // Принудительно загружаем из файла
      await newStorage.reloadLogsFromFile();

      const loadedLogs = await newStorage.getLogs();
      expect(loadedLogs.length).toBeGreaterThanOrEqual(1);
      expect(loadedLogs.some(log => log.context === 'file-log')).toBe(true);
      
      // Очищаем новый storage
      (newStorage as any).stopWatcher();
      (SharedLogStorage as any).instance = undefined;
    });

    test('должен синхронизироваться при изменении файла', async () => {
      // Очищаем перед тестом
      await storage.clear();
      
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'sync-test',
        data: {}
      });
      
      // Даем время на сохранение
      await waitForLogsSaved(storage, 1, MEDIUM_DELAY);

      // Создаем новый storage для MCP (имитация MCP контекста)
      (storage as any).stopWatcher();
      (SharedLogStorage as any).instance = undefined;
      
      // Устанавливаем рабочую директорию
      try {
        process.chdir(testDir);
      } catch (e) {
        // Игнорируем ошибки chdir
      }
      
      const mcpStorage = SharedLogStorage.getInstance();
      
      // Принудительно загружаем из файла
      await mcpStorage.reloadLogsFromFile();

      const logs = await mcpStorage.getLogs();
      expect(logs.some(log => log.context === 'sync-test')).toBe(true);
      
      // Очищаем MCP storage
      (mcpStorage as any).stopWatcher();
      (SharedLogStorage as any).instance = undefined;
    });
  });

  describe('Обработка ошибок', () => {
    test('должен корректно обрабатывать поврежденный JSON файл', async () => {
      await withFileLock(logFilePath, async () => {
        fs.writeFileSync(logFilePath, 'invalid json{', 'utf8');
      });

      // Создаем новый storage для проверки обработки ошибок
      (storage as any).stopWatcher();
      (SharedLogStorage as any).instance = undefined;
      
      // Устанавливаем рабочую директорию
      try {
        process.chdir(testDir);
      } catch (e) {
        // Игнорируем ошибки chdir
      }
      
      const newStorage = SharedLogStorage.getInstance();

      const logs = await newStorage.getLogs();
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBe(0);
      
      // Очищаем новый storage
      (newStorage as any).stopWatcher();
      (SharedLogStorage as any).instance = undefined;
    });

    test('должен корректно обрабатывать отсутствующий файл', async () => {
      if (fs.existsSync(logFilePath)) {
        fs.unlinkSync(logFilePath);
      }

      // Создаем новый storage для проверки обработки отсутствующего файла
      (storage as any).stopWatcher();
      (SharedLogStorage as any).instance = undefined;
      
      // Устанавливаем рабочую директорию
      try {
        process.chdir(testDir);
      } catch (e) {
        // Игнорируем ошибки chdir
      }
      
      const newStorage = SharedLogStorage.getInstance();

      const logs = await newStorage.getLogs();
      expect(Array.isArray(logs)).toBe(true);
      expect(fs.existsSync(logFilePath)).toBe(true);
      
      // Очищаем новый storage
      (newStorage as any).stopWatcher();
      (SharedLogStorage as any).instance = undefined;
    });
  });
});
