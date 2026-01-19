/**
 * Вспомогательные функции для тестов
 */

import * as fs from 'fs';
import * as path from 'path';
import { SharedLogStorage } from '../../src/shared-log-storage';
import { tmpdir } from 'os';

/**
 * Создает тестовый файл с указанным содержимым
 */
export async function createTestFile(testDir: string, filename: string, content: string): Promise<string> {
  const filePath = path.join(testDir, filename);
  await fs.promises.writeFile(filePath, content, 'utf8');
  return filePath;
}

/**
 * Очищает все тестовые файлы в директории
 */
export async function cleanupTestFiles(testDir: string): Promise<void> {
  if (fs.existsSync(testDir)) {
    const files = fs.readdirSync(testDir);
    for (const file of files) {
      const filePath = path.join(testDir, file);
      try {
        if (fs.statSync(filePath).isFile() && file !== '.debug_port') {
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        // Игнорируем ошибки при удалении
      }
    }
  }
}

/**
 * Проверяет, что проба была вставлена в файл
 */
export function expectProbeInjected(filePath: string, message: string): void {
  const content = fs.readFileSync(filePath, 'utf8');
  expect(content).toContain('RooTrace');
  expect(content).toMatch(/RooTrace \[id:\s*[a-z0-9]+\]/);
  if (message) {
    expect(content).toContain(message);
  }
}

/**
 * Проверяет, что проба была удалена из файла
 */
export function expectProbeRemoved(filePath: string, originalContent: string): void {
  const content = fs.readFileSync(filePath, 'utf8');
  expect(content).not.toMatch(/RooTrace \[id:/);
  // Проверяем, что оригинальный код остался
  expect(content).toContain(originalContent.split('\n')[0].trim());
}

/**
 * Создает изолированный экземпляр SharedLogStorage для тестов
 * Использует уникальную временную директорию для каждого теста
 */
export function createTestStorage(storagePath?: string): SharedLogStorage {
  const testDir = storagePath || path.join(tmpdir(), `rooTrace-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
  
  // Создаем директорию если её нет
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  // Сбрасываем singleton перед созданием нового экземпляра
  (SharedLogStorage as any).instance = undefined;
  
  // Меняем рабочую директорию для этого теста (как в других тестах)
  const originalCwd = process.cwd();
  try {
    process.chdir(testDir);
  } catch (e) {
    // Игнорируем ошибки chdir
  }
  
  const storage = SharedLogStorage.getInstance();
  
  // Восстанавливаем cwd сразу после создания storage
  try {
    process.chdir(originalCwd);
  } catch (e) {
    // Игнорируем ошибки chdir
  }
  
  return storage;
}

/**
 * Очищает и останавливает тестовый storage
 */
export async function cleanupTestStorage(storage: SharedLogStorage): Promise<void> {
  if (storage) {
    (storage as any).stopWatcher();
    await storage.clear();
  }
  (SharedLogStorage as any).instance = undefined;
}

/**
 * Ждет события на EventEmitter с таймаутом
 */
export function waitForEvent(emitter: any, event: string, timeout: number = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.removeListener(event, handler);
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);
    
    const handler = () => {
      clearTimeout(timer);
      emitter.removeListener(event, handler);
      resolve();
    };
    
    emitter.once(event, handler);
  });
}

/**
 * Ждет завершения всех операций сохранения через события
 */
export async function waitForLogsSaved(storage: any, expectedCount: number, timeout: number = 5000): Promise<void> {
  // Сначала проверяем текущее состояние - возможно логи уже сохранены
  try {
    const currentLogs = await storage.getLogs();
    if (currentLogs.length >= expectedCount) {
      return; // Логи уже сохранены
    }
  } catch (e) {
    // Игнорируем ошибки при получении логов
  }

  return new Promise((resolve, reject) => {
    const receivedLogs: any[] = [];
    let resolved = false;
    
    const checkAndResolve = async () => {
      if (resolved) return;
      try {
        const currentLogs = await storage.getLogs();
        if (currentLogs.length >= expectedCount) {
          resolved = true;
          storage.removeListener('logAdded', logAddedHandler);
          resolve();
        }
      } catch (e) {
        // Игнорируем ошибки
      }
    };
    
    const logAddedHandler = async (log: any) => {
      receivedLogs.push(log);
      await checkAndResolve();
    };
    
    storage.on('logAdded', logAddedHandler);
    
    // Периодически проверяем текущее состояние (на случай если события не придут)
    const checkInterval = setInterval(async () => {
      await checkAndResolve();
    }, 100);
    
    // Таймаут на случай если события не придут
    setTimeout(async () => {
      clearInterval(checkInterval);
      storage.removeListener('logAdded', logAddedHandler);
      if (!resolved) {
        try {
          const finalLogs = await storage.getLogs();
          if (finalLogs.length >= expectedCount) {
            resolve();
          } else {
            reject(new Error(`Timeout: expected ${expectedCount} logs, got ${finalLogs.length}`));
          }
        } catch (e) {
          reject(new Error(`Timeout: expected ${expectedCount} logs, got ${receivedLogs.length} (error checking logs: ${e})`));
        }
      }
    }, timeout);
  });
}
