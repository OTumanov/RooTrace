import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { injectProbe, removeAllProbesFromFile, clearProbeRegistryForTesting } from '../src/code-injector';
import { SharedLogStorage, RuntimeLog } from '../src/shared-log-storage';
import { RooTraceMCPHandler } from '../src/mcp-handler';
import { LOG_SAVE_TIMEOUT, FILE_SYNC_TIMEOUT, SHORT_DELAY, MEDIUM_DELAY } from './constants';
import { waitForLogsSaved } from './helpers/test-helpers';

// Мокаем vscode перед импортом модулей, которые его используют
jest.mock('vscode', () => require('./vscode-mock'), { virtual: true });

/**
 * End-to-End тесты для полного цикла работы RooTrace
 * 
 * Проверяет:
 * - Полный цикл: инъекция -> запуск кода -> сбор логов -> очистка
 * - Интеграцию HTTP сервера и MCP сервера
 * - Синхронизацию через Железный мост
 * - Хирургическую очистку через UUID-маркеры
 */
describe('End-to-End тесты (Железный мост)', () => {
  const testDir = path.join(__dirname, 'temp-test-files');
  let logFilePath: string;
  let storage: SharedLogStorage;
  let httpServer: http.Server | null = null;
  let serverPort: number = 0;
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

  beforeEach(() => {
    // Очищаем singleton
    (SharedLogStorage as any).instance = undefined;
    clearProbeRegistryForTesting();
    
    // Убеждаемся, что директория существует перед chdir
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    try {
      process.chdir(testDir);
    } catch (e) {
      // Игнорируем ошибки chdir
    }
    logFilePath = path.join(testDir, '.ai_debug_logs.json');
    
    if (fs.existsSync(logFilePath)) {
      fs.unlinkSync(logFilePath);
    }
    
    storage = SharedLogStorage.getInstance();
  });

  afterEach(async () => {
    // Останавливаем HTTP сервер
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer!.close(() => resolve());
      });
      httpServer = null;
    }
    
    // Очищаем файлы
    if (fs.existsSync(logFilePath)) {
      fs.unlinkSync(logFilePath);
    }
    
    clearProbeRegistryForTesting();
    (SharedLogStorage as any).instance = undefined;
    
    // Восстанавливаем рабочую директорию
    try {
      if (originalCwd) {
        process.chdir(originalCwd);
      }
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

  /**
   * Запускает простой HTTP сервер для приема логов (симулирует Extension HTTP сервер)
   */
  function startHTTPServer(port: number = 51234): Promise<http.Server> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        if (req.method === 'POST' && req.url === '/') {
          let body = '';
          req.on('data', chunk => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const data = JSON.parse(body);
              // Симулируем logToOutputChannel из extension.ts
              await storage.addLog({
                timestamp: new Date().toISOString(),
                hypothesisId: data.hypothesisId || 'H1',
                context: data.message || 'HTTP test',
                data: data.state || {}
              });
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'success', message: 'Data received' }));
            } catch (error) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'error', message: String(error) }));
            }
          });
        } else if (req.method === 'GET' && req.url === '/logs') {
          // Симулируем GET /logs endpoint
          const logs = await storage.getLogs();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success', logs }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      server.listen(port, 'localhost', () => {
        httpServer = server;
        serverPort = port;
        resolve(server);
      });

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          // Порт занят, пробуем следующий
          startHTTPServer(port + 1).then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });
    });
  }

  /**
   * Отправляет POST запрос на HTTP сервер
   */
  function sendLogToServer(port: number, logData: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: port,
        path: '/',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      };

      const req = http.request(options, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      });

      req.on('error', reject);
      req.write(JSON.stringify(logData));
      req.end();
    });
  }

  describe('Сквозной проход (End-to-End)', () => {
    test('должен выполнить полный цикл: инъекция -> запуск -> сбор логов -> очистка', async () => {
      // Шаг 1: Создаем тестовый файл
      const testFilePath = path.join(testDir, 'e2e-test.js');
      const originalContent = `function calculate(x, y) {
  const result = x + y;
  return result;
}`;
      fs.writeFileSync(testFilePath, originalContent);

      // Шаг 2: Запускаем HTTP сервер
      await startHTTPServer(51234);

      // Шаг 3: Инъекция проб
      const result1 = await injectProbe(testFilePath, 2, 'log', 'Checking x value', undefined, 'H1');
      const result2 = await injectProbe(testFilePath, 3, 'log', 'Checking result', undefined, 'H1');
      
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      // Проверяем, что пробы вставлены с UUID-маркерами
      let content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toMatch(/RooTrace \[id:/);
      expect((content.match(/RooTrace \[id:/g) || []).length).toBeGreaterThanOrEqual(4); // 2 начала + 2 конца

      // Шаг 4: Симулируем запуск кода (отправляем логи на HTTP сервер)
      await sendLogToServer(51234, {
        hypothesisId: 'H1',
        message: 'Checking x value',
        state: { x: 5 }
      });
      
      await sendLogToServer(51234, {
        hypothesisId: 'H1',
        message: 'Checking result',
        state: { result: 10 }
      });

      // Небольшая задержка для синхронизации
      await waitForLogsSaved(storage, 2, MEDIUM_DELAY);

      // Шаг 5: Проверяем, что логи появились в файле через Железный мост
      expect(fs.existsSync(logFilePath)).toBe(true);
      const fileContent = fs.readFileSync(logFilePath, 'utf8');
      const fileLogs = JSON.parse(fileContent);
      // Проверяем точное количество логов (2 пробы должны создать 2 лога)
      expect(fileLogs.length).toBe(2);

      // Шаг 6: Проверяем через MCP (симулируем чтение)
      const mcpLogs = await storage.getLogs();
      expect(mcpLogs.length).toBeGreaterThanOrEqual(2);
      expect(mcpLogs.some(log => log.context === 'Checking x value')).toBe(true);
      expect(mcpLogs.some(log => log.context === 'Checking result')).toBe(true);

      // Шаг 7: Очистка через clear_session (симулируем MCP вызов)
      // Сначала удаляем пробы
      const cleanupResult = await removeAllProbesFromFile(testFilePath);
      expect(cleanupResult.success).toBe(true);

      // Затем очищаем логи
      await storage.clear();

      // Шаг 8: Проверяем, что все очищено
      content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).not.toMatch(/RooTrace \[id:/);
      expect(content).toBe(originalContent);

      const finalLogs = await storage.getLogs();
      expect(finalLogs.length).toBe(0);

      // Файл логов должен быть пустым
      const finalFileContent = fs.readFileSync(logFilePath, 'utf8');
      const finalFileLogs = JSON.parse(finalFileContent);
      expect(finalFileLogs.length).toBe(0);
    }, 15000);

    test('должен синхронизировать логи между HTTP и MCP в реальном времени', async () => {
      await startHTTPServer(51235);

      // Отправляем логи на HTTP сервер
      for (let i = 0; i < 5; i++) {
        await sendLogToServer(51235, {
          hypothesisId: 'H1',
          message: `Log ${i}`,
          state: { index: i }
        });
        
        // Небольшая задержка между отправками
        await new Promise(resolve => setTimeout(resolve, SHORT_DELAY));
      }

      // Ждем синхронизации через watcher
      await waitForLogsSaved(storage, 5, FILE_SYNC_TIMEOUT);

      // MCP должен увидеть все логи через Железный мост
      const logs = await storage.getLogs();
      expect(logs.length).toBe(5);
      
      // Проверяем файл
      const fileContent = fs.readFileSync(logFilePath, 'utf8');
      const fileLogs = JSON.parse(fileContent);
      expect(fileLogs.length).toBe(5);
    }, 10000);

    test('должен обрабатывать высокую нагрузку без потери данных', async () => {
      await startHTTPServer(51236);

      const totalLogs = 50;
      const promises = Array.from({ length: totalLogs }, (_, i) =>
        sendLogToServer(51236, {
          hypothesisId: `H${(i % 5) + 1}`,
          message: `Load test ${i}`,
          state: { index: i }
        })
      );

      await Promise.all(promises);

      // Ждем синхронизации
      await waitForLogsSaved(storage, 50, FILE_SYNC_TIMEOUT);

      // Проверяем, что все логи сохранены
      const logs = await storage.getLogs();
      expect(logs.length).toBe(totalLogs);

      // Проверяем файл
      const fileContent = fs.readFileSync(logFilePath, 'utf8');
      const fileLogs = JSON.parse(fileContent);
      expect(fileLogs.length).toBe(totalLogs);
    }, 15000);
  });

  describe('Интеграция инъекции проб и сбора логов', () => {
    test('должен собирать логи от вставленных проб', async () => {
      const testFilePath = path.join(testDir, 'probe-logs.js');
      const originalContent = `function test() {
  const x = 42;
  return x;
}`;
      fs.writeFileSync(testFilePath, originalContent);

      await startHTTPServer(51237);

      // Вставляем пробу
      await injectProbe(testFilePath, 2, 'log', 'Checking x', undefined, 'H1');

      // Симулируем выполнение кода с пробой (отправляем лог)
      await sendLogToServer(51237, {
        hypothesisId: 'H1',
        message: 'Checking x',
        state: { x: 42 }
      });

      // Ждем синхронизации
      await waitForLogsSaved(storage, 1, LOG_SAVE_TIMEOUT);

      // Проверяем, что лог собран
      const logs = await storage.getLogs();
      const relevantLogs = logs.filter(log => log.context === 'Checking x');
      expect(relevantLogs.length).toBeGreaterThanOrEqual(1);
    }, 10000);

    test('должен коррелировать логи с гипотезами', async () => {
      const testFilePath = path.join(testDir, 'hypothesis-logs.js');
      fs.writeFileSync(testFilePath, 'function test() { return true; }');

      await startHTTPServer(51238);

      // Вставляем пробы для разных гипотез
      await injectProbe(testFilePath, 1, 'log', 'H1 probe', undefined, 'H1');
      await injectProbe(testFilePath, 1, 'log', 'H2 probe', undefined, 'H2');

      // Отправляем логи для разных гипотез
      await sendLogToServer(51238, { hypothesisId: 'H1', message: 'H1 probe', state: {} });
      await sendLogToServer(51238, { hypothesisId: 'H2', message: 'H2 probe', state: {} });

      await new Promise(resolve => setTimeout(resolve, 300));

      // Проверяем фильтрацию по гипотезам
      const h1Logs = await storage.getLogsByHypothesis('H1');
      const h2Logs = await storage.getLogsByHypothesis('H2');

      expect(h1Logs.length).toBeGreaterThanOrEqual(1);
      expect(h2Logs.length).toBeGreaterThanOrEqual(1);
      expect(h1Logs.every(log => log.hypothesisId === 'H1')).toBe(true);
      expect(h2Logs.every(log => log.hypothesisId === 'H2')).toBe(true);
    }, 10000);
  });

  describe('Хирургическая очистка в E2E сценарии', () => {
    test('должен полностью очистить проект после сессии отладки', async () => {
      const testFilePath = path.join(testDir, 'cleanup-e2e.js');
      const originalContent = `function test() {
  const x = 1;
  const y = 2;
  return x + y;
}`;
      fs.writeFileSync(testFilePath, originalContent);

      await startHTTPServer(51239);

      // Вставляем несколько проб
      await injectProbe(testFilePath, 2, 'log', 'Probe 1', undefined, 'H1');
      await injectProbe(testFilePath, 3, 'log', 'Probe 2', undefined, 'H1');
      await injectProbe(testFilePath, 4, 'log', 'Probe 3', undefined, 'H2');

      // Отправляем логи
      await sendLogToServer(51239, { hypothesisId: 'H1', message: 'Probe 1', state: {} });
      await sendLogToServer(51239, { hypothesisId: 'H1', message: 'Probe 2', state: {} });
      await sendLogToServer(51239, { hypothesisId: 'H2', message: 'Probe 3', state: {} });

      await new Promise(resolve => setTimeout(resolve, 300));

      // Проверяем, что логи есть
      let logs = await storage.getLogs();
      expect(logs.length).toBeGreaterThanOrEqual(3);

      // Симулируем clear_session: удаляем пробы и очищаем логи
      const cleanupResult = await removeAllProbesFromFile(testFilePath);
      expect(cleanupResult.success).toBe(true);

      await storage.clear();

      // Проверяем, что все очищено
      const finalContent = fs.readFileSync(testFilePath, 'utf8');
      expect(finalContent).not.toMatch(/RooTrace \[id:/);
      expect(finalContent).toBe(originalContent);

      const finalLogs = await storage.getLogs();
      expect(finalLogs.length).toBe(0);

      // Проверяем реестр проб
      const { getAllProbes } = require('../src/code-injector');
      expect(getAllProbes().length).toBe(0);
    }, 15000);

    test('должен очищать пробы из нескольких файлов', async () => {
      const file1 = path.join(testDir, 'cleanup-file1.js');
      const file2 = path.join(testDir, 'cleanup-file2.js');
      
      fs.writeFileSync(file1, 'function test1() { return 1; }');
      fs.writeFileSync(file2, 'function test2() { return 2; }');

      await startHTTPServer(51240);

      // Вставляем пробы в оба файла
      await injectProbe(file1, 1, 'log', 'File1 probe');
      await injectProbe(file2, 1, 'log', 'File2 probe');

      // Симулируем clear_session: собираем файлы из логов
      const logs = await storage.getLogs();
      const affectedFiles = new Set<string>();
      logs.forEach(log => {
        if (log.context && log.context.includes(':')) {
          const filePath = log.context.split(':')[0];
          if (fs.existsSync(filePath)) {
            affectedFiles.add(filePath);
          }
        }
      });

      // Добавляем файлы из реестра проб
      const { getAllProbes } = require('../src/code-injector');
      getAllProbes().forEach((probe: any) => {
        affectedFiles.add(probe.filePath);
      });

      // Удаляем пробы из всех файлов
      for (const filePath of affectedFiles) {
        await removeAllProbesFromFile(filePath);
      }

      // Проверяем, что все файлы очищены
      expect(fs.readFileSync(file1, 'utf8')).not.toMatch(/RooTrace \[id:/);
      expect(fs.readFileSync(file2, 'utf8')).not.toMatch(/RooTrace \[id:/);
    }, 10000);
  });
});
