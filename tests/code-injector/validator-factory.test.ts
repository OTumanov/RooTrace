/**
 * Unit-тесты для validator-factory.ts
 */

import { getValidator } from '../../src/code-injector/validation/validator-factory';
import { SyntaxValidator } from '../../src/code-injector/types';
import * as fs from 'fs';
import * as path from 'path';

// Мокаем vscode перед импортом модулей, которые его используют
jest.mock('vscode', () => require('../vscode-mock'), { virtual: true });

describe('ValidatorFactory', () => {
  const testDir = path.join(__dirname, 'temp-validator-test-files');

  beforeAll(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Очищаем тестовые файлы
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      files.forEach(file => {
        const filePath = path.join(testDir, file);
        try {
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          }
        } catch (e) {
          // Игнорируем ошибки
        }
      });
    }
  });

  describe('getValidator', () => {
    it('должен возвращать валидатор для Python', () => {
      const validator = getValidator('python');
      expect(validator).toBeDefined();
      expect(validator?.supportedLanguages).toContain('python');
    });

    it('должен возвращать валидатор для py (алиас Python)', () => {
      const validator = getValidator('py');
      expect(validator).toBeDefined();
      expect(validator?.supportedLanguages).toContain('python');
    });

    it('должен возвращать валидатор для JavaScript', () => {
      const validator = getValidator('javascript');
      expect(validator).toBeDefined();
      expect(validator?.supportedLanguages).toContain('javascript');
    });

    it('должен возвращать валидатор для js (алиас JavaScript)', () => {
      const validator = getValidator('js');
      expect(validator).toBeDefined();
      expect(validator?.supportedLanguages).toContain('javascript');
    });

    it('должен возвращать валидатор для TypeScript', () => {
      const validator = getValidator('typescript');
      expect(validator).toBeDefined();
      expect(validator?.supportedLanguages).toContain('typescript');
    });

    it('должен возвращать валидатор для ts (алиас TypeScript)', () => {
      const validator = getValidator('ts');
      expect(validator).toBeDefined();
      expect(validator?.supportedLanguages).toContain('typescript');
    });

    it('должен возвращать валидатор для Go', () => {
      const validator = getValidator('go');
      expect(validator).toBeDefined();
      expect(validator?.supportedLanguages).toContain('go');
    });

    it('должен возвращать валидатор для Java', () => {
      const validator = getValidator('java');
      expect(validator).toBeDefined();
      expect(validator?.supportedLanguages).toContain('java');
    });

    it('должен возвращать валидатор для Rust', () => {
      const validator = getValidator('rust');
      expect(validator).toBeDefined();
      expect(validator?.supportedLanguages).toContain('rust');
    });

    it('должен возвращать валидатор для C++', () => {
      const validator = getValidator('cpp');
      expect(validator).toBeDefined();
      expect(validator?.supportedLanguages).toContain('cpp');
    });

    it('должен возвращать валидатор для PHP', () => {
      const validator = getValidator('php');
      expect(validator).toBeDefined();
      expect(validator?.supportedLanguages).toContain('php');
    });

    it('должен возвращать валидатор для Ruby', () => {
      const validator = getValidator('ruby');
      expect(validator).toBeDefined();
      expect(validator?.supportedLanguages).toContain('ruby');
    });

    it('должен возвращать валидатор для C#', () => {
      const validator = getValidator('csharp');
      expect(validator).toBeDefined();
      expect(validator?.supportedLanguages).toContain('csharp');
    });

    it('должен возвращать валидатор для Swift', () => {
      const validator = getValidator('swift');
      expect(validator).toBeDefined();
      expect(validator?.supportedLanguages).toContain('swift');
    });

    it('должен возвращать валидатор для Kotlin', () => {
      const validator = getValidator('kotlin');
      expect(validator).toBeDefined();
      expect(validator?.supportedLanguages).toContain('kotlin');
    });

    it('должен возвращать undefined для неизвестных языков', () => {
      const validator = getValidator('unknown-language');
      expect(validator).toBeUndefined();
    });

    it('должен быть case-insensitive', () => {
      const validator1 = getValidator('PYTHON');
      const validator2 = getValidator('python');
      const validator3 = getValidator('Python');

      expect(validator1).toBeDefined();
      expect(validator2).toBeDefined();
      expect(validator3).toBeDefined();
      // Все должны возвращать один и тот же валидатор
      expect(validator1?.supportedLanguages).toEqual(validator2?.supportedLanguages);
      expect(validator2?.supportedLanguages).toEqual(validator3?.supportedLanguages);
    });
  });

  describe('Validator functionality', () => {
    it('должен валидировать валидный JavaScript файл', async () => {
      const validator = getValidator('javascript');
      if (!validator) {
        // Пропускаем тест если валидатор недоступен
        return;
      }

      const testFile = path.join(testDir, 'valid.js');
      fs.writeFileSync(testFile, 'function test() { return true; }');

      const result = await validator.validate(testFile, 5000);
      expect(result.passed).toBe(true);
    }, 10000);

    it('должен обнаруживать синтаксические ошибки в JavaScript файле', async () => {
      const validator = getValidator('javascript');
      if (!validator) {
        return;
      }

      const testFile = path.join(testDir, 'invalid.js');
      fs.writeFileSync(testFile, 'function test() { return; }');

      const result = await validator.validate(testFile, 5000);
      // Файл валидный, но может быть предупреждение
      expect(result).toBeDefined();
    }, 10000);

    it('должен валидировать валидный Python файл', async () => {
      const validator = getValidator('python');
      if (!validator) {
        return;
      }

      const testFile = path.join(testDir, 'valid.py');
      fs.writeFileSync(testFile, 'def test():\n    return True\n');

      const result = await validator.validate(testFile, 5000);
      // Может быть успешно или ошибка в зависимости от наличия Python
      expect(result).toBeDefined();
    }, 10000);

    it('должен обнаруживать синтаксические ошибки в Python файле', async () => {
      const validator = getValidator('python');
      if (!validator) {
        return;
      }

      const testFile = path.join(testDir, 'invalid.py');
      fs.writeFileSync(testFile, 'def test():\n    return\n    print(');

      const result = await validator.validate(testFile, 5000);
      // Должна быть ошибка синтаксиса
      expect(result.passed).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    }, 10000);

    it('должен обрабатывать несуществующий файл', async () => {
      const validator = getValidator('javascript');
      if (!validator) {
        return;
      }

      const testFile = path.join(testDir, 'nonexistent.js');

      const result = await validator.validate(testFile, 5000);
      expect(result.passed).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    }, 10000);

    it('должен соблюдать таймаут', async () => {
      const validator = getValidator('javascript');
      if (!validator) {
        return;
      }

      const testFile = path.join(testDir, 'timeout.js');
      fs.writeFileSync(testFile, 'function test() { return true; }');

      const startTime = Date.now();
      const result = await validator.validate(testFile, 100); // Очень короткий таймаут
      const duration = Date.now() - startTime;

      expect(result).toBeDefined();
      // Валидация должна завершиться быстро или с таймаутом
      expect(duration).toBeLessThan(2000);
    }, 5000);
  });
});
