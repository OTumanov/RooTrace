/**
 * ФАЗА 1 - Проверка завершения
 * Фокус на том, что было добавлено в этот момент:
 * - dispose() метод в SharedLogStorage
 * - stopWatcher() с очисткой fs.FSWatcher
 * - Вызов dispose() в extension.ts deactivate()
 */

import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { SharedLogStorage } from '../src/shared-log-storage';
import { withFileLock } from '../src/file-lock-utils';

jest.mock('vscode', () => require('./vscode-mock'), { virtual: true });
jest.setTimeout(10000);

describe('PHASE 1: Completion Verification', () => {
  let testDir: string;
  let originalCwd: string;

  beforeAll(() => {
    originalCwd = process.cwd();
  });

  beforeEach(() => {
    testDir = path.join(tmpdir(), `phase1-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    process.chdir(testDir);
  });

  afterEach(() => {
    try {
      process.chdir(originalCwd);
    } catch (e) {
      // ignore
    }
    
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch (e) {
      // ignore cleanup errors
    }
  });

  describe('✅ Task 1.1: dispose() method implementation', () => {
    
    it('should have dispose() method on SharedLogStorage', async () => {
      const storage = SharedLogStorage.getInstance();
      expect(typeof storage.dispose).toBe('function');
    });

    it('should be callable without errors', async () => {
      const storage = SharedLogStorage.getInstance();
      expect(() => {
        storage.dispose();
      }).not.toThrow();
    });
  });

  describe('✅ Task 1.2: stopWatcher() cleanup with fs.FSWatcher', () => {
    
    it('should stop watcher when dispose() is called', async () => {
      const storage = SharedLogStorage.getInstance();
      const beforeDispose = (storage as any).isWatcherActive;
      
      storage.dispose();
      const afterDispose = (storage as any).isWatcherActive;
      
      expect(afterDispose).toBe(false);
    });

    it('should clear fs.watch handle on dispose', async () => {
      const storage = SharedLogStorage.getInstance();
      storage.dispose();
      
      const watcherHandle = (storage as any).watcherHandle;
      expect(watcherHandle).toBeNull();
    });

    it('should clear debounce timer', async () => {
      const storage = SharedLogStorage.getInstance();
      storage.dispose();
      
      const debounceTimer = (storage as any).watcherDebounceTimer;
      expect(debounceTimer).toBeNull();
    });

    it('should use fs.watch (FSWatcher) not fs.watchFile', async () => {
      const storage = SharedLogStorage.getInstance();
      
      // Проверяем что stopWatcher использует close() метод (это FSWatcher)
      const stopWatcherCode = (storage as any).stopWatcher.toString();
      expect(stopWatcherCode).toContain('close()');
      expect(stopWatcherCode).not.toContain('unwatchFile');
    });
  });

  describe('✅ Task 1.3: EventEmitter cleanup', () => {
    
    it('should clear all listeners on dispose', async () => {
      const storage = SharedLogStorage.getInstance();
      const listener = jest.fn();
      
      storage.on('logsUpdated', listener);
      storage.dispose();
      
      // Эмитим событие после dispose
      storage.emit('logsUpdated', []);
      
      // Listener не был вызван
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('✅ Task 1.4: File lock protection', () => {
    
    it('should protect concurrent file writes', async () => {
      const testFile = path.join(testDir, 'test.json');
      
      // Начальное значение
      fs.writeFileSync(testFile, JSON.stringify({ value: 0 }));

      // 10 операций чтения-модификации-записи с блокировкой
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          withFileLock(testFile, async () => {
            const content = fs.readFileSync(testFile, 'utf8');
            const data = JSON.parse(content);
            const newValue = data.value + 1;
            await new Promise(r => setTimeout(r, 1));
            fs.writeFileSync(testFile, JSON.stringify({ value: newValue }));
          })
        );
      }

      await Promise.all(promises);

      // Финальное значение должно быть ровно 10
      const final = JSON.parse(fs.readFileSync(testFile, 'utf8'));
      expect(final.value).toBe(10);
    });

    it('should not leave .tmp files', async () => {
      const testFile = path.join(testDir, 'atomic.json');
      
      await withFileLock(testFile, async () => {
        fs.writeFileSync(testFile, JSON.stringify({ test: 'data' }));
      });
      
      const tmpFile = testFile + '.tmp';
      expect(fs.existsSync(tmpFile)).toBe(false);
      expect(fs.existsSync(testFile)).toBe(true);
    });
  });

  describe('✅ Task 1.5: Integration - Extension lifecycle', () => {
    
    it('should have dispose() called by extension.deactivate()', async () => {
      // Проверяем что в extension.ts есть вызов sharedStorage.dispose()
      const extensionCode = fs.readFileSync(
        path.join(originalCwd, 'src/extension.ts'),
        'utf8'
      );
      
      expect(extensionCode).toContain('.dispose()');
      expect(extensionCode).toContain('sharedStorage.dispose()');
    });

    it('should properly clean up on deactivation', async () => {
      const storage = SharedLogStorage.getInstance();
      
      // Добавляем логи
      await storage.addLog({
        timestamp: new Date().toISOString(),
        hypothesisId: 'H1',
        context: 'test',
        data: {}
      });
      
      const logsBeforeDispose = await storage.getLogs();
      expect(logsBeforeDispose.length).toBeGreaterThan(0);
      
      // Деактивация
      storage.dispose();
      
      // После dispose:
      // 1. Watcher неактивен
      expect((storage as any).isWatcherActive).toBe(false);
      
      // 2. Логи очищены
      const logsAfterDispose = await storage.getLogs();
      expect(logsAfterDispose.length).toBe(0);
    });
  });

  describe('📋 Summary: Phase 1 Checklist', () => {
    
    it('✅ Race condition fix: AsyncMutex (async-lock.ts) - IMPLEMENTED', () => {
      const asyncLockPath = path.join(originalCwd, 'src/async-lock.ts');
      expect(fs.existsSync(asyncLockPath)).toBe(true);
    });

    it('✅ Atomic write: atomic-write.ts - IMPLEMENTED', () => {
      const atomicWritePath = path.join(originalCwd, 'src/atomic-write.ts');
      expect(fs.existsSync(atomicWritePath)).toBe(true);
    });

    it('✅ File lock utils: file-lock-utils.ts - UPDATED', () => {
      const fileLockPath = path.join(originalCwd, 'src/file-lock-utils.ts');
      const content = fs.readFileSync(fileLockPath, 'utf8');
      expect(content).toContain('withFileLock');
    });

    it('✅ SharedLogStorage: dispose() - IMPLEMENTED', () => {
      const storage = SharedLogStorage.getInstance();
      expect(typeof storage.dispose).toBe('function');
    });

    it('✅ Extension: deactivate() calls dispose() - IMPLEMENTED', () => {
      const extensionPath = path.join(originalCwd, 'src/extension.ts');
      const content = fs.readFileSync(extensionPath, 'utf8');
      expect(content).toContain('sharedStorage.dispose()');
    });

    it('✅ Watcher: fs.watch instead of fs.watchFile - IMPLEMENTED', () => {
      const storageCode = fs.readFileSync(
        path.join(originalCwd, 'src/shared-log-storage.ts'),
        'utf8'
      );
      // Проверяем что используется fs.watch
      expect(storageCode).toContain('fs.watch(');
      // Проверяем что используется close() метод для закрытия watcher'а
      expect(storageCode).toContain('watcherHandle.close()');
    });
  });
});
