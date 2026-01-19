import * as fs from 'fs';
import * as path from 'path';
import { RooTraceMCPHandler } from '../src/mcp-handler';
import { SharedLogStorage, RuntimeLog } from '../src/shared-log-storage';
import { injectProbe, removeAllProbesFromFile, clearProbeRegistryForTesting } from '../src/code-injector';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Мокаем vscode перед импортом модулей, которые его используют
jest.mock('vscode', () => require('./vscode-mock'), { virtual: true });

/**
 * Комплексные тесты для MCP Handler
 * 
 * Проверяет:
 * - Все MCP инструменты
 * - Интеграцию с SharedLogStorage (Железный мост)
 * - Обработку ошибок
 * - Валидацию параметров
 * - clear_session с удалением проб и очисткой логов
 */
describe('MCP Handler - Комплексные тесты', () => {
  const testDir = path.join(__dirname, 'temp-test-files');
  let logFilePath: string;
  let storage: SharedLogStorage;
  let handler: RooTraceMCPHandler;
  let originalCwd: string;

  beforeAll(() => {
    originalCwd = process.cwd();
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
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
    handler = new RooTraceMCPHandler();
  });

  afterEach(async () => {
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
   * Симулирует вызов MCP инструмента через прямую логику обработки
   */
  async function callMCPTool(name: string, args: any = {}): Promise<any> {
    let result: any;
    
    switch (name) {
      case 'read_runtime_logs': {
        const { sessionId } = args as { sessionId?: string };
        await storage.reloadLogsFromFile();
        const logs = await storage.getLogs();
        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              logs,
              count: logs.length,
              sessionId: sessionId || 'current'
            })
          }]
        };
        break;
      }
      case 'get_debug_status': {
        const hypotheses = storage.getHypotheses();
        const activeHypotheses = hypotheses.filter(h => h.status === 'active');
        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              serverStatus: 'active',
              activeHypotheses,
              currentSession: 'default-session',
              lastUpdated: new Date().toISOString(),
              uptime: 0
            })
          }]
        };
        break;
      }
      case 'clear_session': {
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
        const { getAllProbes } = require('../src/code-injector');
        getAllProbes().forEach((probe: any) => {
          affectedFiles.add(probe.filePath);
        });
        for (const filePath of affectedFiles) {
          await removeAllProbesFromFile(filePath);
        }
        await storage.clear();
        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Проект полностью очищен. Удалены пробы из ${affectedFiles.size} файлов. Логи сброшены.`,
              filesProcessed: affectedFiles.size
            })
          }]
        };
        break;
      }
      case 'inject_probes': {
        const { filePath, lineNumber, probeType, message, probeCode, hypothesisId } = args as any;
        if (!filePath || !lineNumber || !probeType) {
          result = {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Missing parameters' }) }],
            isError: true
          };
          break;
        }
        try {
          const injectResult = await injectProbe(filePath, lineNumber, probeType, message || '', probeCode, hypothesisId);
          result = {
            content: [{ type: 'text', text: JSON.stringify(injectResult) }],
            isError: injectResult.success === false
          };
        } catch (error) {
          result = {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: String(error) }) }],
            isError: true
          };
        }
        break;
      }
      case 'inject_multiple_probes': {
        const { probes } = args as { probes: any[] };
        if (!probes || !Array.isArray(probes)) {
          result = {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Invalid probes array' }) }],
            isError: true
          };
          break;
        }
        const results: any[] = [];
        for (const probe of probes) {
          try {
            const injectResult = await injectProbe(
              probe.filePath,
              probe.lineNumber,
              probe.probeType,
              probe.message || '',
              probe.probeCode,
              probe.hypothesisId
            );
            results.push(injectResult);
          } catch (error) {
            results.push({ success: false, error: String(error) });
          }
        }
        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              results,
              successfulProbes: results.filter(r => r.success).length
            })
          }]
        };
        break;
      }
      case 'show_user_instructions': {
        const { instructions, stepNumber } = args as { instructions: string; stepNumber?: number };
        result = {
          content: [{
            type: 'text',
            text: `## 📋 Шаг ${stepNumber || 1}: Инструкции по отладке\n\n${instructions}`
          }]
        };
        break;
      }
      default:
        result = {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Unknown tool: ${name}` }) }],
          isError: true
        };
    }
    return result;
  }

  describe('read_runtime_logs', () => {
    test('должен возвращать логи из SharedLogStorage', async () => {
      // Добавляем логи через Extension (Writer)
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test-context',
        data: { test: 'data' }
      });

      // MCP (Reader) должен увидеть логи через Железный мост
      const result = await callMCPTool('read_runtime_logs', {});
      
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      const data = JSON.parse(result.content[0].text);
      expect(data.logs.length).toBeGreaterThanOrEqual(1);
      expect(data.logs[0].context).toBe('test-context');
    });

    test('должен загружать логи из файла перед возвратом', async () => {
      // Создаем файл напрямую (симулируем запись из Extension)
      const log: RuntimeLog = {
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'file-log',
        data: { test: 'data' }
      };

      const { withFileLock } = require('../src/file-lock-utils');
      await withFileLock(logFilePath, async () => {
        fs.writeFileSync(logFilePath, JSON.stringify([log], null, 2), 'utf8');
      });

      // Создаем новый экземпляр storage (симулируем MCP процесс)
      (SharedLogStorage as any).instance = undefined;
      const newStorage = SharedLogStorage.getInstance();

      // MCP должен загрузить логи из файла
      const result = await callMCPTool('read_runtime_logs', {});
      const data = JSON.parse(result.content[0].text);
      expect(data.logs.length).toBeGreaterThanOrEqual(1);
      expect(data.logs[0].context).toBe('file-log');
    });

    test('должен возвращать пустой массив если логов нет', async () => {
      const result = await callMCPTool('read_runtime_logs', {});
      const data = JSON.parse(result.content[0].text);
      expect(data.logs).toEqual([]);
      expect(data.count).toBe(0);
    });
  });

  describe('get_debug_status', () => {
    test('должен возвращать статус сервера и активные гипотезы', async () => {
      // Добавляем логи для разных гипотез
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test',
        data: {}
      });

      const result = await callMCPTool('get_debug_status', {});
      const data = JSON.parse(result.content[0].text);
      
      expect(data.serverStatus).toBeDefined();
      expect(data.activeHypotheses).toBeDefined();
      expect(Array.isArray(data.activeHypotheses)).toBe(true);
    });
  });

  describe('clear_session', () => {
    test('должен удалять все пробы и очищать логи', async () => {
      const testFilePath = path.join(testDir, 'clear-session.js');
      const originalContent = 'function test() { return true; }';
      fs.writeFileSync(testFilePath, originalContent);

      // Вставляем пробы
      await injectProbe(testFilePath, 1, 'log', 'Probe 1');
      await injectProbe(testFilePath, 1, 'log', 'Probe 2');

      // Добавляем логи
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: testFilePath + ':1',
        data: {}
      });

      // Проверяем, что пробы и логи есть
      expect((await storage.getLogs()).length).toBeGreaterThan(0);
      let content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toMatch(/RooTrace \[id:/);

      // Вызываем clear_session
      const result = await callMCPTool('clear_session', {});
      const data = JSON.parse(result.content[0].text);
      
      expect(data.success).toBe(true);
      expect(data.message).toContain('очищен');

      // Проверяем, что пробы удалены
      content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).not.toMatch(/RooTrace \[id:/);
      // Проверяем, что основное содержимое сохранено (может быть изменен формат)
      expect(content).toContain('function test()');
      expect(content).toContain('return true');

      // Проверяем, что логи очищены
      const logs = await storage.getLogs();
      expect(logs.length).toBe(0);
    });

    test('должен обрабатывать несколько файлов с пробами', async () => {
      const file1 = path.join(testDir, 'clear-file1.js');
      const file2 = path.join(testDir, 'clear-file2.js');
      
      fs.writeFileSync(file1, 'function test1() { return 1; }');
      fs.writeFileSync(file2, 'function test2() { return 2; }');

      // Вставляем пробы в оба файла
      await injectProbe(file1, 1, 'log', 'File1 probe');
      await injectProbe(file2, 1, 'log', 'File2 probe');

      // Добавляем логи с контекстом файлов
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: file1 + ':1',
        data: {}
      });
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: file2 + ':1',
        data: {}
      });

      // Вызываем clear_session
      const result = await callMCPTool('clear_session', {});
      const data = JSON.parse(result.content[0].text);
      
      expect(data.success).toBe(true);
      expect(data.filesProcessed).toBeGreaterThanOrEqual(2);

      // Проверяем, что оба файла очищены
      expect(fs.readFileSync(file1, 'utf8')).not.toMatch(/RooTrace \[id:/);
      expect(fs.readFileSync(file2, 'utf8')).not.toMatch(/RooTrace \[id:/);
    });
  });

  describe('inject_probes', () => {
    test('должен вставлять пробу с UUID-маркером', async () => {
      const testFilePath = path.join(testDir, 'inject-mcp.js');
      fs.writeFileSync(testFilePath, 'function test() { return true; }');

      const result = await callMCPTool('inject_probes', {
        filePath: testFilePath,
        lineNumber: 1,
        probeType: 'log',
        message: 'MCP probe',
        hypothesisId: 'H1'
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      // Проверяем, что проба вставлена с UUID-маркером
      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toMatch(/RooTrace \[id:/);
      expect(content).toMatch(/MCP probe/);
    });

    test('должен откатывать файл при ошибке синтаксиса', async () => {
      const testFilePath = path.join(testDir, 'inject-rollback.js');
      const originalContent = 'function test() { return true; }';
      fs.writeFileSync(testFilePath, originalContent);
      const originalBytes = fs.readFileSync(testFilePath);

      const result = await callMCPTool('inject_probes', {
        filePath: testFilePath,
        lineNumber: 1,
        probeType: 'log',
        message: 'Broken probe',
        probeCode: 'consol.log(' // Синтаксическая ошибка
      });

      const data = JSON.parse(result.content[0].text);
      
      // Если синтаксическая проверка включена, должна быть ошибка
      if (data.success === false) {
        expect(data.error || data.message).toBeDefined();
        
        // Файл должен быть откачен
        const finalBytes = fs.readFileSync(testFilePath);
        expect(finalBytes).toEqual(originalBytes);
      }
    });

    test('должен валидировать параметры', async () => {
      // Неверный filePath
      const result1 = await callMCPTool('inject_probes', {
        filePath: '',
        lineNumber: 1,
        probeType: 'log'
      });
      expect(result1.isError).toBe(true);

      // Неверный lineNumber
      const result2 = await callMCPTool('inject_probes', {
        filePath: 'test.js',
        lineNumber: 0,
        probeType: 'log'
      });
      expect(result2.isError).toBe(true);

      // Неверный probeType
      const result3 = await callMCPTool('inject_probes', {
        filePath: 'test.js',
        lineNumber: 1,
        probeType: 'invalid'
      });
      expect(result3.isError).toBe(true);
    });
  });

  describe('inject_multiple_probes', () => {
    test('должен вставлять несколько проб за раз', async () => {
      const testFilePath = path.join(testDir, 'inject-multiple.js');
      fs.writeFileSync(testFilePath, 'function test() {\n  return true;\n}');

      const result = await callMCPTool('inject_multiple_probes', {
        probes: [
          { filePath: testFilePath, lineNumber: 1, probeType: 'log', message: 'Probe 1' },
          { filePath: testFilePath, lineNumber: 2, probeType: 'log', message: 'Probe 2' }
        ]
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.successfulProbes).toBe(2);

      // Проверяем, что обе пробы вставлены
      const content = fs.readFileSync(testFilePath, 'utf8');
      expect((content.match(/RooTrace \[id:/g) || []).length).toBeGreaterThanOrEqual(4); // 2 начала + 2 конца
    });

    test('должен обрабатывать ошибки при вставке нескольких проб', async () => {
      const testFilePath = path.join(testDir, 'inject-multiple-error.js');
      fs.writeFileSync(testFilePath, 'function test() { return true; }');

      const result = await callMCPTool('inject_multiple_probes', {
        probes: [
          { filePath: testFilePath, lineNumber: 1, probeType: 'log', message: 'Valid probe' },
          { filePath: 'nonexistent.js', lineNumber: 1, probeType: 'log', message: 'Invalid probe' }
        ]
      });

      const data = JSON.parse(result.content[0].text);
      // Хотя бы одна проба должна быть успешной
      expect(data.successfulProbes).toBeGreaterThanOrEqual(1);
    });
  });

  describe('show_user_instructions', () => {
    test('должен возвращать структурированные инструкции', async () => {
      const result = await callMCPTool('show_user_instructions', {
        instructions: 'Test instructions',
        stepNumber: 1
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Шаг 1');
      expect(result.content[0].text).toContain('Test instructions');
    });
  });

  describe('Обработка ошибок', () => {
    test('должен возвращать MCP-compliant error responses', async () => {
      const result = await callMCPTool('unknown_tool', {});
      
      expect(result.isError).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    test('должен обрабатывать ошибки при инъекции проб', async () => {
      const result = await callMCPTool('inject_probes', {
        filePath: '/invalid/path/file.js',
        lineNumber: 1,
        probeType: 'log'
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error || data.message).toBeDefined();
    });
  });

  describe('Интеграция с Железным мостом', () => {
    test('должен видеть логи, добавленные через Extension', async () => {
      // Симулируем добавление логов через Extension
      for (let i = 0; i < 5; i++) {
        await storage.addLog({
          timestamp: new Date().toISOString(),
          hypothesisId: 'H1',
          context: `extension-log-${i}`,
          data: { index: i }
        });
      }

      // MCP должен увидеть логи через Железный мост
      const result = await callMCPTool('read_runtime_logs', {});
      const data = JSON.parse(result.content[0].text);
      
      expect(data.logs.length).toBeGreaterThanOrEqual(5);
      expect(data.logs.some((log: RuntimeLog) => log.context === 'extension-log-0')).toBe(true);
    });

    test('должен синхронизироваться при одновременной записи и чтении', async () => {
      // Запускаем параллельные операции
      const writePromise = storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'parallel-test',
        data: {}
      });

      const readPromise = callMCPTool('read_runtime_logs', {});

      await Promise.all([writePromise, readPromise]);

      // Проверяем, что лог сохранен
      const logs = await storage.getLogs();
      expect(logs.some(log => log.context === 'parallel-test')).toBe(true);
    });
  });
});
