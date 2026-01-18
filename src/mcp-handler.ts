import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  CallToolResult
} from '@modelcontextprotocol/sdk/types.js';
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
    // Настройка инструментов MCP (JSON Schema формат)
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
          },
          required: ['filePath', 'lineNumber', 'probeType']
        }
      }
    ];

    // Создание сервера (низкоуровневый API)
    this.server = new Server(
      { name: 'RooTrace', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    // Обработка списка инструментов
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools };
    });

    // Обработка вызовов инструментов
    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const { name, arguments: args = {} } = request.params;

      switch (name) {
        case 'read_runtime_logs': {
          const { sessionId } = args as { sessionId?: string };
          const logs = debugSession.getLogs();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                logs,
                count: logs.length,
                sessionId: sessionId || 'current'
              })
            }]
          };
        }

        case 'get_debug_status': {
          const hypotheses = debugSession.getHypotheses();
          const activeHypotheses = hypotheses.filter(h => h.status === 'active');
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                serverStatus: this.server ? 'active' : 'inactive',
                activeHypotheses,
                currentSession: 'default-session',
                lastUpdated: new Date().toISOString()
              })
            }]
          };
        }

        case 'clear_session': {
          const { sessionId } = args as { sessionId?: string };
          debugSession.clear();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Сессия отладки RooTrace успешно очищена',
                sessionId: sessionId || 'current',
                clearedAt: new Date().toISOString()
              })
            }]
          };
        }

        case 'inject_probes': {
          const { filePath, lineNumber, probeType, message } = args as any;
          
          // Проверяем обязательные параметры
          if (!filePath || lineNumber === undefined || !probeType) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'Missing required parameters: filePath, lineNumber, and probeType are required',
                  errorCode: 'MISSING_PARAMETERS'
                })
              }]
            };
          }

          // Валидируем тип пробы
          const validProbeTypes = ['log', 'trace', 'error'];
          if (!validProbeTypes.includes(probeType)) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: `Invalid probeType. Must be one of: ${validProbeTypes.join(', ')}`,
                  errorCode: 'INVALID_PROBE_TYPE'
                })
              }]
            };
          }

          // Вызываем реальную функцию инъекции пробы
          const result = await injectProbe(filePath, lineNumber, probeType as 'log' | 'trace' | 'error', message);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: result.success,
                filePath,
                lineNumber,
                probeType,
                message,
                confirmation: result.message,
                insertedCode: result.insertedCode
              })
            }]
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    // Запуск сервера через stdio
    const transport = new StdioServerTransport();
    try {
      await this.server.connect(transport);
      console.error('RooTrace MCP server запущен');
    } catch (error) {
      console.error('Ошибка подключения MCP сервера:', error);
      throw error;
    }
    
  }

  /**
   * Останавливает MCP-сервер RooTrace
   */
  async stop(): Promise<void> {
    if (this.server) {
      // Server не имеет метода close в stdio режиме
      // Процесс будет завершен родительским процессом
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
