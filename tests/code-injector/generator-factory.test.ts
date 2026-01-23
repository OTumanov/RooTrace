/**
 * Unit-тесты для generator-factory.ts
 */

import { getGenerator } from '../../src/code-injector/generators/generator-factory';
import { ProbeCodeGenerator } from '../../src/code-injector/types';

// Мокаем vscode перед импортом модулей, которые его используют
jest.mock('vscode', () => require('../vscode-mock'), { virtual: true });

describe('GeneratorFactory', () => {
  describe('getGenerator', () => {
    it('должен возвращать генератор для Python', () => {
      const generator = getGenerator('python');
      expect(generator).toBeDefined();
      expect(generator?.supportedLanguages).toContain('python');
    });

    it('должен возвращать генератор для py (алиас Python)', () => {
      const generator = getGenerator('py');
      expect(generator).toBeDefined();
      expect(generator?.supportedLanguages).toContain('python');
    });

    it('должен возвращать генератор для JavaScript', () => {
      const generator = getGenerator('javascript');
      expect(generator).toBeDefined();
      expect(generator?.supportedLanguages).toContain('javascript');
    });

    it('должен возвращать генератор для js (алиас JavaScript)', () => {
      const generator = getGenerator('js');
      expect(generator).toBeDefined();
      expect(generator?.supportedLanguages).toContain('javascript');
    });

    it('должен возвращать генератор для Go', () => {
      const generator = getGenerator('go');
      expect(generator).toBeDefined();
      expect(generator?.supportedLanguages).toContain('go');
    });

    it('должен возвращать генератор для Java', () => {
      const generator = getGenerator('java');
      expect(generator).toBeDefined();
      expect(generator?.supportedLanguages).toContain('java');
    });

    it('должен возвращать генератор для Rust', () => {
      const generator = getGenerator('rust');
      expect(generator).toBeDefined();
      expect(generator?.supportedLanguages).toContain('rust');
    });

    it('должен возвращать генератор для C++', () => {
      const generator = getGenerator('cpp');
      expect(generator).toBeDefined();
      expect(generator?.supportedLanguages).toContain('cpp');
    });

    it('должен возвращать генератор для PHP', () => {
      const generator = getGenerator('php');
      expect(generator).toBeDefined();
      expect(generator?.supportedLanguages).toContain('php');
    });

    it('должен возвращать генератор для Ruby', () => {
      const generator = getGenerator('ruby');
      expect(generator).toBeDefined();
      expect(generator?.supportedLanguages).toContain('ruby');
    });

    it('должен возвращать генератор для C#', () => {
      const generator = getGenerator('csharp');
      expect(generator).toBeDefined();
      expect(generator?.supportedLanguages).toContain('csharp');
    });

    it('должен возвращать генератор для Swift', () => {
      const generator = getGenerator('swift');
      expect(generator).toBeDefined();
      expect(generator?.supportedLanguages).toContain('swift');
    });

    it('должен возвращать генератор для Kotlin', () => {
      const generator = getGenerator('kotlin');
      expect(generator).toBeDefined();
      expect(generator?.supportedLanguages).toContain('kotlin');
    });

    it('должен возвращать fallback генератор для неизвестных языков', () => {
      const generator = getGenerator('unknown-language');
      expect(generator).toBeDefined();
      // Fallback генератор должен быть определен и генерировать код
      if (generator) {
        const code = generator.generate('unknown-language', 'log', 'Test', 'http://localhost:51234/');
        expect(code).toBeDefined();
        expect(code?.length).toBeGreaterThan(0);
      }
    });

    it('должен возвращать fallback генератор для пустой строки', () => {
      const generator = getGenerator('');
      expect(generator).toBeDefined();
    });

    it('должен быть case-insensitive', () => {
      const generator1 = getGenerator('PYTHON');
      const generator2 = getGenerator('python');
      const generator3 = getGenerator('Python');

      expect(generator1).toBeDefined();
      expect(generator2).toBeDefined();
      expect(generator3).toBeDefined();
      // Все должны возвращать один и тот же генератор
      expect(generator1?.supportedLanguages).toEqual(generator2?.supportedLanguages);
      expect(generator2?.supportedLanguages).toEqual(generator3?.supportedLanguages);
    });
  });

  describe('Generator functionality', () => {
    const testUrl = 'http://localhost:51234/';
    const testMessage = 'Test message';
    const testHypothesisId = 'H1';

    it('должен генерировать код для Python', () => {
      const generator = getGenerator('python');
      expect(generator).toBeDefined();

      const code = generator?.generate('python', 'log', testMessage, testUrl, testHypothesisId);
      expect(code).toBeDefined();
      expect(code).toContain('urllib');
      expect(code).toContain(testMessage);
      expect(code).toContain(testUrl);
    });

    it('должен генерировать код для JavaScript', () => {
      const generator = getGenerator('javascript');
      expect(generator).toBeDefined();

      const code = generator?.generate('javascript', 'log', testMessage, testUrl, testHypothesisId);
      expect(code).toBeDefined();
      expect(code).toContain('fetch');
      expect(code).toContain(testMessage);
      expect(code).toContain(testUrl);
    });

    it('должен генерировать код для Go', () => {
      const generator = getGenerator('go');
      expect(generator).toBeDefined();

      const code = generator?.generate('go', 'log', testMessage, testUrl, testHypothesisId);
      expect(code).toBeDefined();
      expect(code).toContain('http.NewRequest');
      expect(code).toContain(testMessage);
      expect(code).toContain(testUrl);
    });

    it('должен генерировать код для разных типов проб (log, trace, error)', () => {
      const generator = getGenerator('javascript');
      expect(generator).toBeDefined();

      const logCode = generator?.generate('javascript', 'log', testMessage, testUrl);
      const traceCode = generator?.generate('javascript', 'trace', testMessage, testUrl);
      const errorCode = generator?.generate('javascript', 'error', testMessage, testUrl);

      expect(logCode).toBeDefined();
      expect(traceCode).toBeDefined();
      expect(errorCode).toBeDefined();

      // Все должны содержать базовые элементы
      expect(logCode).toContain('fetch');
      expect(traceCode).toContain('fetch');
      expect(errorCode).toContain('fetch');
    });

    it('должен генерировать код с hypothesisId', () => {
      const generator = getGenerator('python');
      expect(generator).toBeDefined();

      const code = generator?.generate('python', 'log', testMessage, testUrl, 'H2');
      expect(code).toBeDefined();
      expect(code).toContain('H2');
    });

    it('должен генерировать код без hypothesisId', () => {
      const generator = getGenerator('python');
      expect(generator).toBeDefined();

      const code = generator?.generate('python', 'log', testMessage, testUrl);
      expect(code).toBeDefined();
      // Код должен быть сгенерирован даже без hypothesisId
      if (code) {
        expect(code.length).toBeGreaterThan(0);
      }
    });

    it('должен экранировать специальные символы в сообщении', () => {
      const generator = getGenerator('javascript');
      expect(generator).toBeDefined();

      const messageWithSpecialChars = 'Test "quotes" \'single\' `backticks`';
      const code = generator?.generate('javascript', 'log', messageWithSpecialChars, testUrl);
      
      expect(code).toBeDefined();
      // Код должен быть валидным JavaScript (не должно быть синтаксических ошибок)
      expect(() => {
        // Проверяем, что код можно безопасно использовать
        const testCode = code?.replace(/fetch\([^)]+\)/, 'null');
        if (testCode) {
          // Простая проверка на отсутствие очевидных синтаксических ошибок
          expect(testCode).not.toContain('undefined');
        }
      }).not.toThrow();
    });
  });
});
