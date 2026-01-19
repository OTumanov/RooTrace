import * as fs from 'fs';
import * as path from 'path';
import { detectInstalledExtension, registerMcpServer, unregisterMcpServer } from '../src/mcp-registration';

// Мокаем vscode перед импортом модулей, которые его используют
jest.mock('vscode', () => require('./vscode-mock'), { virtual: true });

/**
 * Комплексные тесты для MCP Registration
 * 
 * Проверяет:
 * - Детектирование установленных расширений (roo-code, roo-cline)
 * - Регистрацию MCP сервера для разных форматов (roo-code, roo-cline)
 * - Удаление регистрации MCP сервера
 * - File locking механизм для предотвращения race conditions
 * - Обработку ошибок
 */
describe('MCP Registration', () => {
  const testDir = path.join(__dirname, 'temp-test-files');
  const rooDir = path.join(testDir, '.roo');
  const mcpConfigPath = path.join(rooDir, 'mcp.json');
  const mockExtensionPath = path.join(__dirname, '..');

  // Сохраняем оригинальные console методы
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  beforeAll(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    // Подавляем вывод консоли во время тестов
    console.log = jest.fn();
    console.error = jest.fn();
  });

  beforeEach(() => {
    // Очищаем тестовую директорию
    if (fs.existsSync(rooDir)) {
      fs.rmSync(rooDir, { recursive: true, force: true });
    }
    fs.mkdirSync(rooDir, { recursive: true });
  });

  afterAll(() => {
    // Восстанавливаем оригинальные console методы
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('detectInstalledExtension', () => {
    test('должен возвращать roo-cline если установлен Roo Cline', async () => {
      const mockVscode = require('./vscode-mock');
      const originalExtensions = [...(mockVscode.extensions?.all || [])];
      
      mockVscode.extensions.all = [
        { id: 'some-other-extension' },
        { id: 'roo-cline-extension' }
      ];

      try {
        const result = await detectInstalledExtension();
        expect(result).toBe('roo-cline');
      } finally {
        mockVscode.extensions.all = originalExtensions;
      }
    });

    test('должен возвращать roo-code если установлен Roo Code', async () => {
      const mockVscode = require('./vscode-mock');
      const originalExtensions = [...(mockVscode.extensions?.all || [])];
      
      mockVscode.extensions.all = [
        { id: 'some-other-extension' },
        { id: 'roo-code-extension' }
      ];

      try {
        const result = await detectInstalledExtension();
        expect(result).toBe('roo-code');
      } finally {
        mockVscode.extensions.all = originalExtensions;
      }
    });

    test('должен возвращать null если расширения не установлены', async () => {
      const mockVscode = require('./vscode-mock');
      const originalExtensions = [...(mockVscode.extensions?.all || [])];
      
      mockVscode.extensions.all = [
        { id: 'some-other-extension' }
      ];

      try {
        const result = await detectInstalledExtension();
        expect(result).toBeNull();
      } finally {
        mockVscode.extensions.all = originalExtensions;
      }
    });

    test('должен возвращать null при ошибке', async () => {
      const mockVscode = require('./vscode-mock');
      const originalAll = mockVscode.extensions.all;
      
      // Симулируем ошибку через переопределение getter
      let shouldThrow = true;
      Object.defineProperty(mockVscode.extensions, 'all', {
        get: () => {
          if (shouldThrow) {
            throw new Error('Test error');
          }
          return originalAll;
        },
        configurable: true
      });

      try {
        const result = await detectInstalledExtension();
        expect(result).toBeNull();
      } finally {
        shouldThrow = false;
        delete mockVscode.extensions.all;
        mockVscode.extensions.all = originalAll;
      }
    });

    test('должен приоритизировать roo-cline над roo-code', async () => {
      const mockVscode = require('./vscode-mock');
      const originalExtensions = [...(mockVscode.extensions?.all || [])];
      
      mockVscode.extensions.all = [
        { id: 'roo-code-extension' },
        { id: 'roo-cline-extension' }
      ];

      try {
        const result = await detectInstalledExtension();
        expect(result).toBe('roo-cline');
      } finally {
        mockVscode.extensions.all = originalExtensions;
      }
    });
  });

  describe('registerMcpServer', () => {
    test('должен создавать mcp.json для roo-code формата', async () => {
      const mockContext = {
        extensionPath: mockExtensionPath
      };

      // Создаем мок для mcp-server.js
      const mcpServerPath = path.join(mockExtensionPath, 'out', 'mcp-server.js');
      const outDir = path.dirname(mcpServerPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      if (!fs.existsSync(mcpServerPath)) {
        fs.writeFileSync(mcpServerPath, '// mock server', 'utf8');
      }

      const mockVscode = require('./vscode-mock');
      const originalFolders = mockVscode.workspace.workspaceFolders;
      mockVscode.workspace.workspaceFolders = [{
        uri: { fsPath: testDir },
        name: 'test-workspace'
      }];

      const originalExtensions = [...(mockVscode.extensions?.all || [])];
      mockVscode.extensions.all = [{ id: 'roo-code-extension' }];

      try {
        await registerMcpServer(mockContext);

        expect(fs.existsSync(mcpConfigPath)).toBe(true);
        const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        expect(config.servers).toBeDefined();
        expect(Array.isArray(config.servers)).toBe(true);
        expect(config.servers.length).toBe(1);
        expect(config.servers[0].name).toBe('roo-trace');
        expect(config.servers[0].handler.command).toBe('node');
        expect(config.servers[0].tools).toBeDefined();
        expect(config.servers[0].tools.length).toBeGreaterThan(0);
      } finally {
        mockVscode.workspace.workspaceFolders = originalFolders;
        mockVscode.extensions.all = originalExtensions;
      }
    });

    test('должен создавать mcp.json для roo-cline формата', async () => {
      const mockContext = {
        extensionPath: mockExtensionPath
      };

      const mcpServerPath = path.join(mockExtensionPath, 'out', 'mcp-server.js');
      const outDir = path.dirname(mcpServerPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      if (!fs.existsSync(mcpServerPath)) {
        fs.writeFileSync(mcpServerPath, '// mock server', 'utf8');
      }

      const mockVscode = require('./vscode-mock');
      const originalFolders = mockVscode.workspace.workspaceFolders;
      mockVscode.workspace.workspaceFolders = [{
        uri: { fsPath: testDir },
        name: 'test-workspace'
      }];

      const originalExtensions = [...(mockVscode.extensions?.all || [])];
      mockVscode.extensions.all = [{ id: 'roo-cline-extension' }];

      try {
        await registerMcpServer(mockContext);

        expect(fs.existsSync(mcpConfigPath)).toBe(true);
        const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        expect(config.mcpServers).toBeDefined();
        expect(config.mcpServers['roo-trace']).toBeDefined();
        expect(config.mcpServers['roo-trace'].command).toBe('node');
        expect(config.mcpServers['roo-trace'].alwaysAllow).toBeDefined();
        expect(Array.isArray(config.mcpServers['roo-trace'].alwaysAllow)).toBe(true);
      } finally {
        mockVscode.workspace.workspaceFolders = originalFolders;
        mockVscode.extensions.all = originalExtensions;
      }
    });

    test('должен обновлять существующий mcp.json без дубликатов', async () => {
      const mockContext = {
        extensionPath: mockExtensionPath
      };

      const mcpServerPath = path.join(mockExtensionPath, 'out', 'mcp-server.js');
      const outDir = path.dirname(mcpServerPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      if (!fs.existsSync(mcpServerPath)) {
        fs.writeFileSync(mcpServerPath, '// mock server', 'utf8');
      }

      // Создаем существующий конфиг с roo-trace
      const existingConfig = {
        servers: [
          {
            name: 'roo-trace',
            handler: { command: 'node', args: ['old-path'] }
          },
          {
            name: 'other-server',
            handler: { command: 'node', args: ['other'] }
          }
        ]
      };
      fs.writeFileSync(mcpConfigPath, JSON.stringify(existingConfig, null, 2), 'utf8');

      const mockVscode = require('./vscode-mock');
      const originalFolders = mockVscode.workspace.workspaceFolders;
      mockVscode.workspace.workspaceFolders = [{
        uri: { fsPath: testDir },
        name: 'test-workspace'
      }];

      const originalExtensions = [...(mockVscode.extensions?.all || [])];
      mockVscode.extensions.all = [{ id: 'roo-code-extension' }];

      try {
        await registerMcpServer(mockContext);

        const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        expect(config.servers.length).toBe(2); // other-server + новый roo-trace
        const rooTraceServers = config.servers.filter((s: any) => s.name === 'roo-trace');
        expect(rooTraceServers.length).toBe(1); // Только один roo-trace
        expect(config.servers.find((s: any) => s.name === 'other-server')).toBeDefined();
      } finally {
        mockVscode.workspace.workspaceFolders = originalFolders;
        mockVscode.extensions.all = originalExtensions;
      }
    });

    test('должен выбрасывать ошибку если нет workspace folders', async () => {
      const mockContext = {
        extensionPath: mockExtensionPath
      };

      const mockVscode = require('./vscode-mock');
      const originalFolders = mockVscode.workspace.workspaceFolders;
      mockVscode.workspace.workspaceFolders = [];

      try {
        await expect(registerMcpServer(mockContext)).rejects.toThrow('No workspace folders');
      } finally {
        mockVscode.workspace.workspaceFolders = originalFolders;
      }
    });

    test('должен выбрасывать ошибку если mcp-server.js не найден', async () => {
      const mockContext = {
        extensionPath: path.join(testDir, 'non-existent-extension')
      };

      const mockVscode = require('./vscode-mock');
      const originalFolders = mockVscode.workspace.workspaceFolders;
      mockVscode.workspace.workspaceFolders = [{
        uri: { fsPath: testDir },
        name: 'test-workspace'
      }];

      try {
        await expect(registerMcpServer(mockContext)).rejects.toThrow('MCP server file not found');
      } finally {
        mockVscode.workspace.workspaceFolders = originalFolders;
      }
    });

    test('должен обрабатывать несколько workspace folders', async () => {
      const mockContext = {
        extensionPath: mockExtensionPath
      };

      const mcpServerPath = path.join(mockExtensionPath, 'out', 'mcp-server.js');
      const outDir = path.dirname(mcpServerPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      if (!fs.existsSync(mcpServerPath)) {
        fs.writeFileSync(mcpServerPath, '// mock server', 'utf8');
      }

      const testDir2 = path.join(testDir, 'workspace2');
      fs.mkdirSync(testDir2, { recursive: true });

      const mockVscode = require('./vscode-mock');
      const originalFolders = mockVscode.workspace.workspaceFolders;
      mockVscode.workspace.workspaceFolders = [
        { uri: { fsPath: testDir }, name: 'workspace1' },
        { uri: { fsPath: testDir2 }, name: 'workspace2' }
      ];

      const originalExtensions = [...(mockVscode.extensions?.all || [])];
      mockVscode.extensions.all = [{ id: 'roo-code-extension' }];

      try {
        await registerMcpServer(mockContext);

        const config1 = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        const config2Path = path.join(testDir2, '.roo', 'mcp.json');
        const config2 = JSON.parse(fs.readFileSync(config2Path, 'utf8'));

        expect(config1.servers).toBeDefined();
        expect(config2.servers).toBeDefined();
        expect(config1.servers[0].name).toBe('roo-trace');
        expect(config2.servers[0].name).toBe('roo-trace');
      } finally {
        mockVscode.workspace.workspaceFolders = originalFolders;
        mockVscode.extensions.all = originalExtensions;
        if (fs.existsSync(testDir2)) {
          fs.rmSync(testDir2, { recursive: true, force: true });
        }
      }
    });

    test('должен создавать .roo директорию если её нет', async () => {
      const mockContext = {
        extensionPath: mockExtensionPath
      };

      const mcpServerPath = path.join(mockExtensionPath, 'out', 'mcp-server.js');
      const outDir = path.dirname(mcpServerPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      if (!fs.existsSync(mcpServerPath)) {
        fs.writeFileSync(mcpServerPath, '// mock server', 'utf8');
      }

      // Удаляем .roo директорию
      if (fs.existsSync(rooDir)) {
        fs.rmSync(rooDir, { recursive: true, force: true });
      }

      const mockVscode = require('./vscode-mock');
      const originalFolders = mockVscode.workspace.workspaceFolders;
      mockVscode.workspace.workspaceFolders = [{
        uri: { fsPath: testDir },
        name: 'test-workspace'
      }];

      const originalExtensions = [...(mockVscode.extensions?.all || [])];
      mockVscode.extensions.all = [{ id: 'roo-code-extension' }];

      try {
        await registerMcpServer(mockContext);

        expect(fs.existsSync(rooDir)).toBe(true);
        expect(fs.existsSync(mcpConfigPath)).toBe(true);
      } finally {
        mockVscode.workspace.workspaceFolders = originalFolders;
        mockVscode.extensions.all = originalExtensions;
      }
    });
  });

  describe('unregisterMcpServer', () => {
    test('должен удалять roo-trace из servers массива', async () => {
      const existingConfig = {
        servers: [
          {
            name: 'roo-trace',
            handler: { command: 'node', args: ['path'] }
          },
          {
            name: 'other-server',
            handler: { command: 'node', args: ['other'] }
          }
        ]
      };
      fs.writeFileSync(mcpConfigPath, JSON.stringify(existingConfig, null, 2), 'utf8');

      const mockVscode = require('./vscode-mock');
      const originalFolders = mockVscode.workspace.workspaceFolders;
      mockVscode.workspace.workspaceFolders = [{
        uri: { fsPath: testDir },
        name: 'test-workspace'
      }];

      try {
        await unregisterMcpServer();

        const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        expect(config.servers.length).toBe(1);
        expect(config.servers.find((s: any) => s.name === 'roo-trace')).toBeUndefined();
        expect(config.servers.find((s: any) => s.name === 'other-server')).toBeDefined();
      } finally {
        mockVscode.workspace.workspaceFolders = originalFolders;
      }
    });

    test('должен удалять roo-trace из mcpServers объекта', async () => {
      const existingConfig = {
        mcpServers: {
          'roo-trace': {
            command: 'node',
            args: ['path']
          },
          'other-server': {
            command: 'node',
            args: ['other']
          }
        }
      };
      fs.writeFileSync(mcpConfigPath, JSON.stringify(existingConfig, null, 2), 'utf8');

      const mockVscode = require('./vscode-mock');
      const originalFolders = mockVscode.workspace.workspaceFolders;
      mockVscode.workspace.workspaceFolders = [{
        uri: { fsPath: testDir },
        name: 'test-workspace'
      }];

      try {
        await unregisterMcpServer();

        const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        expect(config.mcpServers['roo-trace']).toBeUndefined();
        expect(config.mcpServers['other-server']).toBeDefined();
      } finally {
        mockVscode.workspace.workspaceFolders = originalFolders;
      }
    });

    test('должен обрабатывать отсутствие workspace folders', async () => {
      const mockVscode = require('./vscode-mock');
      const originalFolders = mockVscode.workspace.workspaceFolders;
      mockVscode.workspace.workspaceFolders = [];

      try {
        await expect(unregisterMcpServer()).resolves.not.toThrow();
      } finally {
        mockVscode.workspace.workspaceFolders = originalFolders;
      }
    });

    test('должен обрабатывать отсутствие mcp.json файла', async () => {
      if (fs.existsSync(mcpConfigPath)) {
        fs.unlinkSync(mcpConfigPath);
      }

      const mockVscode = require('./vscode-mock');
      const originalFolders = mockVscode.workspace.workspaceFolders;
      mockVscode.workspace.workspaceFolders = [{
        uri: { fsPath: testDir },
        name: 'test-workspace'
      }];

      try {
        await expect(unregisterMcpServer()).resolves.not.toThrow();
      } finally {
        mockVscode.workspace.workspaceFolders = originalFolders;
      }
    });

    test('должен обрабатывать поврежденный JSON', async () => {
      fs.writeFileSync(mcpConfigPath, 'invalid json {', 'utf8');

      const mockVscode = require('./vscode-mock');
      const originalFolders = mockVscode.workspace.workspaceFolders;
      mockVscode.workspace.workspaceFolders = [{
        uri: { fsPath: testDir },
        name: 'test-workspace'
      }];

      try {
        await expect(unregisterMcpServer()).resolves.not.toThrow();
      } finally {
        mockVscode.workspace.workspaceFolders = originalFolders;
      }
    });

    test('должен обрабатывать несколько workspace folders', async () => {
      const testDir2 = path.join(testDir, 'workspace2');
      const rooDir2 = path.join(testDir2, '.roo');
      const mcpConfigPath2 = path.join(rooDir2, 'mcp.json');
      fs.mkdirSync(rooDir2, { recursive: true });

      const config1 = {
        servers: [{ name: 'roo-trace' }, { name: 'other' }]
      };
      const config2 = {
        servers: [{ name: 'roo-trace' }, { name: 'other2' }]
      };
      fs.writeFileSync(mcpConfigPath, JSON.stringify(config1, null, 2), 'utf8');
      fs.writeFileSync(mcpConfigPath2, JSON.stringify(config2, null, 2), 'utf8');

      const mockVscode = require('./vscode-mock');
      const originalFolders = mockVscode.workspace.workspaceFolders;
      mockVscode.workspace.workspaceFolders = [
        { uri: { fsPath: testDir }, name: 'workspace1' },
        { uri: { fsPath: testDir2 }, name: 'workspace2' }
      ];

      try {
        await unregisterMcpServer();

        const result1 = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        const result2 = JSON.parse(fs.readFileSync(mcpConfigPath2, 'utf8'));

        expect(result1.servers.find((s: any) => s.name === 'roo-trace')).toBeUndefined();
        expect(result2.servers.find((s: any) => s.name === 'roo-trace')).toBeUndefined();
        expect(result1.servers.find((s: any) => s.name === 'other')).toBeDefined();
        expect(result2.servers.find((s: any) => s.name === 'other2')).toBeDefined();
      } finally {
        mockVscode.workspace.workspaceFolders = originalFolders;
        if (fs.existsSync(testDir2)) {
          fs.rmSync(testDir2, { recursive: true, force: true });
        }
      }
    });
  });

  describe('File Locking', () => {
    test('должен предотвращать race conditions при параллельной записи', async () => {
      const mockContext = {
        extensionPath: mockExtensionPath
      };

      const mcpServerPath = path.join(mockExtensionPath, 'out', 'mcp-server.js');
      const outDir = path.dirname(mcpServerPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      if (!fs.existsSync(mcpServerPath)) {
        fs.writeFileSync(mcpServerPath, '// mock server', 'utf8');
      }

      const mockVscode = require('./vscode-mock');
      const originalFolders = mockVscode.workspace.workspaceFolders;
      mockVscode.workspace.workspaceFolders = [{
        uri: { fsPath: testDir },
        name: 'test-workspace'
      }];

      const originalExtensions = [...(mockVscode.extensions?.all || [])];
      mockVscode.extensions.all = [{ id: 'roo-code-extension' }];

      try {
        // Запускаем несколько регистраций параллельно
        await Promise.all([
          registerMcpServer(mockContext),
          registerMcpServer(mockContext),
          registerMcpServer(mockContext)
        ]);

        const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        const rooTraceServers = config.servers.filter((s: any) => s.name === 'roo-trace');
        // Должен быть только один roo-trace сервер, несмотря на параллельные вызовы
        expect(rooTraceServers.length).toBe(1);
      } finally {
        mockVscode.workspace.workspaceFolders = originalFolders;
        mockVscode.extensions.all = originalExtensions;
      }
    });
  });
});
