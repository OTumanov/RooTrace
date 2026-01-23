// Менеджер сессий отладки для хранения истории

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SharedLogStorage, RuntimeLog, Hypothesis } from './shared-log-storage';
import { encryptObject, decryptObject, getEncryptionKey } from './encryption-utils';
import { withFileLock } from './file-lock-utils';
import { getRootraceFilePath } from './rootrace-dir-utils';
import { parseConfigOrDecrypt } from './utils';

export interface SessionMetadata {
  id: string;
  timestamp: string;
  hypotheses: Hypothesis[];
  logCount: number;
  duration?: number;
  status: 'active' | 'completed' | 'archived';
  description?: string;
}

export interface SessionComparison {
  session1: SessionMetadata;
  session2: SessionMetadata;
  differences: {
    logCountDiff: number;
    hypothesisDiff: string[];
    durationDiff?: number;
  };
}

/**
 * Менеджер для управления историей сессий отладки
 */
export class SessionManager {
  private static instance: SessionManager;
  private sessions: Map<string, SessionMetadata> = new Map();
  private currentSessionId: string | null = null;
  private sessionStartTime: number = 0;
  private readonly sessionsFilePath: string;

  private constructor() {
    this.sessionsFilePath = getRootraceFilePath('sessions.json');
    // Load sessions asynchronously
    this.loadSessions();
  }

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * Создает новую сессию отладки
   */
  async createSession(description?: string): Promise<string> {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const metadata: SessionMetadata = {
      id: sessionId,
      timestamp: new Date().toISOString(),
      hypotheses: SharedLogStorage.getInstance().getHypotheses(),
      logCount: 0,
      status: 'active',
      description
    };

    this.sessions.set(sessionId, metadata);
    this.currentSessionId = sessionId;
    this.sessionStartTime = Date.now();
    await this.saveSessions();

    return sessionId;
  }

  /**
   * Завершает текущую сессию
   */
  async completeSession(): Promise<void> {
    if (!this.currentSessionId) return;

    const session = this.sessions.get(this.currentSessionId);
    if (session) {
      const sharedStorage = SharedLogStorage.getInstance();
      session.logCount = sharedStorage.getLogCount();
      session.duration = Date.now() - this.sessionStartTime;
      session.status = 'completed';
      session.hypotheses = sharedStorage.getHypotheses();
      this.sessions.set(this.currentSessionId, session);
      await this.saveSessions();
    }

    this.currentSessionId = null;
    this.sessionStartTime = 0;
  }

  /**
   * Получает метаданные сессии по ID
   */
  getSession(sessionId: string): SessionMetadata | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Получает все сессии
   */
  getAllSessions(): SessionMetadata[] {
    return Array.from(this.sessions.values()).sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  /**
   * Получает текущую активную сессию
   */
  getCurrentSession(): SessionMetadata | null {
    if (!this.currentSessionId) return null;
    return this.sessions.get(this.currentSessionId) || null;
  }

  /**
   * Сравнивает две сессии
   */
  compareSessions(sessionId1: string, sessionId2: string): SessionComparison | null {
    const session1 = this.sessions.get(sessionId1);
    const session2 = this.sessions.get(sessionId2);

    if (!session1 || !session2) return null;

    const hypothesisIds1 = new Set(session1.hypotheses.map(h => h.id));
    const hypothesisIds2 = new Set(session2.hypotheses.map(h => h.id));
    const diff: string[] = [];

    hypothesisIds1.forEach(id => {
      if (!hypothesisIds2.has(id)) {
        diff.push(`+${id}`);
      }
    });

    hypothesisIds2.forEach(id => {
      if (!hypothesisIds1.has(id)) {
        diff.push(`-${id}`);
      }
    });

    return {
      session1,
      session2,
      differences: {
        logCountDiff: session2.logCount - session1.logCount,
        hypothesisDiff: diff,
        durationDiff: session2.duration && session1.duration 
          ? session2.duration - session1.duration 
          : undefined
      }
    };
  }

  /**
   * Экспортирует историю сессий в JSON
   */
  exportSessions(): string {
    return JSON.stringify({
      sessions: Array.from(this.sessions.values()),
      exportedAt: new Date().toISOString(),
      version: '1.0'
    }, null, 2);
  }

  /**
   * Загружает сессии из файла
   */
  private async loadSessions(): Promise<void> {
    try {
      await withFileLock(this.sessionsFilePath, async () => {
        try {
          // Асинхронно проверяем, существует ли файл
          await fs.promises.access(this.sessionsFilePath, fs.constants.F_OK);
          
          // Читаем содержимое файла асинхронно
          const content = await fs.promises.readFile(this.sessionsFilePath, 'utf8');
          
          // Используем общую утилиту для парсинга конфигурации с fallback на дешифровку
          const data = parseConfigOrDecrypt<{ sessions?: SessionMetadata[] }>(content, { sessions: [] });
          if (!data || !data.sessions) {
            console.error('[SessionManager] Invalid sessions file format');
            return;
          }
          
          if (data.sessions && Array.isArray(data.sessions)) {
            data.sessions.forEach((session: SessionMetadata) => {
              this.sessions.set(session.id, session);
            });
          }
        } catch (error) {
          // Файл не существует или не читается - это нормально для новой сессии
          if (error instanceof Error && !error.message.includes('ENOENT')) {
            console.error('[SessionManager] Error loading sessions:', error);
          }
        }
      });
    } catch (error) {
      console.error('[SessionManager] Error loading sessions:', error);
    }
  }

  /**
   * Сохраняет сессии в файл
   */
  private async saveSessions(): Promise<void> {
    try {
      await withFileLock(this.sessionsFilePath, async () => {
        // Создаем директорию, если она не существует
        const dir = path.dirname(this.sessionsFilePath);
        try {
          await fs.promises.mkdir(dir, { recursive: true });
        } catch (error) {
          // Игнорируем ошибку, если директория уже существует
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
          }
        }
        
        const data = {
          sessions: Array.from(this.sessions.values()),
          lastUpdated: new Date().toISOString(),
          version: '1.0'
        };
        
        // Encrypt the data before saving
        const encryptionKey = getEncryptionKey();
        const encryptedData = encryptObject(data, encryptionKey);
        
        await fs.promises.writeFile(this.sessionsFilePath, encryptedData, 'utf8');
      });
    } catch (error) {
      console.error('[SessionManager] Error saving sessions:', error);
    }
  }

  /**
   * Архивирует старые сессии
   */
  async archiveOldSessions(daysOld: number = 30): Promise<void> {
    const cutoffDate = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    
    this.sessions.forEach((session, id) => {
      const sessionDate = new Date(session.timestamp).getTime();
      if (sessionDate < cutoffDate && session.status !== 'archived') {
        session.status = 'archived';
        this.sessions.set(id, session);
      }
    });

    await this.saveSessions();
  }
}
