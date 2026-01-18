import * as fs from 'fs';
import * as path from 'path';
import {
  injectProbe,
  removeProbe,
  removeAllProbesFromFile,
  getAllProbes,
  generateProbeCode
} from '../src/code-injector';

/**
 * Комплексные unit-тесты для code-injector.ts
 * 
 * Покрывает:
 * - Вставку в файлы разных типов (JS, TS, JSX, TSX, Python)
 * - Краевые случаи (пустой файл, одна строка)
 * - Разные переносы строк (LF vs CRLF)
 * - Многократные инъекции
 * - Очистку с проверкой байт-в-байт
 */
describe('CodeInjector', () => {
  const testDir = path.join(__dirname, 'temp-test-files');
  
  beforeAll(() => {
    // Создаем временную директорию для тестов
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Удаляем временную директорию после всех тестов
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Очищаем реестр проб после каждого теста
    // Это важно для изоляции тестов
    const probes = getAllProbes();
    for (const probe of probes) {
      // Удаляем файлы, если они существуют
      if (fs.existsSync(probe.filePath)) {
        fs.unlinkSync(probe.filePath);
      }
    }
    // Очищаем глобальный реестр проб - используем хелпер для тестов
    const { clearProbeRegistryForTesting } = require('../src/code-injector');
    clearProbeRegistryForTesting();
  });

  describe('Инъекция в JavaScript файлы', () => {
    test('должен вставлять log пробу корректно', async () => {
      const testFilePath = path.join(testDir, 'test.js');
      const originalContent = 'function hello() {\n  console.log("world");\n}';
      fs.writeFileSync(testFilePath, originalContent);

      const result = await injectProbe(testFilePath, 2, 'log', 'MCP Test Probe');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully injected');
      expect(result.insertedCode).toContain('[RooTrace]: MCP Test Probe');

      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toContain('[RooTrace]: MCP Test Probe');
      expect(content).toContain('console.log');
    });

    test('должен вставлять trace пробу корректно', async () => {
      const testFilePath = path.join(testDir, 'test-trace.js');
      const originalContent = 'function hello() {\n  return true;\n}';
      fs.writeFileSync(testFilePath, originalContent);

      const result = await injectProbe(testFilePath, 2, 'trace', 'Trace point');

      expect(result.success).toBe(true);
      expect(result.insertedCode).toContain('[RooTrace TRACE]: Trace point');

      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toContain('[RooTrace TRACE]');
    });

    test('должен вставлять error пробу корректно', async () => {
      const testFilePath = path.join(testDir, 'test-error.js');
      const originalContent = 'function hello() {\n  return true;\n}';
      fs.writeFileSync(testFilePath, originalContent);

      const result = await injectProbe(testFilePath, 2, 'error', 'Error point');

      expect(result.success).toBe(true);
      expect(result.insertedCode).toContain('[RooTrace ERROR]: Error point');

      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toContain('[RooTrace ERROR]');
    });
  });

  describe('Инъекция в TypeScript файлы', () => {
    test('должен работать с TS файлами с типами', async () => {
      const testFilePath = path.join(testDir, 'test.ts');
      const originalContent = `interface User {
  name: string;
  age: number;
}

function greet(user: User): string {
  return \`Hello, \${user.name}\`;
}`;
      fs.writeFileSync(testFilePath, originalContent);

      const result = await injectProbe(testFilePath, 6, 'log', 'TypeScript probe');

      expect(result.success).toBe(true);
      expect(result.insertedCode).toContain('[RooTrace]: TypeScript probe');

      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toContain('[RooTrace]: TypeScript probe');
      // Проверяем, что типы не сломались
      expect(content).toContain('interface User');
      expect(content).toContain(': string');
    });

    test('должен работать с классами TS', async () => {
      const testFilePath = path.join(testDir, 'class.ts');
      const originalContent = `class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}`;
      fs.writeFileSync(testFilePath, originalContent);

      const result = await injectProbe(testFilePath, 3, 'log', 'Class probe');

      expect(result.success).toBe(true);
      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toContain('[RooTrace]: Class probe');
      expect(content).toContain('class Calculator');
    });
  });

  describe('Инъекция в React файлы (JSX/TSX)', () => {
    test('должен работать с JSX компонентами', async () => {
      const testFilePath = path.join(testDir, 'Component.jsx');
      const originalContent = `function Component({ name }) {
  return <div>Hello {name}</div>;
}`;
      fs.writeFileSync(testFilePath, originalContent);

      const result = await injectProbe(testFilePath, 2, 'log', 'JSX probe');

      expect(result.success).toBe(true);
      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toContain('[RooTrace]: JSX probe');
      // Проверяем, что JSX разметка не сломалась
      expect(content).toContain('<div>Hello {name}</div>');
    });

    test('должен работать с TSX компонентами', async () => {
      const testFilePath = path.join(testDir, 'Component.tsx');
      const originalContent = `interface Props {
  name: string;
}

function Component({ name }: Props) {
  return <div>Hello {name}</div>;
}`;
      fs.writeFileSync(testFilePath, originalContent);

      const result = await injectProbe(testFilePath, 4, 'log', 'TSX probe');

      expect(result.success).toBe(true);
      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toContain('[RooTrace]: TSX probe');
      expect(content).toContain('interface Props');
      expect(content).toContain('<div>Hello {name}</div>');
    });
  });

  describe('Краевые случаи', () => {
    test('должен работать с файлом из одной строки', async () => {
      const testFilePath = path.join(testDir, 'single.js');
      const originalContent = 'const x = 42;';
      fs.writeFileSync(testFilePath, originalContent);

      const result = await injectProbe(testFilePath, 1, 'log', 'Single line probe');

      expect(result.success).toBe(true);
      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toContain('[RooTrace]: Single line probe');
      expect(content).toContain('const x = 42;');
    });

    test('должен работать с пустым файлом', async () => {
      const testFilePath = path.join(testDir, 'empty.js');
      const originalContent = '';
      fs.writeFileSync(testFilePath, originalContent);

      const result = await injectProbe(testFilePath, 1, 'log', 'Empty file probe');

      // Пустой файл создает массив [''], т.е. 1 строка, поэтому инъекция должна пройти
      expect(result.success).toBe(true);
      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toContain('[RooTrace]: Empty file probe');
    });

    test('должен возвращать ошибку при неверном lineNumber', async () => {
      const testFilePath = path.join(testDir, 'invalid.js');
      const originalContent = 'line1\nline2\nline3';
      fs.writeFileSync(testFilePath, originalContent);

      // Номер строки больше количества строк
      const result = await injectProbe(testFilePath, 100, 'log', 'Invalid probe');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Line number 100 is out of range');
    });

    test('должен возвращать ошибку при несуществующем файле', async () => {
      const testFilePath = path.join(testDir, 'nonexistent.js');

      const result = await injectProbe(testFilePath, 1, 'log', 'Test probe');

      expect(result.success).toBe(false);
      expect(result.message).toContain('File does not exist');
    });

    test('должен возвращать ошибку при отсутствующих параметрах', async () => {
        const testFilePath = path.join(testDir, 'test.js');
        fs.writeFileSync(testFilePath, 'const x = 42;');
  
        const result = await injectProbe('', 0, 'log', '');
  
        expect(result.success).toBe(false);
        expect(result.message).toContain('Missing required parameters');
      });
  });

  describe('Разные переносы строк (LF vs CRLF)', () => {
    test('должен работать с LF переносами (Unix/Linux/macOS)', async () => {
      const testFilePath = path.join(testDir, 'lf.js');
      const originalContent = 'line1\nline2\nline3';
      fs.writeFileSync(testFilePath, originalContent);

      const result = await injectProbe(testFilePath, 2, 'log', 'LF probe');

      expect(result.success).toBe(true);
      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toContain('[RooTrace]: LF probe');
      // Проверяем, что переносы строк не изменились
      expect(content.split('\n')).toHaveLength(4); // 3 оригинальных + 1 проба
    });

    test('должен работать с CRLF переносами (Windows)', async () => {
      const testFilePath = path.join(testDir, 'crlf.js');
      const originalContent = 'line1\r\nline2\r\nline3';
      fs.writeFileSync(testFilePath, originalContent);

      const result = await injectProbe(testFilePath, 2, 'log', 'CRLF probe');

      expect(result.success).toBe(true);
      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toContain('[RooTrace]: CRLF probe');
    });
  });

  describe('Многократные инъекции', () => {
    test('должен поддерживать несколько проб в одном файле', async () => {
      const testFilePath = path.join(testDir, 'multiple.js');
      const originalContent = 'function hello() {\n  console.log("world");\n  return true;\n}';
      fs.writeFileSync(testFilePath, originalContent);

      const result1 = await injectProbe(testFilePath, 2, 'log', 'Probe 1');
      const result2 = await injectProbe(testFilePath, 3, 'trace', 'Probe 2');
      const result3 = await injectProbe(testFilePath, 4, 'error', 'Probe 3');

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);

      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toContain('[RooTrace]: Probe 1');
      expect(content).toContain('[RooTrace TRACE]: Probe 2');
      expect(content).toContain('[RooTrace ERROR]: Probe 3');

      // Проверяем, что все пробы зарегистрированы
      const probes = getAllProbes();
      expect(probes.length).toBe(3);
    });

    test('должен генерировать уникальные ID для каждой пробы', async () => {
      const testFilePath = path.join(testDir, 'unique-ids.js');
      const originalContent = 'line1\nline2\nline3';
      fs.writeFileSync(testFilePath, originalContent);

      await injectProbe(testFilePath, 1, 'log', 'Probe 1');
      await injectProbe(testFilePath, 2, 'log', 'Probe 2');
      await injectProbe(testFilePath, 3, 'log', 'Probe 3');

      const probes = getAllProbes();
      const ids = probes.map(p => p.id);
      
      // Проверяем, что все ID уникальны
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });
  });

  describe('Очистка проб (Cleanup)', () => {
    test('должен удалять пробу по ID', async () => {
      const testFilePath = path.join(testDir, 'cleanup.js');
      const originalContent = 'function hello() {\n  console.log("world");\n}';
      fs.writeFileSync(testFilePath, originalContent);

      const injectResult = await injectProbe(testFilePath, 2, 'log', 'To be removed');
      expect(injectResult.success).toBe(true);

      // Получаем ID пробы
      const probes = getAllProbes();
      const probeId = probes[0].id;

      const removeResult = await removeProbe(testFilePath, probeId);
      expect(removeResult.success).toBe(true);

      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).not.toContain('[RooTrace]: To be removed');
      expect(content).toBe(originalContent);
    });

    test('должен возвращать ошибку при удалении несуществующей пробы', async () => {
      const testFilePath = path.join(testDir, 'cleanup-error.js');
      const originalContent = 'function hello() {\n  console.log("world");\n}';
      fs.writeFileSync(testFilePath, originalContent);

      const result = await removeProbe(testFilePath, 'nonexistent-id');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    test('должен удалять все пробы из файла', async () => {
      const testFilePath = path.join(testDir, 'cleanup-all.js');
      const originalContent = 'function hello() {\n  console.log("world");\n  return true;\n}';
      fs.writeFileSync(testFilePath, originalContent);

      // Вставляем несколько проб
      await injectProbe(testFilePath, 2, 'log', 'Probe 1');
      await injectProbe(testFilePath, 3, 'trace', 'Probe 2');
      await injectProbe(testFilePath, 4, 'error', 'Probe 3');

      const removeAllResult = await removeAllProbesFromFile(testFilePath);
      expect(removeAllResult.success).toBe(true);
      expect(removeAllResult.message).toContain('Successfully removed 3 probes');

      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).not.toContain('[RooTrace]');
      expect(content).toBe(originalContent);
    });

    test('должен возвращать файл к исходному состоянию байт-в-байт', async () => {
      const testFilePath = path.join(testDir, 'byte-perfect.js');
      const originalContent = 'function hello() {\n  console.log("world");\n  return true;\n}';
      fs.writeFileSync(testFilePath, originalContent);

      // Сохраняем оригинальный контент
      const originalBytes = fs.readFileSync(testFilePath);

      // Вставляем и удаляем пробы
      await injectProbe(testFilePath, 2, 'log', 'Probe 1');
      await injectProbe(testFilePath, 3, 'trace', 'Probe 2');
      await removeAllProbesFromFile(testFilePath);

      // Проверяем, что файл вернулся к исходному состоянию
      const finalBytes = fs.readFileSync(testFilePath);
      expect(finalBytes).toEqual(originalBytes);
    });

    test('должен работать при удалении всех проб из файла без проб', async () => {
      const testFilePath = path.join(testDir, 'no-probes.js');
      const originalContent = 'function hello() {\n  console.log("world");\n}';
      fs.writeFileSync(testFilePath, originalContent);

      const result = await removeAllProbesFromFile(testFilePath);

      expect(result.success).toBe(true);
      expect(result.message).toContain('No probes found');
    });
  });

  describe('Разные языки программирования', () => {
    test('должен генерировать код пробы для Python', () => {
      const code = generateProbeCode('python', 'log', 'Python probe');
      expect(code).toContain('print');
      expect(code).toContain('Python probe');
    });

    test('должен генерировать код пробы для Java', () => {
      const code = generateProbeCode('java', 'log', 'Java probe');
      expect(code).toContain('System.out.println');
      expect(code).toContain('Java probe');
    });

    test('должен генерировать код пробы для C#', () => {
      const code = generateProbeCode('csharp', 'log', 'C# probe');
      expect(code).toContain('Console.WriteLine');
      expect(code).toContain('C# probe');
    });

    test('должен генерировать код пробы для C++', () => {
      const code = generateProbeCode('cpp', 'log', 'C++ probe');
      expect(code).toContain('std::cout');
      expect(code).toContain('C++ probe');
    });

    test('должен генерировать код пробы для Go', () => {
      const code = generateProbeCode('go', 'log', 'Go probe');
      expect(code).toContain('fmt.Println');
      expect(code).toContain('Go probe');
    });

    test('должен использовать fallback для неизвестных языков', () => {
      const code = generateProbeCode('unknown', 'log', 'Unknown probe');
      expect(code).toContain('console.log');
      expect(code).toContain('[RooTrace]: Unknown probe');
    });

    test('должен работать с .py файлами', async () => {
      const testFilePath = path.join(testDir, 'test.py');
      const originalContent = 'def hello():\n    print("world")';
      fs.writeFileSync(testFilePath, originalContent);

      const result = await injectProbe(testFilePath, 2, 'log', 'Python probe');

      expect(result.success).toBe(true);
      const content = fs.readFileSync(testFilePath, 'utf8');
      expect(content).toContain('Python probe');
      // Проверяем, что строка была вставлена перед второй строкой
      const lines = content.split('\n');
      expect(lines[1]).toContain('Python probe'); // Вторая строка теперь проба
      expect(lines[2]).toContain('print("world")'); // Третья строка теперь оригинал второй
    });
  });

  describe('Интеграция с реестром проб', () => {
    test('должен регистрировать пробы в реестре', async () => {
      const testFilePath = path.join(testDir, 'registry.js');
      const originalContent = 'line1\nline2\nline3';
      fs.writeFileSync(testFilePath, originalContent);

      await injectProbe(testFilePath, 2, 'log', 'Registry probe');

      const probes = getAllProbes();
      expect(probes.length).toBe(1);
      expect(probes[0].filePath).toBe(testFilePath);
      expect(probes[0].lineNumber).toBe(2);
      expect(probes[0].probeType).toBe('log');
      expect(probes[0].message).toBe('Registry probe');
    });

    test('должен очищать реестр после удаления всех проб', async () => {
      const testFilePath = path.join(testDir, 'registry-cleanup.js');
      const originalContent = 'line1\nline2';
      fs.writeFileSync(testFilePath, originalContent);

      await injectProbe(testFilePath, 1, 'log', 'Probe 1');
      await injectProbe(testFilePath, 2, 'log', 'Probe 2');

      expect(getAllProbes().length).toBe(2);

      await removeAllProbesFromFile(testFilePath);

      expect(getAllProbes().length).toBe(0);
    });
  });
});
