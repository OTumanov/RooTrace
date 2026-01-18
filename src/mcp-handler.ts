import { Server, createServer } from '@modelcontextprotocol/sdk';
import { EventEmitter } from 'events';
import { injectProbe } from './code-injector';

// Типы для гипотез и отладочной информации
interface Hypothesis {
  id: string;
  status: string;
  description: string;
}

interface RuntimeLog {
  timestamp: string;
  hypothesisId: string;
  context: string;
  data: any;
}

// Заглушка для хранения данных отладки
class DebugSession {
  private hypotheses: Map<string, Hypothesis> = new Map();
  private logs: RuntimeLog[] = [];
  
  constructor() {
    // Инициализация предустановленных гипотез
    this.hypotheses.set('H1', { id: 'H1', status: 'active', description: 'Primary hypothesis' });
    this.hypotheses.set('H2', { id: 'H2', status: 'testing', description: 'Secondary hypothesis' });
    this.hypotheses.set('H3', { id: 'H3', status: 'pending', description: 'Tertiary hypothesis' });
  }

  getLogs(): RuntimeLog[] {
    return this.logs;
  }

  addLog(log: RuntimeLog) {
    this.logs.push(log);
    // Ограничиваем размер логов последними 1000 записями
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }
  }

  getHypotheses(): Hypothesis[] {
    return Array.from(this.hypotheses.values());
  }

  getHypothesis(id: string): Hypothesis | undefined {
    return this.hypotheses.get(id);
  }

  clear() {
    this.logs = [];
    // Сохраняем определения гипотез, но сбрасываем их состояние
    this.hypotheses.forEach((hypothesis, key) => {
      this.hypotheses.set(key, { ...hypothesis, status: 'pending' });
    });
  }
}

const debugSession = new DebugSession();

// Основной класс для обработки MCP-запросов
export class RooTraceMCPHandler {
  private server: Server | null = null;
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
  }

  /**
   * Запускает MCP-сервер RooTrace
   */
  async start(): Promise<void> {
    // Настройка инструментов MCP
    const tools = [
      {
        name: 'read_runtime_logs',
        description: 'Получает логи отладочной сессии RooTrace',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'ID сессии для получения логов (если не указан, возвращаются логи текущей сессии)',
            }
          }
        }
      },
      {
        name: 'get_debug_status',
        description: 'Возвращает статус сервера (активен/не активен), список активных гипотез и текущую сессию',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'clear_session',
        description: 'Очищает сессию отладки RooTrace, сбрасывает все гипотезы и логи',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'ID сессии для очистки (если не указан, очищается текущая сессия)',
            }
          }
        }
      },
      {
        name: 'inject_probes',
        description: 'Инъекция проб в код для дополнительной отладочной информации',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Путь к файлу для инъекции проб',
            },
            lineNumber: {
              type: 'number',
              description: 'Номер строки для инъекции пробы',
            },
            probeType: {
              type: 'string',
              enum: ['log', 'trace', 'error'],
              description: 'Тип пробы для инъекции',
            },
            message: {
              type: 'string',
              description: 'Сообщение для пробы',
            }
          }
        }
      }
    ];

    // Создание сервера
    this.server = createServer({
      name: 'RooTrace',
      version: '1.0.0',
      tools,
    });

    // Обработка инструментов
    this.server.setRequestHandler('tools/read_runtime_logs', async (request: any) => {
      const { sessionId } = request.params || {};
      
      // Если sessionId не указан, используем текущую сессию
      if (sessionId !== undefined) {
        // В реальной реализации здесь может быть логика работы с разными сессиями
        // Пока что игнорируем sessionId и возвращаем логи текущей сессии
      }
      
      const logs = debugSession.getLogs();
      
      return {
        result: {
          logs,
          count: logs.length,
          sessionId: sessionId || 'current'
        }
      };
    });

    this.server.setRequestHandler('tools/get_debug_status', async (request: any) => {
      const hypotheses = debugSession.getHypotheses();
      const activeHypotheses = hypotheses.filter(h => h.status === 'active');
      
      return {
        result: {
          serverStatus: this.server ? 'active' : 'inactive',
          activeHypotheses: activeHypotheses,
          currentSession: 'default-session', // В реальной реализации это будет динамически определяться
          lastUpdated: new Date().toISOString()
        }
      };
    });

    this.server.setRequestHandler('tools/clear_session', async (request: any) => {
      const { sessionId } = request.params || {};
      
      // Если sessionId не указан, очищаем текущую сессию
      if (sessionId !== undefined) {
        // В реальной реализации здесь может быть логика работы с разными сессиями
        // Пока что игнорируем sessionId и очищаем текущую сессию
      }
      
      debugSession.clear();
      
      return {
        result: {
          success: true,
          message: 'Сессия отладки RooTrace успешно очищена',
          sessionId: sessionId || 'current',
          clearedAt: new Date().toISOString()
        }
      };
    });

    this.server.setRequestHandler('tools/inject_probes', async (request: any) => {
      const { filePath, lineNumber, probeType, message } = request.params || {};
      
      // Проверяем обязательные параметры
      if (!filePath || lineNumber === undefined || !probeType) {
        return {
          result: {
            success: false,
            error: 'Missing required parameters: filePath, lineNumber, and probeType are required',
            errorCode: 'MISSING_PARAMETERS'
          }
        };
      }
      
      // Валидируем тип пробы
      const validProbeTypes = ['log', 'trace', 'error'];
      if (!validProbeTypes.includes(probeType)) {
        return {
          result: {
            success: false,
            error: `Invalid probeType. Must be one of: ${validProbeTypes.join(', ')}`,
            errorCode: 'INVALID_PROBE_TYPE'
          }
        };
      }
      
      // Вызываем реальную функцию инъекции пробы
      const result = await injectProbe(filePath, lineNumber, probeType as 'log' | 'trace' | 'error', message);
      
      return {
        result: {
          success: result.success,
          filePath,
          lineNumber,
          probeType,
          message,
          confirmation: result.message,
          insertedCode: result.insertedCode
        }
      };
    });

    // Запуск сервера
    await this.server.listen({
      port: 0, // Использовать случайный доступный порт
    });
    
    console.log('RooTrace MCP server запущен');
  }

  /**
   * Останавливает MCP-сервер RooTrace
   */
  async stop(): Promise<void> {
    if (this.server) {
      await this.server.close();
      this.server = null;
      console.log('RooTrace MCP server остановлен');
    }
  }

  /**
   * Добавляет лог в сессию отладки
   */
  addLog(hypothesisId: string, context: string, data: any): void {
    const log: RuntimeLog = {
      timestamp: new Date().toISOString(),
      hypothesisId,
      context,
      data
    };
    debugSession.addLog(log);
  }
}

// Экспортируем функцию для запуска сервера
export const startRooTraceMCP = async (): Promise<RooTraceMCPHandler> => {
  const handler = new RooTraceMCPHandler();
  await handler.start();
  return handler;
};

// Экспортируем глобальный экземпляр для использования в других частях приложения
export const rooTraceMCP = new RooTraceMCPHandler();