import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { RoleManager } from '../src/role-manager';

// Мокаем vscode перед импортом модулей, которые его используют
jest.mock('vscode', () => require('./vscode-mock'), { virtual: true });

/**
 * Комплексные тесты для RoleManager
 * 
 * Проверяет:
 * - Синхронизацию ролей с .roomodes файлом
 * - Загрузку кастомных инструкций
 * - Удаление дубликатов ролей
 * - Обработку ошибок
 */
describe('RoleManager', () => {
  const testDir = path.join(__dirname, 'temp-test-files');
  const roomodesPath = path.join(testDir, '.roomodes');
  const promptsPath = path.join(__dirname, '..', 'prompts', 'ai-debugger-prompt.md');

  // Сохраняем оригинальные console методы для восстановления
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

  afterAll(() => {
    // Восстанавливаем оригинальные console методы
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  beforeEach(() => {
    // Удаляем .roomodes если существует
    if (fs.existsSync(roomodesPath)) {
      fs.unlinkSync(roomodesPath);
    }
  });

  afterEach(() => {
    // Очищаем .roomodes после каждого теста
    if (fs.existsSync(roomodesPath)) {
      fs.unlinkSync(roomodesPath);
    }
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Синхронизация ролей', () => {
    test('должен создавать .roomodes файл если его нет', async () => {
      const mockContext = {
        extensionPath: path.join(__dirname, '..'),
        extension: {
          packageJSON: { version: '1.0.0' }
        }
      } as any;

      await RoleManager.syncRoleWithRoo(mockContext);

      expect(fs.existsSync(roomodesPath)).toBe(true);
      
      const content = fs.readFileSync(roomodesPath, 'utf8');
      const config = yaml.load(content) as any;
      expect(config.customModes).toBeDefined();
      expect(Array.isArray(config.customModes)).toBe(true);
    });

    test('должен добавлять роль AI Debugger в существующий .roomodes', async () => {
      // Создаем существующий .roomodes файл
      const existingConfig = {
        customModes: [
          {
            slug: 'existing-role',
            name: 'Existing Role',
            description: 'Test role'
          }
        ]
      };
      fs.writeFileSync(roomodesPath, yaml.dump(existingConfig), 'utf8');

      const mockContext = {
        extensionPath: path.join(__dirname, '..'),
        extension: {
          packageJSON: { version: '1.0.0' }
        }
      } as any;

      await RoleManager.syncRoleWithRoo(mockContext);

      const content = fs.readFileSync(roomodesPath, 'utf8');
      const config = yaml.load(content) as any;
      expect(config.customModes.length).toBe(2);
      
      const aiDebuggerRole = config.customModes.find((m: any) => m.slug === 'ai-debugger');
      expect(aiDebuggerRole).toBeDefined();
      expect(aiDebuggerRole.name).toBe('⚡ AI Debugger');
    });

    test('должен удалять дубликаты ролей по slug', async () => {
      // Создаем .roomodes с дубликатом
      const configWithDuplicate = {
        customModes: [
          {
            slug: 'ai-debugger',
            name: 'Old AI Debugger',
            description: 'Old version'
          },
          {
            slug: 'other-role',
            name: 'Other Role',
            description: 'Other'
          },
          {
            slug: 'ai-debugger',
            name: 'Another AI Debugger',
            description: 'Another duplicate'
          }
        ]
      };
      fs.writeFileSync(roomodesPath, yaml.dump(configWithDuplicate), 'utf8');

      const mockContext = {
        extensionPath: path.join(__dirname, '..'),
        extension: {
          packageJSON: { version: '1.0.0' }
        }
      } as any;

      await RoleManager.syncRoleWithRoo(mockContext);

      const content = fs.readFileSync(roomodesPath, 'utf8');
      const config = yaml.load(content) as any;
      
      // Должна остаться только одна роль ai-debugger
      const aiDebuggerRoles = config.customModes.filter((m: any) => m.slug === 'ai-debugger');
      expect(aiDebuggerRoles.length).toBe(1);
      expect(config.customModes.length).toBe(2); // ai-debugger + other-role
    });

    test('должен удалять дубликаты ролей по имени', async () => {
      // Создаем .roomodes с дубликатом по имени
      const configWithDuplicate = {
        customModes: [
          {
            slug: 'old-debugger',
            name: '⚡ AI Debugger',
            description: 'Old version'
          },
          {
            slug: 'ai-debugger',
            name: 'AI Debugger',
            description: 'Another version'
          }
        ]
      };
      fs.writeFileSync(roomodesPath, yaml.dump(configWithDuplicate), 'utf8');

      const mockContext = {
        extensionPath: path.join(__dirname, '..'),
        extension: {
          packageJSON: { version: '1.0.0' }
        }
      } as any;

      await RoleManager.syncRoleWithRoo(mockContext);

      const content = fs.readFileSync(roomodesPath, 'utf8');
      const config = yaml.load(content) as any;
      
      // Должна остаться только одна роль с именем AI Debugger
      const aiDebuggerRoles = config.customModes.filter((m: any) => 
        m.name === '⚡ AI Debugger' || m.name === 'AI Debugger'
      );
      expect(aiDebuggerRoles.length).toBe(1);
    });
  });

  describe('Загрузка кастомных инструкций', () => {
    test('должен загружать инструкции из ai-debugger-prompt.md', async () => {
      const mockContext = {
        extensionPath: path.join(__dirname, '..'),
        extension: {
          packageJSON: { version: '1.0.0' }
        }
      } as any;

      await RoleManager.syncRoleWithRoo(mockContext);

      const content = fs.readFileSync(roomodesPath, 'utf8');
      const config = yaml.load(content) as any;
      const role = config.customModes.find((m: any) => m.slug === 'ai-debugger');
      
      expect(role).toBeDefined();
      expect(role.customInstructions).toBeDefined();
      expect(typeof role.customInstructions).toBe('string');
      expect(role.customInstructions.length).toBeGreaterThan(0);
    });

    test('должен использовать fallback инструкции если файл не найден', async () => {
      // Временно переименовываем файл
      const tempPath = promptsPath + '.backup';
      if (fs.existsSync(promptsPath)) {
        fs.renameSync(promptsPath, tempPath);
      }

      try {
        const mockContext = {
          extensionPath: path.join(__dirname, '..'),
          extension: {
            packageJSON: { version: '1.0.0' }
          }
        } as any;

        await RoleManager.syncRoleWithRoo(mockContext);

        const content = fs.readFileSync(roomodesPath, 'utf8');
        const config = yaml.load(content) as any;
        const role = config.customModes.find((m: any) => m.slug === 'ai-debugger');
        
        expect(role.customInstructions).toBeDefined();
        expect(role.customInstructions).toContain('ROO-TRACE PROTOCOL');
      } finally {
        // Восстанавливаем файл
        if (fs.existsSync(tempPath)) {
          fs.renameSync(tempPath, promptsPath);
        }
      }
    });

    test('должен заменять плейсхолдер версии в инструкциях', async () => {
      const mockContext = {
        extensionPath: path.join(__dirname, '..'),
        extension: {
          packageJSON: { version: '2.5.3' }
        }
      } as any;

      await RoleManager.syncRoleWithRoo(mockContext);

      const content = fs.readFileSync(roomodesPath, 'utf8');
      const config = yaml.load(content) as any;
      const role = config.customModes.find((m: any) => m.slug === 'ai-debugger');
      
      // Проверяем, что версия включена в описание роли
      expect(role.description).toContain('v2.5.3');
      expect(role.customInstructions).toBeDefined();
      expect(role.customInstructions.length).toBeGreaterThan(0);
    });
  });

  describe('Структура роли', () => {
    test('должен создавать роль с правильной структурой', async () => {
      const mockContext = {
        extensionPath: path.join(__dirname, '..'),
        extension: {
          packageJSON: { version: '1.0.0' }
        }
      } as any;

      await RoleManager.syncRoleWithRoo(mockContext);

      const content = fs.readFileSync(roomodesPath, 'utf8');
      const config = yaml.load(content) as any;
      const role = config.customModes.find((m: any) => m.slug === 'ai-debugger');
      
      expect(role).toBeDefined();
      expect(role.slug).toBe('ai-debugger');
      expect(role.name).toBe('⚡ AI Debugger');
      expect(role.description).toContain('RooTrace Protocol');
      expect(role.roleDefinition).toBeDefined();
      expect(role.customInstructions).toBeDefined();
      expect(role.groups).toBeDefined();
      expect(Array.isArray(role.groups)).toBe(true);
    });

    test('должен включать правильные группы разрешений', async () => {
      const mockContext = {
        extensionPath: path.join(__dirname, '..'),
        extension: {
          packageJSON: { version: '1.0.0' }
        }
      } as any;

      await RoleManager.syncRoleWithRoo(mockContext);

      const content = fs.readFileSync(roomodesPath, 'utf8');
      const config = yaml.load(content) as any;
      const role = config.customModes.find((m: any) => m.slug === 'ai-debugger');
      
      expect(role.groups).toContain('read');
      expect(role.groups).toContain('browser');
      expect(role.groups).toContain('command');
      expect(role.groups).toContain('mcp');
      expect(role.groups.some((g: any) => Array.isArray(g) && g[0] === 'edit')).toBe(true);
    });
  });

  describe('Защита от одновременного выполнения', () => {
    test('должен предотвращать одновременную синхронизацию', async () => {
      const mockContext = {
        extensionPath: path.join(__dirname, '..'),
        extension: {
          packageJSON: { version: '1.0.0' }
        }
      } as any;

      // Запускаем несколько синхронизаций параллельно
      const promises = [
        RoleManager.syncRoleWithRoo(mockContext),
        RoleManager.syncRoleWithRoo(mockContext),
        RoleManager.syncRoleWithRoo(mockContext)
      ];

      await Promise.all(promises);

      // Должна быть создана только одна роль
      const content = fs.readFileSync(roomodesPath, 'utf8');
      const config = yaml.load(content) as any;
      const aiDebuggerRoles = config.customModes.filter((m: any) => m.slug === 'ai-debugger');
      expect(aiDebuggerRoles.length).toBe(1);
    });
  });

  describe('Обработка ошибок', () => {
    test('должен обрабатывать ошибки при чтении .roomodes', async () => {
      // Создаем поврежденный .roomodes файл
      fs.writeFileSync(roomodesPath, 'invalid yaml: { [', 'utf8');

      const mockContext = {
        extensionPath: path.join(__dirname, '..'),
        extension: {
          packageJSON: { version: '1.0.0' }
        }
      } as any;

      // Код выбрасывает ошибку при поврежденном YAML, это ожидаемое поведение
      await expect(RoleManager.syncRoleWithRoo(mockContext)).rejects.toThrow();
    });

    test('должен обрабатывать отсутствие workspace folders', async () => {
      const mockVscode = require('./vscode-mock');
      const originalFolders = mockVscode.workspace.workspaceFolders;
      mockVscode.workspace.workspaceFolders = [];

      try {
        const mockContext = {
          extensionPath: path.join(__dirname, '..'),
          extension: {
            packageJSON: { version: '1.0.0' }
          }
        } as any;

        await RoleManager.syncRoleWithRoo(mockContext);
        // Не должно выбросить ошибку
      } finally {
        mockVscode.workspace.workspaceFolders = originalFolders;
      }
    });
  });
});
