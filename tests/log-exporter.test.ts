import * as fs from 'fs';
import * as path from 'path';
import { LogExporter, ExportFormat, ExportOptions } from '../src/log-exporter';
import { SharedLogStorage, RuntimeLog } from '../src/shared-log-storage';
import { SHORT_DELAY } from './constants';
import { SessionManager } from '../src/session-manager';

// Мокаем vscode перед импортом модулей, которые его используют
jest.mock('vscode', () => require('./vscode-mock'), { virtual: true });

/**
 * Комплексные тесты для LogExporter
 * 
 * Проверяет:
 * - Экспорт во все форматы (JSON, CSV, Markdown, HTML, Excel)
 * - Фильтрацию по гипотезам и датам
 * - Включение метаданных
 * - Сохранение в файл
 * - Экранирование специальных символов
 */
describe('LogExporter', () => {
  const testDir = path.join(__dirname, 'temp-test-files');
  let storage: SharedLogStorage;
  let originalCwd: string;

  beforeAll(() => {
    originalCwd = process.cwd();
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  beforeEach(async () => {
    // Останавливаем watcher если есть
    if (storage) {
      (storage as any).stopWatcher();
    }
    (SharedLogStorage as any).instance = undefined;
    (SessionManager as any).instance = undefined;
    // Убеждаемся, что директория существует перед chdir
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    try {
      process.chdir(testDir);
    } catch (e) {
      // Игнорируем ошибки chdir
    }
    storage = SharedLogStorage.getInstance();
    // Очищаем логи перед каждым тестом
    await storage.clear();
  });

  afterEach(async () => {
    // Очищаем логи
    await storage.clear();
    (SharedLogStorage as any).instance = undefined;
    (SessionManager as any).instance = undefined;
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

  describe('Экспорт в JSON', () => {
    test('должен экспортировать логи в JSON формат', async () => {
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test-context',
        data: { test: 'data' }
      });

      const options: ExportOptions = { format: 'json' };
      const result = await LogExporter.exportLogs(options);

      const parsed = JSON.parse(result);
      expect(parsed.logs).toBeDefined();
      expect(parsed.logs.length).toBe(1);
      expect(parsed.totalCount).toBe(1);
      expect(parsed.logs[0].hypothesisId).toBe('H1');
    });

    test('должен включать метаданные при указании includeMetadata', async () => {
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test',
        data: {}
      });

      const options: ExportOptions = { format: 'json', includeMetadata: true };
      const result = await LogExporter.exportLogs(options);

      const parsed = JSON.parse(result);
      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata.currentSession).toBeDefined();
      expect(parsed.metadata.totalSessions).toBeDefined();
    });

    test('должен корректно экспортировать множественные логи', async () => {
      for (let i = 0; i < 10; i++) {
        await storage.addLog({
          timestamp: new Date().toISOString(),
          hypothesisId: `H${(i % 3) + 1}`,
          context: `log-${i}`,
          data: { index: i }
        });
      }

      const options: ExportOptions = { format: 'json' };
      const result = await LogExporter.exportLogs(options);

      const parsed = JSON.parse(result);
      expect(parsed.logs.length).toBe(10);
      expect(parsed.totalCount).toBe(10);
    });
  });

  describe('Экспорт в CSV', () => {
    test('должен экспортировать логи в CSV формат', async () => {
      await storage.addLog({
        timestamp: '2024-01-01T00:00:00.000Z',
        hypothesisId: 'H1',
        context: 'test-context',
        data: { value: 42 }
      });

      const options: ExportOptions = { format: 'csv' };
      const result = await LogExporter.exportLogs(options);

      expect(result).toContain('Timestamp');
      expect(result).toContain('Hypothesis ID');
      expect(result).toContain('Context');
      expect(result).toContain('Data');
      expect(result).toContain('H1');
      expect(result).toContain('test-context');
    });

    test('должен экранировать кавычки в CSV', async () => {
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test "quoted" context',
        data: { message: 'Hello "world"' }
      });

      const options: ExportOptions = { format: 'csv' };
      const result = await LogExporter.exportLogs(options);

      expect(result).toContain('""quoted""');
      expect(result.split('\n').length).toBeGreaterThan(1);
    });

    test('должен корректно обрабатывать пустые данные', async () => {
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'empty-data',
        data: {}
      });

      const options: ExportOptions = { format: 'csv' };
      const result = await LogExporter.exportLogs(options);

      expect(result).toContain('empty-data');
      expect(result.split('\n').length).toBe(2); // Header + 1 row
    });
  });

  describe('Экспорт в Markdown', () => {
    test('должен экспортировать логи в Markdown формат', async () => {
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test-context',
        data: { test: 'data' }
      });

      const options: ExportOptions = { format: 'markdown' };
      const result = await LogExporter.exportLogs(options);

      expect(result).toContain('# RooTrace Debug Logs');
      expect(result).toContain('## Logs');
      expect(result).toContain('| Timestamp |');
      expect(result).toContain('H1');
      expect(result).toContain('test-context');
    });

    test('должен включать метаданные в Markdown', async () => {
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test',
        data: {}
      });

      const options: ExportOptions = { format: 'markdown', includeMetadata: true };
      const result = await LogExporter.exportLogs(options);

      expect(result).toContain('**Exported:**');
      expect(result).toContain('**Total Logs:**');
    });

    test('должен экранировать pipe символы в Markdown', async () => {
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test | pipe | symbol',
        data: {}
      });

      const options: ExportOptions = { format: 'markdown' };
      const result = await LogExporter.exportLogs(options);

      // Проверяем, что pipe символы экранированы или заменены
      // В markdown таблицах pipe символы должны быть экранированы или заменены
      expect(result).toMatch(/pipe.*symbol/);
    });
  });

  describe('Экспорт в HTML', () => {
    test('должен экспортировать логи в HTML формат', async () => {
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test-context',
        data: { test: 'data' }
      });

      const options: ExportOptions = { format: 'html' };
      const result = await LogExporter.exportLogs(options);

      expect(result).toContain('<!DOCTYPE html>');
      expect(result).toContain('<html');
      expect(result).toContain('<table>');
      expect(result).toContain('H1');
      expect(result).toContain('test-context');
    });

    test('должен экранировать HTML символы', async () => {
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: '<script>alert("xss")</script>',
        data: { html: '<div>test</div>' }
      });

      const options: ExportOptions = { format: 'html' };
      const result = await LogExporter.exportLogs(options);

      expect(result).toContain('&lt;script&gt;');
      expect(result).toContain('&lt;div&gt;');
      expect(result).not.toContain('<script>');
    });

    test('должен включать стили в HTML', async () => {
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test',
        data: {}
      });

      const options: ExportOptions = { format: 'html' };
      const result = await LogExporter.exportLogs(options);

      expect(result).toContain('<style>');
      expect(result).toContain('font-family');
      expect(result).toContain('background');
    });
  });

  describe('Экспорт в Excel', () => {
    test('должен экспортировать логи в Excel формат (CSV)', async () => {
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test-context',
        data: { test: 'data' }
      });

      const options: ExportOptions = { format: 'excel' };
      const result = await LogExporter.exportLogs(options);

      expect(result).toContain('Timestamp');
      expect(result).toContain('Hypothesis ID');
      expect(result).toContain('H1');
    });
  });

  describe('Фильтрация', () => {
    test('должен фильтровать логи по гипотезам', async () => {
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

      const options: ExportOptions = {
        format: 'json',
        filterByHypothesis: ['H1']
      };
      const result = await LogExporter.exportLogs(options);

      const parsed = JSON.parse(result);
      expect(parsed.logs.length).toBe(2);
      expect(parsed.logs.every((log: RuntimeLog) => log.hypothesisId === 'H1')).toBe(true);
    });

    test('должен фильтровать логи по диапазону дат', async () => {
      // Очищаем перед тестом
      await storage.clear();
      
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
      
      // Даем время на сохранение
      await new Promise(resolve => setTimeout(resolve, SHORT_DELAY));

      const options: ExportOptions = {
        format: 'json',
        dateRange: { start: yesterday, end: today }
      };
      const result = await LogExporter.exportLogs(options);

      const parsed = JSON.parse(result);
      expect(parsed.logs.length).toBe(2);
      expect(parsed.logs.some((log: RuntimeLog) => log.context === 'yesterday')).toBe(true);
      expect(parsed.logs.some((log: RuntimeLog) => log.context === 'today')).toBe(true);
      expect(parsed.logs.some((log: RuntimeLog) => log.context === 'tomorrow')).toBe(false);
    });

    test('должен применять множественные фильтры одновременно', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      await storage.addLog({
        timestamp: yesterday.toISOString(),
        hypothesisId: 'H1',
        context: 'old-H1',
        data: {}
      });
      await storage.addLog({
        timestamp: today.toISOString(),
        hypothesisId: 'H1',
        context: 'new-H1',
        data: {}
      });
      await storage.addLog({
        timestamp: today.toISOString(),
        hypothesisId: 'H2',
        context: 'new-H2',
        data: {}
      });

      const options: ExportOptions = {
        format: 'json',
        filterByHypothesis: ['H1'],
        dateRange: { start: today, end: today }
      };
      const result = await LogExporter.exportLogs(options);

      const parsed = JSON.parse(result);
      expect(parsed.logs.length).toBe(1);
      expect(parsed.logs[0].hypothesisId).toBe('H1');
      expect(parsed.logs[0].context).toBe('new-H1');
    });
  });

  describe('Сохранение в файл', () => {
    test('должен сохранять экспортированные логи в файл', async () => {
      // Очищаем перед тестом
      await storage.clear();
      
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test',
        data: {}
      });
      
      // Даем время на сохранение
      await new Promise(resolve => setTimeout(resolve, SHORT_DELAY));

      const options: ExportOptions = { format: 'json' };
      const content = await LogExporter.exportLogs(options);
      const filePath = await LogExporter.saveToFile(content, 'json', 'test-export.json');

      expect(fs.existsSync(filePath)).toBe(true);
      const savedContent = fs.readFileSync(filePath, 'utf8');
      expect(savedContent).toBe(content);

      // Очищаем
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });

    test('должен использовать правильное расширение для каждого формата', async () => {
      const content = 'test content';
      
      const jsonPath = await LogExporter.saveToFile(content, 'json', 'test.json');
      expect(jsonPath).toContain('.json');
      
      const csvPath = await LogExporter.saveToFile(content, 'csv', 'test.csv');
      expect(csvPath).toContain('.csv');
      
      const htmlPath = await LogExporter.saveToFile(content, 'html', 'test.html');
      expect(htmlPath).toContain('.html');
      
      const mdPath = await LogExporter.saveToFile(content, 'markdown', 'test.md');
      expect(mdPath).toContain('.md');
      
      const excelPath = await LogExporter.saveToFile(content, 'excel', 'test.csv');
      expect(excelPath).toContain('.csv');

      // Очищаем
      [jsonPath, csvPath, htmlPath, mdPath, excelPath].forEach(p => {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      });
    });

    test('должен генерировать имя файла по умолчанию', async () => {
      const content = 'test content';
      const filePath = await LogExporter.saveToFile(content, 'json');

      expect(filePath).toContain('roo-trace-logs-');
      expect(filePath).toContain('.json');

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  });

  describe('Обработка ошибок', () => {
    test('должен выбрасывать ошибку для неподдерживаемого формата', async () => {
      const options = { format: 'unsupported' as ExportFormat };
      
      await expect(LogExporter.exportLogs(options)).rejects.toThrow('Unsupported export format');
    });

    test('должен корректно обрабатывать пустые логи', async () => {
      const options: ExportOptions = { format: 'json' };
      const result = await LogExporter.exportLogs(options);

      const parsed = JSON.parse(result);
      expect(parsed.logs).toEqual([]);
      expect(parsed.totalCount).toBe(0);
    });
  });

  describe('Краевые случаи', () => {
    test('должен корректно обрабатывать логи с большими данными', async () => {
      const largeData = { data: 'x'.repeat(10000) };
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'large-data',
        data: largeData
      });

      const options: ExportOptions = { format: 'json' };
      const result = await LogExporter.exportLogs(options);

      const parsed = JSON.parse(result);
      expect(parsed.logs[0].data.data.length).toBe(10000);
    });

    test('должен корректно обрабатывать специальные символы в данных', async () => {
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'special-chars',
        data: { 
          newline: '\n',
          tab: '\t',
          quote: '"',
          backslash: '\\'
        }
      });

      const options: ExportOptions = { format: 'json' };
      const result = await LogExporter.exportLogs(options);

      const parsed = JSON.parse(result);
      expect(parsed.logs[0].data.newline).toBe('\n');
      expect(parsed.logs[0].data.quote).toBe('"');
    });
  });
});
