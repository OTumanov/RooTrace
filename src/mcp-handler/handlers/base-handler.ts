/**
 * Базовые интерфейсы для обработчиков инструментов MCP
 * 
 * Этот файл определяет контракты, которым должны следовать все обработчики инструментов.
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SharedLogStorage } from '../../shared-log-storage';
import { ContextMonitor } from '../../context-monitor';
import { MessageQueue } from '../../message-queue';

/**
 * Контекст для обработчиков инструментов
 * Содержит все необходимые зависимости и утилиты
 */
export interface HandlerContext {
  // Хранилище логов
  sharedStorage: SharedLogStorage;
  
  // Мониторинг контекста
  contextMonitor: ContextMonitor;
  
  // Очередь сообщений
  messageQueue: MessageQueue;
  
  // Утилиты для работы с workspace
  getWorkspaceRoot: () => string;
  
  // Утилиты для работы с путями
  normalizeFilePath: (path: string) => string;
  isPythonFile: (path: string) => boolean;
  findGitRoot: (filePath: string) => Promise<string | null>;
  
  // Утилиты для работы с файлами
  getRootraceFilePath: (filename: string) => string;
  
  // Утилиты для работы с пробами
  
  // Утилиты для работы с пробами
  injectProbe: (filePath: string, lineNumber: number, probeType: 'log' | 'trace' | 'error', message: string, probeCode?: string, hypothesisId?: string) => Promise<any>;
  getAllProbes: () => any[];
  removeAllProbesFromFile: (filePath: string) => Promise<{ success: boolean; message: string }>;
  
  // Утилиты для работы с сервером
  getServerUrl: (workspaceRoot?: string) => string | null;
  testServerWriteRead: (serverUrl: string) => Promise<{ success: boolean; error?: string }>;
  
  // Утилиты безопасности
  checkReadRuntimeLogsApproval: () => { allowed: boolean; reason?: string };
  checkGitCommitBeforeEdit: (filePath: string) => Promise<{ allowed: boolean; error?: string }>;
  
  // Утилиты для инъекции с retry
  injectProbeWithRetry: (
    filePath: string,
    lineNumber: number,
    probeType: 'log' | 'trace' | 'error',
    message: string | undefined,
    probeCode?: string,
    hypothesisId?: string
  ) => Promise<any>;
  
  // Утилиты для поиска файлов
  findFilesWithProbes: (rootDir: string, maxDepth?: number, currentDepth?: number) => Promise<string[]>;
  
  // Загрузчик правил
  loadRule: (rulePath: string) => Promise<string | null>;
  
  // Время старта сервера (для uptime)
  startTime: number;
  
  // Трекер файлов, для которых был сделан коммит (для безопасности)
  committedFiles: Set<string>;
}

/**
 * Интерфейс для обработчика инструмента
 * Каждый обработчик должен реализовать этот интерфейс
 */
export interface ToolHandler {
  /**
   * Обрабатывает вызов инструмента
   * @param args - Аргументы инструмента
   * @param context - Контекст с зависимостями
   * @returns Результат выполнения инструмента
   */
  handle(args: any, context: HandlerContext): Promise<CallToolResult>;
}
