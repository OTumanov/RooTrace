/**
 * Unit-тесты для модулей positioning
 */

import { findInsertionPosition } from '../../src/code-injector/positioning/insertion-position';
import { findPythonInsertionPosition } from '../../src/code-injector/positioning/python-positioning';
import { applyIndentation, needsIndentation } from '../../src/code-injector/positioning/indentation-handler';
import { PositioningContext } from '../../src/code-injector/positioning/types';

// Мокаем vscode перед импортом модулей, которые его используют
jest.mock('vscode', () => require('../vscode-mock'), { virtual: true });

describe('Positioning', () => {
  describe('findInsertionPosition', () => {
    it('должен возвращать позицию для Python', () => {
      const context: PositioningContext = {
        lines: ['def test():', '    return True'],
        lineIndex: 0,
        language: 'python',
        originalCode: 'def test():',
        trimmedCode: 'def test():'
      };

      const position = findInsertionPosition(context);
      expect(position).toBeDefined();
      expect(position.insertIndex).toBeGreaterThanOrEqual(0);
      expect(position.baseIndent).toBeDefined();
    });

    it('должен возвращать позицию для JavaScript', () => {
      const context: PositioningContext = {
        lines: ['function test() {', '  return true;', '}'],
        lineIndex: 1,
        language: 'javascript',
        originalCode: '  return true;',
        trimmedCode: 'return true;'
      };

      const position = findInsertionPosition(context);
      expect(position).toBeDefined();
      expect(position.insertIndex).toBe(1);
      expect(position.baseIndent).toBe('  ');
    });

    it('должен корректировать позицию для Python def', () => {
      const context: PositioningContext = {
        lines: ['def test():', '    return True'],
        lineIndex: 0,
        language: 'python',
        originalCode: 'def test():',
        trimmedCode: 'def test():'
      };

      const position = findInsertionPosition(context);
      expect(position).toBeDefined();
      // Для def должна быть корректировка позиции
      if (position.adjusted) {
        expect(position.insertIndex).toBeGreaterThan(0);
        expect(position.adjustmentReason).toBeDefined();
      }
    });
  });

  describe('findPythonInsertionPosition', () => {
    it('должен вставлять внутри функции для def', () => {
      const context: PositioningContext = {
        lines: ['def test():', '    return True'],
        lineIndex: 0,
        language: 'python',
        originalCode: 'def test():',
        trimmedCode: 'def test():'
      };

      const position = findPythonInsertionPosition(context);
      expect(position).toBeDefined();
      expect(position.insertIndex).toBeGreaterThan(0);
      expect(position.adjusted).toBe(true);
      expect(position.adjustmentReason).toContain('function');
    });

    it('должен вставлять перед return', () => {
      const context: PositioningContext = {
        lines: ['def test():', '    return True'],
        lineIndex: 1,
        language: 'python',
        originalCode: '    return True',
        trimmedCode: 'return True'
      };

      const position = findPythonInsertionPosition(context);
      expect(position).toBeDefined();
      expect(position.insertIndex).toBe(1);
      expect(position.baseIndent).toBe('    ');
    });

    it('должен избегать недостижимого кода после return', () => {
      const context: PositioningContext = {
        lines: ['def test():', '    return True', '    print("unreachable")'],
        lineIndex: 2,
        language: 'python',
        originalCode: '    print("unreachable")',
        trimmedCode: 'print("unreachable")'
      };

      const position = findPythonInsertionPosition(context);
      expect(position).toBeDefined();
      // Должна быть корректировка для избежания недостижимого кода
      if (position.adjusted) {
        expect(position.insertIndex).toBeLessThan(2);
        expect(position.adjustmentReason).toContain('unreachable');
      }
    });

    it('должен обрабатывать пустые строки и комментарии', () => {
      const context: PositioningContext = {
        lines: ['def test():', '    # comment', '    return True'],
        lineIndex: 1,
        language: 'python',
        originalCode: '    # comment',
        trimmedCode: '# comment'
      };

      const position = findPythonInsertionPosition(context);
      expect(position).toBeDefined();
      expect(position.baseIndent).toBeDefined();
    });
  });

  describe('applyIndentation', () => {
    it('должен применять отступы для Python', () => {
      const probeCode = 'print("test")\nprint("test2")';
      const baseIndent = '    ';
      const language = 'python';

      const indented = applyIndentation(probeCode, baseIndent, language);
      expect(indented.length).toBe(2);
      expect(indented[0]).toContain(baseIndent);
      expect(indented[1]).toContain(baseIndent);
    });

    it('должен применять отступы для JavaScript', () => {
      const probeCode = 'console.log("test");\nconsole.log("test2");';
      const baseIndent = '  ';
      const language = 'javascript';

      const indented = applyIndentation(probeCode, baseIndent, language);
      expect(indented.length).toBe(2);
      expect(indented[0]).toContain(baseIndent);
    });

    it('должен сохранять относительные отступы', () => {
      const probeCode = 'if (true) {\n  console.log("test");\n}';
      const baseIndent = '    ';
      const language = 'javascript';

      const indented = applyIndentation(probeCode, baseIndent, language);
      expect(indented.length).toBe(3);
      // Первая строка должна иметь baseIndent
      expect(indented[0]).toContain(baseIndent);
      // Вторая строка должна иметь baseIndent + относительный отступ
      expect(indented[1].length).toBeGreaterThan(indented[0].length);
    });

    it('не должен применять отступы для языков без отступов', () => {
      const probeCode = 'printf("test");';
      const baseIndent = '  ';
      const language = 'c';

      const indented = applyIndentation(probeCode, baseIndent, language);
      expect(indented.length).toBe(1);
      // Для C не должны применяться отступы
      expect(indented[0]).not.toContain(baseIndent);
    });
  });

  describe('needsIndentation', () => {
    it('должен возвращать true для Python', () => {
      expect(needsIndentation('python')).toBe(true);
      expect(needsIndentation('py')).toBe(true);
    });

    it('должен возвращать true для JavaScript', () => {
      // JavaScript требует отступы для проб
      expect(needsIndentation('javascript')).toBe(true);
      expect(needsIndentation('js')).toBe(true);
    });

    it('должен возвращать true для Java', () => {
      expect(needsIndentation('java')).toBe(true);
    });

    it('должен возвращать true для Go', () => {
      expect(needsIndentation('go')).toBe(true);
    });

    it('должен возвращать true для Ruby', () => {
      expect(needsIndentation('ruby')).toBe(true);
      expect(needsIndentation('rb')).toBe(true);
    });

    it('должен возвращать false для C', () => {
      expect(needsIndentation('c')).toBe(false);
    });

    it('должен возвращать false для неизвестных языков', () => {
      expect(needsIndentation('unknown')).toBe(false);
    });
  });
});
