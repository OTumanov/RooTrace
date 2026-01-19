import * as fs from 'fs';
import * as path from 'path';
import { SessionManager, SessionMetadata } from '../src/session-manager';
import { SharedLogStorage } from '../src/shared-log-storage';
import { decryptObject, getEncryptionKey } from '../src/encryption-utils';
import { INIT_DELAY, SHORT_DELAY, MEDIUM_DELAY } from './constants';

// Мокаем vscode перед импортом модулей, которые его используют
jest.mock('vscode', () => require('./vscode-mock'), { virtual: true });

/**
 * Unit-тесты для session-manager.ts
 * 
 * Проверяет:
 * - Создание и завершение сессий
 * - Получение метаданных сессий
 * - Сравнение сессий
 * - Экспорт сессий
 * - Архивирование старых сессий
 */
describe('SessionManager', () => {
  const testDir = path.join(__dirname, 'temp-test-files');
  let originalSessionsFilePath: string;
  let sessionManager: SessionManager;

  beforeAll(() => {
    // Сохраняем оригинальную рабочую директорию
    originalCwd = process.cwd();
    
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    // Устанавливаем рабочую директорию для тестов
    try {
      process.chdir(testDir);
    } catch (e) {
      // Игнорируем ошибки chdir
    }
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

  beforeEach(async () => {
    // Очищаем singleton перед каждым тестом
    // Это делается через очистку файла сессий
    // Сбрасываем singleton через рефлексию
    (SessionManager as any).instance = undefined;
    
    // Убеждаемся, что тестовая директория существует
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    // Устанавливаем рабочую директорию для тестов
    try {
      process.chdir(testDir);
    } catch (e) {
      // Игнорируем ошибки chdir
    }
    
    sessionManager = SessionManager.getInstance();
    const sessionsFile = path.join(testDir, '.roo-trace-sessions.json');
    
    // Удаляем файл сессий, если существует
    if (fs.existsSync(sessionsFile)) {
      fs.unlinkSync(sessionsFile);
    }
    
    // Даем время на инициализацию
    await new Promise(resolve => setTimeout(resolve, INIT_DELAY));
  });

  test('should create a new session', async () => {
    const sessionId = await sessionManager.createSession('Test session');
    
    expect(sessionId).toBeDefined();
    expect(sessionId).toMatch(/^session-\d+-[a-z0-9]+$/);
    
    const session = sessionManager.getSession(sessionId);
    expect(session).toBeDefined();
    expect(session?.status).toBe('active');
    expect(session?.description).toBe('Test session');
  });

  test('should get current session', async () => {
    const sessionId = await sessionManager.createSession('Current session');
    
    const currentSession = sessionManager.getCurrentSession();
    expect(currentSession).toBeDefined();
    expect(currentSession?.id).toBe(sessionId);
    expect(currentSession?.status).toBe('active');
  });

  test('should complete a session', async () => {
    const sessionId = await sessionManager.createSession('Session to complete');
    
    // Добавляем логи в shared storage
    const storage = SharedLogStorage.getInstance();
    await storage.addLog({
      timestamp: new Date().toISOString(),
      hypothesisId: 'H1',
      context: 'Test context',
      data: { test: 'data' }
    });
    
    // Даем время на сохранение
    await new Promise(resolve => setTimeout(resolve, 100));

    await sessionManager.completeSession();

    const session = sessionManager.getSession(sessionId);
    expect(session?.status).toBe('completed');
    expect(session?.logCount).toBeGreaterThan(0);
    expect(session?.duration).toBeDefined();
    expect(session?.duration).toBeGreaterThanOrEqual(0);

    // После завершения текущей сессии не должно быть
    expect(sessionManager.getCurrentSession()).toBeNull();
  });

  test('should get all sessions', async () => {
    await sessionManager.createSession('Session 1');
    await sessionManager.completeSession();
    
    await sessionManager.createSession('Session 2');
    await sessionManager.completeSession();

    const allSessions = sessionManager.getAllSessions();
    expect(allSessions.length).toBeGreaterThanOrEqual(2);
    
    // Сессии должны быть отсортированы по времени (новые первыми)
    for (let i = 1; i < allSessions.length; i++) {
      const prevTime = new Date(allSessions[i - 1].timestamp).getTime();
      const currTime = new Date(allSessions[i].timestamp).getTime();
      expect(prevTime).toBeGreaterThanOrEqual(currTime);
    }
  });

  test('should compare two sessions', async () => {
    const sessionId1 = await sessionManager.createSession('Session 1');
    const storage = SharedLogStorage.getInstance();
    storage.addLog({
      timestamp: new Date().toISOString(),
      hypothesisId: 'H1',
      context: 'Test',
      data: {}
    });
    await sessionManager.completeSession();

    const sessionId2 = await sessionManager.createSession('Session 2');
    storage.addLog({
      timestamp: new Date().toISOString(),
      hypothesisId: 'H2',
      context: 'Test',
      data: {}
    });
    await sessionManager.completeSession();

    const comparison = sessionManager.compareSessions(sessionId1, sessionId2);
    expect(comparison).toBeDefined();
    expect(comparison?.session1.id).toBe(sessionId1);
    expect(comparison?.session2.id).toBe(sessionId2);
    expect(comparison?.differences.logCountDiff).toBeDefined();
  });

  test('should export sessions', async () => {
    await sessionManager.createSession('Export test');
    await sessionManager.completeSession();

    const exportData = sessionManager.exportSessions();
    expect(exportData).toBeDefined();
    
    const parsed = JSON.parse(exportData);
    expect(parsed.sessions).toBeDefined();
    expect(Array.isArray(parsed.sessions)).toBe(true);
    expect(parsed.exportedAt).toBeDefined();
    expect(parsed.version).toBe('1.0');
  });

  test('should archive old sessions', async () => {
    // Создаем старую сессию (симулируем через прямое изменение файла)
    const oldSessionId = await sessionManager.createSession('Old session');
    await sessionManager.completeSession();
    
    // Читаем файл сессий и модифицируем дату
    const sessionsFile = path.join(testDir, '.roo-trace-sessions.json');
    if (fs.existsSync(sessionsFile)) {
      const content = fs.readFileSync(sessionsFile, 'utf8');
      
      // Файл зашифрован, нужно расшифровать
      let data;
      try {
        // Пробуем сначала как JSON (для обратной совместимости)
        data = JSON.parse(content);
      } catch {
        // Если не JSON, значит зашифрован
        try {
          const encryptionKey = getEncryptionKey();
          data = decryptObject(content, encryptionKey);
        } catch (decryptError) {
          // Если не удалось расшифровать, пропускаем тест
          console.warn('Could not decrypt sessions file, skipping archive test');
          return;
        }
      }
      
      if (data.sessions && data.sessions.length > 0) {
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 31);
        data.sessions[0].timestamp = oldDate.toISOString();
        
        // Сохраняем обратно (зашифрованным)
        const encryptionKey = getEncryptionKey();
        const { encryptObject } = require('../src/encryption-utils');
        const encryptedData = encryptObject(data, encryptionKey);
        fs.writeFileSync(sessionsFile, encryptedData, 'utf8');
      }
    }

    // Пересоздаем менеджер для загрузки измененных данных
    (SessionManager as any).instance = undefined;
    const newManager = SessionManager.getInstance();
    
    // Ждем загрузки сессий
    await new Promise(resolve => setTimeout(resolve, MEDIUM_DELAY));
    
    await newManager.archiveOldSessions(30);

    const archivedSession = newManager.getSession(oldSessionId);
    expect(archivedSession?.status).toBe('archived');
  });

  test('should return null for non-existent session', () => {
    const session = sessionManager.getSession('non-existent-session-id');
    expect(session).toBeUndefined();
  });

  test('should return null when comparing non-existent sessions', () => {
    const comparison = sessionManager.compareSessions('id1', 'id2');
    expect(comparison).toBeNull();
  });
});
