/**
 * Unit-тесты для probe-registry.ts
 */

import {
  getAllProbes,
  getProbe,
  registerProbe,
  removeProbeFromRegistry,
  removeProbesForFile,
  clearRegistry,
  getProbeCount
} from '../../src/code-injector/core/probe-registry';
import { ProbeInfo } from '../../src/code-injector/types';

// Мокаем vscode перед импортом модулей, которые его используют
jest.mock('vscode', () => require('../vscode-mock'), { virtual: true });

describe('ProbeRegistry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  afterEach(() => {
    clearRegistry();
  });

  describe('registerProbe', () => {
    it('должен регистрировать пробу в реестре', () => {
      const probeInfo: ProbeInfo = {
        id: 'test1',
        filePath: '/test/file.js',
        lineNumber: 10,
        originalCode: 'const x = 1;',
        injectedCode: '// RooTrace [id: test1] Test\nconsole.log("test");\n// RooTrace [id: test1]: end',
        probeType: 'log',
        message: 'Test probe',
        actualLineNumber: 10,
        probeLinesCount: 3
      };

      registerProbe('test1', probeInfo);

      const probe = getProbe('test1');
      expect(probe).toBeDefined();
      expect(probe?.id).toBe('test1');
      expect(probe?.filePath).toBe('/test/file.js');
      expect(probe?.message).toBe('Test probe');
    });

    it('должен перезаписывать существующую пробу', () => {
      const probeInfo1: ProbeInfo = {
        id: 'test1',
        filePath: '/test/file1.js',
        lineNumber: 10,
        originalCode: 'const x = 1;',
        injectedCode: '// RooTrace [id: test1] Test 1\nconsole.log("test1");\n// RooTrace [id: test1]: end',
        probeType: 'log',
        message: 'Test probe 1',
        actualLineNumber: 10,
        probeLinesCount: 3
      };

      const probeInfo2: ProbeInfo = {
        id: 'test1',
        filePath: '/test/file2.js',
        lineNumber: 20,
        originalCode: 'const y = 2;',
        injectedCode: '// RooTrace [id: test1] Test 2\nconsole.log("test2");\n// RooTrace [id: test1]: end',
        probeType: 'trace',
        message: 'Test probe 2',
        actualLineNumber: 20,
        probeLinesCount: 3
      };

      registerProbe('test1', probeInfo1);
      registerProbe('test1', probeInfo2);

      const probe = getProbe('test1');
      expect(probe?.filePath).toBe('/test/file2.js');
      expect(probe?.message).toBe('Test probe 2');
      expect(probe?.probeType).toBe('trace');
    });
  });

  describe('getProbe', () => {
    it('должен возвращать пробу по ID', () => {
      const probeInfo: ProbeInfo = {
        id: 'test1',
        filePath: '/test/file.js',
        lineNumber: 10,
        originalCode: 'const x = 1;',
        injectedCode: '// RooTrace [id: test1] Test\nconsole.log("test");\n// RooTrace [id: test1]: end',
        probeType: 'log',
        message: 'Test probe',
        actualLineNumber: 10,
        probeLinesCount: 3
      };

      registerProbe('test1', probeInfo);

      const probe = getProbe('test1');
      expect(probe).toEqual(probeInfo);
    });

    it('должен возвращать undefined для несуществующей пробы', () => {
      const probe = getProbe('nonexistent');
      expect(probe).toBeUndefined();
    });
  });

  describe('getAllProbes', () => {
    it('должен возвращать пустой массив для пустого реестра', () => {
      const probes = getAllProbes();
      expect(probes).toEqual([]);
    });

    it('должен возвращать все зарегистрированные пробы', () => {
      const probeInfo1: ProbeInfo = {
        id: 'test1',
        filePath: '/test/file1.js',
        lineNumber: 10,
        originalCode: 'const x = 1;',
        injectedCode: '// RooTrace [id: test1] Test 1\nconsole.log("test1");\n// RooTrace [id: test1]: end',
        probeType: 'log',
        message: 'Test probe 1',
        actualLineNumber: 10,
        probeLinesCount: 3
      };

      const probeInfo2: ProbeInfo = {
        id: 'test2',
        filePath: '/test/file2.js',
        lineNumber: 20,
        originalCode: 'const y = 2;',
        injectedCode: '// RooTrace [id: test2] Test 2\nconsole.log("test2");\n// RooTrace [id: test2]: end',
        probeType: 'trace',
        message: 'Test probe 2',
        actualLineNumber: 20,
        probeLinesCount: 3
      };

      registerProbe('test1', probeInfo1);
      registerProbe('test2', probeInfo2);

      const probes = getAllProbes();
      expect(probes.length).toBe(2);
      expect(probes).toContainEqual(probeInfo1);
      expect(probes).toContainEqual(probeInfo2);
    });
  });

  describe('removeProbeFromRegistry', () => {
    it('должен удалять пробу из реестра', () => {
      const probeInfo: ProbeInfo = {
        id: 'test1',
        filePath: '/test/file.js',
        lineNumber: 10,
        originalCode: 'const x = 1;',
        injectedCode: '// RooTrace [id: test1] Test\nconsole.log("test");\n// RooTrace [id: test1]: end',
        probeType: 'log',
        message: 'Test probe',
        actualLineNumber: 10,
        probeLinesCount: 3
      };

      registerProbe('test1', probeInfo);
      expect(getProbeCount()).toBe(1);

      const removed = removeProbeFromRegistry('test1');
      expect(removed).toBe(true);
      expect(getProbeCount()).toBe(0);
      expect(getProbe('test1')).toBeUndefined();
    });

    it('должен возвращать false для несуществующей пробы', () => {
      const removed = removeProbeFromRegistry('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('removeProbesForFile', () => {
    it('должен удалять все пробы для указанного файла', () => {
      const probeInfo1: ProbeInfo = {
        id: 'test1',
        filePath: '/test/file.js',
        lineNumber: 10,
        originalCode: 'const x = 1;',
        injectedCode: '// RooTrace [id: test1] Test 1\nconsole.log("test1");\n// RooTrace [id: test1]: end',
        probeType: 'log',
        message: 'Test probe 1',
        actualLineNumber: 10,
        probeLinesCount: 3
      };

      const probeInfo2: ProbeInfo = {
        id: 'test2',
        filePath: '/test/file.js',
        lineNumber: 20,
        originalCode: 'const y = 2;',
        injectedCode: '// RooTrace [id: test2] Test 2\nconsole.log("test2");\n// RooTrace [id: test2]: end',
        probeType: 'trace',
        message: 'Test probe 2',
        actualLineNumber: 20,
        probeLinesCount: 3
      };

      const probeInfo3: ProbeInfo = {
        id: 'test3',
        filePath: '/test/other.js',
        lineNumber: 30,
        originalCode: 'const z = 3;',
        injectedCode: '// RooTrace [id: test3] Test 3\nconsole.log("test3");\n// RooTrace [id: test3]: end',
        probeType: 'error',
        message: 'Test probe 3',
        actualLineNumber: 30,
        probeLinesCount: 3
      };

      registerProbe('test1', probeInfo1);
      registerProbe('test2', probeInfo2);
      registerProbe('test3', probeInfo3);

      expect(getProbeCount()).toBe(3);

      const removedCount = removeProbesForFile('/test/file.js');
      expect(removedCount).toBe(2);
      expect(getProbeCount()).toBe(1);
      expect(getProbe('test1')).toBeUndefined();
      expect(getProbe('test2')).toBeUndefined();
      expect(getProbe('test3')).toBeDefined();
    });

    it('должен возвращать 0 для файла без проб', () => {
      const removedCount = removeProbesForFile('/test/nonexistent.js');
      expect(removedCount).toBe(0);
    });
  });

  describe('clearRegistry', () => {
    it('должен очищать весь реестр', () => {
      const probeInfo1: ProbeInfo = {
        id: 'test1',
        filePath: '/test/file1.js',
        lineNumber: 10,
        originalCode: 'const x = 1;',
        injectedCode: '// RooTrace [id: test1] Test 1\nconsole.log("test1");\n// RooTrace [id: test1]: end',
        probeType: 'log',
        message: 'Test probe 1',
        actualLineNumber: 10,
        probeLinesCount: 3
      };

      const probeInfo2: ProbeInfo = {
        id: 'test2',
        filePath: '/test/file2.js',
        lineNumber: 20,
        originalCode: 'const y = 2;',
        injectedCode: '// RooTrace [id: test2] Test 2\nconsole.log("test2");\n// RooTrace [id: test2]: end',
        probeType: 'trace',
        message: 'Test probe 2',
        actualLineNumber: 20,
        probeLinesCount: 3
      };

      registerProbe('test1', probeInfo1);
      registerProbe('test2', probeInfo2);

      expect(getProbeCount()).toBe(2);

      clearRegistry();

      expect(getProbeCount()).toBe(0);
      expect(getAllProbes()).toEqual([]);
    });
  });

  describe('getProbeCount', () => {
    it('должен возвращать 0 для пустого реестра', () => {
      expect(getProbeCount()).toBe(0);
    });

    it('должен возвращать правильное количество проб', () => {
      const probeInfo1: ProbeInfo = {
        id: 'test1',
        filePath: '/test/file1.js',
        lineNumber: 10,
        originalCode: 'const x = 1;',
        injectedCode: '// RooTrace [id: test1] Test 1\nconsole.log("test1");\n// RooTrace [id: test1]: end',
        probeType: 'log',
        message: 'Test probe 1',
        actualLineNumber: 10,
        probeLinesCount: 3
      };

      const probeInfo2: ProbeInfo = {
        id: 'test2',
        filePath: '/test/file2.js',
        lineNumber: 20,
        originalCode: 'const y = 2;',
        injectedCode: '// RooTrace [id: test2] Test 2\nconsole.log("test2");\n// RooTrace [id: test2]: end',
        probeType: 'trace',
        message: 'Test probe 2',
        actualLineNumber: 20,
        probeLinesCount: 3
      };

      expect(getProbeCount()).toBe(0);

      registerProbe('test1', probeInfo1);
      expect(getProbeCount()).toBe(1);

      registerProbe('test2', probeInfo2);
      expect(getProbeCount()).toBe(2);

      removeProbeFromRegistry('test1');
      expect(getProbeCount()).toBe(1);

      clearRegistry();
      expect(getProbeCount()).toBe(0);
    });
  });
});
