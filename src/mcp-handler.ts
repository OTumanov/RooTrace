import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  InitializeRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  CallToolResult
} from '@modelcontextprotocol/sdk/types.js';
import { injectProbe, getAllProbes, removeAllProbesFromFile } from './code-injector';
import { SharedLogStorage, RuntimeLog, Hypothesis } from './shared-log-storage';
import { handleError, logInfo, logDebug } from './error-handler';
import { LogData } from './types';

// Используем shared log storage вместо изолированного debugSession
const sharedStorage = SharedLogStorage.getInstance();

// Основной класс для обработки MCP-запросов
export class RooTraceMCPHandler {
  private server: Server | null = null;
  private startTime: number = Date.now();

  constructor() {
    // EventEmitter удален, так как не использовался
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
            },
            probeCode: {
              type: 'string',
              description: 'Опциональный код пробы. Если не указан, будет сгенерирован автоматически. Должен включать комментарии до и после кода.',
            },
            hypothesisId: {
              type: 'string',
              description: 'ID гипотезы (H1, H2, H3, H4, H5)',
            }
          },
          required: ['filePath', 'lineNumber', 'probeType']
        }
      },
      {
        name: 'inject_multiple_probes',
        description: 'Инъекция нескольких проб в код за один вызов. Используйте этот инструмент вместо множественных вызовов inject_probes - это более эффективно и избегает проблем с вложенностью. Планируйте все пробы заранее и вставляйте их все сразу.',
        inputSchema: {
          type: 'object',
          properties: {
            probes: {
              type: 'array',
              description: 'Массив проб для вставки. Каждая проба должна содержать filePath, lineNumber, probeType и опционально message, probeCode, hypothesisId',
              items: {
                type: 'object',
                properties: {
                  filePath: {
                    type: 'string',
                    description: 'Путь к файлу для инъекции пробы',
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
                  },
                  probeCode: {
                    type: 'string',
                    description: 'Опциональный код пробы. Если не указан, будет сгенерирован автоматически. Должен включать комментарии до и после кода.',
                  },
                  hypothesisId: {
                    type: 'string',
                    description: 'ID гипотезы (H1, H2, H3, H4, H5)',
                  }
                },
                required: ['filePath', 'lineNumber', 'probeType']
              },
              minItems: 1
            }
          },
          required: ['probes']
        }
      },
      {
        name: 'show_user_instructions',
        description: 'Показывает пользователю инструкции с кнопками для следующих шагов отладки. Используйте этот инструмент после завершения инъекции проб, чтобы показать пользователю что делать дальше.',
        inputSchema: {
          type: 'object',
          properties: {
            instructions: {
              type: 'string',
              description: 'Текст инструкций для пользователя (пошаговые действия)',
            },
            stepNumber: {
              type: 'number',
              description: 'Номер шага в процессе отладки (1, 2, 3 и т.д.)',
            }
          },
          required: ['instructions']
        }
      }
    ];

    // Создание сервера (низкоуровневый API)
    this.server = new Server(
      { name: 'RooTrace', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    // Обработка Initialize Request (обязательно для MCP протокола)
    this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      const startTime = Date.now();
      this.logMCPRequest('initialize', request.params);
      
      try {
        const response = {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'RooTrace',
            version: '1.0.0'
          }
        };
        
        const duration = Date.now() - startTime;
        this.logMCPResponse('initialize', response, duration);
        
        return response;
      } catch (error) {
        const duration = Date.now() - startTime;
        this.logMCPError('initialize', error, duration);
        throw error;
      }
    });

    // Примечание: Shutdown Request обрабатывается через сигналы (SIGINT/SIGTERM) в mcp-server.ts
    // MCP SDK не экспортирует ShutdownRequestSchema в текущей версии

    // Обработка списка инструментов
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const startTime = Date.now();
      this.logMCPRequest('list_tools', request.params);
      
      try {
        const response = { tools };
        const duration = Date.now() - startTime;
        this.logMCPResponse('list_tools', response, duration);
        return response;
      } catch (error) {
        const duration = Date.now() - startTime;
        this.logMCPError('list_tools', error, duration);
        throw error;
      }
    });

    // Обработка вызовов инструментов
    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const startTime = Date.now();
      const { name, arguments: args = {} } = request.params;
      this.logMCPRequest(`call_tool:${name}`, args);

      try {
        let result: CallToolResult;

        switch (name) {
          case 'read_runtime_logs': {
            const { sessionId } = args as { sessionId?: string };
            // Принудительно перезагружаем логи из файла перед чтением (для синхронизации с HTTP сервером)
            await sharedStorage.reloadLogsFromFile();
            const logs = await sharedStorage.getLogs();
            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  logs,
                  count: logs.length,
                  sessionId: sessionId || 'current'
                })
              }]
            };
            break;
          }

          case 'get_debug_status': {
            const hypotheses = sharedStorage.getHypotheses();
            const activeHypotheses = hypotheses.filter(h => h.status === 'active');
            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  serverStatus: this.server ? 'active' : 'inactive',
                  activeHypotheses,
                  currentSession: 'default-session',
                  lastUpdated: new Date().toISOString(),
                  uptime: Date.now() - this.startTime
                })
              }]
            };
            break;
          }

          case 'clear_session': {
            const { sessionId } = args as { sessionId?: string };
            
            // БЕЗОТКАЗНАЯ ОЧИСТКА: Сначала получаем список файлов из логов
            const logs = await sharedStorage.getLogs();
            const affectedFiles = new Set<string>();
            
            // Собираем уникальный список файлов из логов
            logs.forEach(log => {
              if (log.context && log.context.includes(':')) {
                const filePath = log.context.split(':')[0];
                if (filePath && filePath.trim()) {
                  affectedFiles.add(filePath);
                }
              }
            });
            
            // Также получаем файлы из реестра проб
            const allProbes = getAllProbes();
            for (const probe of allProbes) {
              affectedFiles.add(probe.filePath);
            }
            
            // Удаляем все пробы из каждого файла
            const removalResults: Array<{ file: string; success: boolean; message: string }> = [];
            for (const filePath of affectedFiles) {
              try {
                const removalResult = await removeAllProbesFromFile(filePath);
                removalResults.push({
                  file: filePath,
                  success: removalResult.success,
                  message: removalResult.message
                });
              } catch (error) {
                removalResults.push({
                  file: filePath,
                  success: false,
                  message: `Error removing probes from ${filePath}: ${error instanceof Error ? error.message : String(error)}`
                });
              }
            }
            
            // ОЧИСТКА ДАННЫХ: Обнуляем JSON-файл логов через блокировку
            await sharedStorage.clear();
            
            const successCount = removalResults.filter(r => r.success).length;
            const totalCount = removalResults.length;
            
            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: `Проект полностью очищен. Удалены пробы из ${successCount} из ${totalCount} файлов. Логи сброшены.`,
                  sessionId: sessionId || 'current',
                  clearedAt: new Date().toISOString(),
                  probesRemoved: allProbes.length,
                  filesProcessed: totalCount,
                  removalResults: removalResults
                })
              }]
            };
            break;
          }

          case 'inject_probes': {
            const { filePath, lineNumber, probeType, message, probeCode, hypothesisId } = args as any;
            
            // Проверяем обязательные параметры
            if (!filePath || typeof filePath !== 'string') {
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: 'Missing or invalid filePath parameter (must be a non-empty string)',
                    errorCode: 'MISSING_PARAMETERS'
                  })
                }],
                isError: true
              };
              break;
            }
            
            if (lineNumber === undefined || lineNumber === null || typeof lineNumber !== 'number' || isNaN(lineNumber) || lineNumber < 1) {
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: 'Missing or invalid lineNumber parameter (must be a positive integer)',
                    errorCode: 'MISSING_PARAMETERS'
                  })
                }],
                isError: true
              };
              break;
            }
            
            if (!probeType || typeof probeType !== 'string') {
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: 'Missing or invalid probeType parameter (must be a string)',
                    errorCode: 'MISSING_PARAMETERS'
                  })
                }],
                isError: true
              };
              break;
            }
            
            // Валидируем опциональные параметры
            if (probeCode !== undefined && probeCode !== null && typeof probeCode !== 'string') {
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: 'Invalid probeCode parameter (must be a string if provided)',
                    errorCode: 'INVALID_PARAMETERS'
                  })
                }],
                isError: true
              };
              break;
            }
            
            if (hypothesisId !== undefined && hypothesisId !== null) {
              if (typeof hypothesisId !== 'string') {
                result = {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      error: 'Invalid hypothesisId parameter (must be a string if provided)',
                      errorCode: 'INVALID_PARAMETERS'
                    })
                  }],
                  isError: true
                };
                break;
              }
              // Валидируем формат hypothesisId (должен быть H1-H5)
              const trimmedHypothesisId = hypothesisId.trim();
              if (!/^H[1-5]$/.test(trimmedHypothesisId)) {
                result = {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      error: `Invalid hypothesisId format. Must be H1, H2, H3, H4, or H5, got: ${trimmedHypothesisId}`,
                      errorCode: 'INVALID_PARAMETERS'
                    })
                  }],
                  isError: true
                };
                break;
              }
            }

            // Валидируем тип пробы
            const validProbeTypes = ['log', 'trace', 'error'];
            if (!validProbeTypes.includes(probeType)) {
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: `Invalid probeType. Must be one of: ${validProbeTypes.join(', ')}`,
                    errorCode: 'INVALID_PROBE_TYPE'
                  })
                }],
                isError: true
              };
              break;
            }

            // Вызываем реальную функцию инъекции пробы с обработкой ошибок и retry механизмом
            try {
              // Нормализуем probeCode: если передан, но пустой, считаем как не переданный
              const normalizedProbeCode = (probeCode && typeof probeCode === 'string' && probeCode.trim().length > 0) ? probeCode : undefined;
              const normalizedHypothesisId = (hypothesisId && typeof hypothesisId === 'string' && hypothesisId.trim().length > 0) ? hypothesisId.trim() : undefined;
              const normalizedMessage = (message && typeof message === 'string') ? message : (normalizedProbeCode ? 'Custom probe code' : 'Debug probe');
              
              const injectResult = await this.injectProbeWithRetry(
                filePath, 
                lineNumber, 
                probeType as 'log' | 'trace' | 'error', 
                normalizedMessage,
                normalizedProbeCode, 
                normalizedHypothesisId
              );
              
              // Формируем ответ с результатами проверки синтаксиса
              const response: any = {
                success: injectResult.success,
                filePath,
                lineNumber,
                probeType,
                message,
                confirmation: injectResult.message,
                insertedCode: injectResult.insertedCode
              };
              
              // Добавляем результаты проверки синтаксиса, если они есть
              if (injectResult.syntaxCheck) {
                response.syntaxCheck = injectResult.syntaxCheck;
                
                // Если есть синтаксические ошибки, помечаем как предупреждение
                if (!injectResult.syntaxCheck.passed) {
                  response.warning = 'Syntax errors detected after probe injection. Please review the code.';
                }
              }
              
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify(response)
                }]
              };
            } catch (injectError) {
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: injectError instanceof Error ? injectError.message : String(injectError),
                    errorCode: 'INJECTION_FAILED',
                    filePath,
                    lineNumber,
                    probeType
                  })
                }],
                isError: true
              };
            }
            break;
          }

          case 'inject_multiple_probes': {
            const { probes } = args as { probes: Array<{
              filePath: string;
              lineNumber: number;
              probeType: 'log' | 'trace' | 'error';
              message?: string;
              probeCode?: string;
              hypothesisId?: string;
            }> };
            
            if (!probes || !Array.isArray(probes) || probes.length === 0) {
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: 'Missing or invalid probes parameter (must be a non-empty array)',
                    errorCode: 'MISSING_PARAMETERS'
                  })
                }],
                isError: true
              };
              break;
            }

            // Валидируем каждую пробу
            let validationError: CallToolResult | null = null;
            for (let i = 0; i < probes.length; i++) {
              const probe = probes[i];
              if (!probe.filePath || typeof probe.filePath !== 'string') {
                validationError = {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      error: `Probe ${i + 1}: Missing or invalid filePath parameter`,
                      errorCode: 'MISSING_PARAMETERS',
                      probeIndex: i
                    })
                  }],
                  isError: true
                };
                break;
              }
              
              if (probe.lineNumber === undefined || probe.lineNumber === null || typeof probe.lineNumber !== 'number' || isNaN(probe.lineNumber) || probe.lineNumber < 1) {
                validationError = {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      error: `Probe ${i + 1}: Missing or invalid lineNumber parameter`,
                      errorCode: 'MISSING_PARAMETERS',
                      probeIndex: i
                    })
                  }],
                  isError: true
                };
                break;
              }
              
              if (!probe.probeType || typeof probe.probeType !== 'string' || !['log', 'trace', 'error'].includes(probe.probeType)) {
                validationError = {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      error: `Probe ${i + 1}: Invalid probeType (must be log, trace, or error)`,
                      errorCode: 'INVALID_PROBE_TYPE',
                      probeIndex: i
                    })
                  }],
                  isError: true
                };
                break;
              }
            }

            // Если была ошибка валидации, возвращаем её
            if (validationError) {
              result = validationError;
              break;
            }

            // Вставляем все пробы последовательно
            const injectionResults: any[] = [];
            let allSuccess = true;
            let hasSyntaxErrors = false;

            for (let i = 0; i < probes.length; i++) {
              const probe = probes[i];
              try {
                const normalizedProbeCode = (probe.probeCode && typeof probe.probeCode === 'string' && probe.probeCode.trim().length > 0) ? probe.probeCode : undefined;
                const normalizedHypothesisId = (probe.hypothesisId && typeof probe.hypothesisId === 'string' && probe.hypothesisId.trim().length > 0) ? probe.hypothesisId.trim() : undefined;
                const normalizedMessage = (probe.message && typeof probe.message === 'string') ? probe.message : (normalizedProbeCode ? 'Custom probe code' : 'Debug probe');
                
                const injectResult = await this.injectProbeWithRetry(
                  probe.filePath,
                  probe.lineNumber,
                  probe.probeType,
                  normalizedMessage,
                  normalizedProbeCode,
                  normalizedHypothesisId
                );

                injectionResults.push({
                  success: injectResult.success,
                  filePath: probe.filePath,
                  lineNumber: probe.lineNumber,
                  probeType: probe.probeType,
                  message: normalizedMessage,
                  confirmation: injectResult.message,
                  insertedCode: injectResult.insertedCode,
                  syntaxCheck: injectResult.syntaxCheck
                });

                if (!injectResult.success) {
                  allSuccess = false;
                }
                if (injectResult.syntaxCheck && !injectResult.syntaxCheck.passed) {
                  hasSyntaxErrors = true;
                }
              } catch (injectError) {
                allSuccess = false;
                injectionResults.push({
                  success: false,
                  filePath: probe.filePath,
                  lineNumber: probe.lineNumber,
                  probeType: probe.probeType,
                  error: injectError instanceof Error ? injectError.message : String(injectError)
                });
              }
            }

            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: allSuccess,
                  message: `Inserted ${injectionResults.filter(r => r.success).length} of ${probes.length} probes`,
                  results: injectionResults,
                  totalProbes: probes.length,
                  successfulProbes: injectionResults.filter(r => r.success).length,
                  failedProbes: injectionResults.filter(r => !r.success).length,
                  hasSyntaxErrors: hasSyntaxErrors,
                  warning: hasSyntaxErrors ? 'Some probes have syntax errors. Please review the code.' : undefined
                })
              }]
            };
            break;
          }

          case 'show_user_instructions': {
            const { instructions, stepNumber } = args as { instructions: string; stepNumber?: number };
            
            if (!instructions || typeof instructions !== 'string') {
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: 'Missing or invalid instructions parameter (must be a non-empty string)',
                    errorCode: 'MISSING_PARAMETERS'
                  })
                }],
                isError: true
              };
              break;
            }

            // Возвращаем структурированное сообщение для бота
            // Бот должен показать это пользователю в чате и вызвать команду VS Code для показа кнопок
            const stepNum = stepNumber || 1;
            const userMessage = `## 📋 Шаг ${stepNum}: Инструкции по отладке

${instructions}

**Следующие шаги:**
1. Запустите код и воспроизведите ошибку
2. Выполните действия, которые вызывают проблему  
3. После завершения работы кода нажмите одну из кнопок ниже:
   - **"Продолжить"** - для анализа собранных логов
   - **"Проблема устранена"** - если проблема решена и нужно очистить сессию

**Ожидаю вашего подтверждения перед продолжением анализа.**`;
            
            // Пытаемся вызвать команду VS Code для показа всплывающего сообщения с кнопками
            // Но так как мы в MCP сервере, мы не можем напрямую вызвать VS Code API
            // Поэтому возвращаем инструкции для бота, который должен показать сообщение и вызвать команду
            result = {
              content: [{
                type: 'text',
                // Возвращаем как markdown с инструкциями для бота показать пользователю
                // Бот должен показать это сообщение в чате и объяснить пользователю что делать
                text: userMessage + '\n\n**Примечание для бота:** После показа этого сообщения пользователю, объясните что нужно запустить код и воспроизвести ошибку. После завершения работы кода пользователь должен сообщить вам "Продолжить" для анализа логов или "Проблема устранена" если проблема решена.'
              }]
            };
            break;
          }

          default:
            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: `Unknown tool: ${name}`,
                  errorCode: 'UNKNOWN_TOOL'
                })
              }],
              isError: true
            };
        }

        const duration = Date.now() - startTime;
        this.logMCPResponse(`call_tool:${name}`, result, duration);
        return result;

      } catch (error) {
        const duration = Date.now() - startTime;
        this.logMCPError(`call_tool:${name}`, error, duration);
        
        // Возвращаем структурированный error response вместо throw
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
              errorCode: 'INTERNAL_ERROR',
              tool: name
            })
          }],
          isError: true
        };
      }
    });

    // Запуск сервера через stdio
    const transport = new StdioServerTransport();
    try {
      await this.server.connect(transport);
      logInfo('RooTrace MCP server запущен', 'RooTraceMCPHandler.start');
    } catch (error) {
      handleError(error, 'RooTraceMCPHandler.start', { action: 'connectTransport' });
      throw error;
    }
    
  }

  /**
   * Останавливает MCP-сервер RooTrace
   */
  async stop(): Promise<void> {
    try {
      if (this.server) {
        // В stdio режиме сервер не имеет метода close
        // Но мы можем очистить состояние и логировать остановку
        logInfo('MCP Server stopping...', 'RooTraceMCPHandler.stop');
        
        // Опционально: сохранить состояние или очистить ресурсы
        // В данном случае просто очищаем ссылку на сервер
        this.server = null;
        
        logInfo('MCP Server stopped', 'RooTraceMCPHandler.stop');
      }
    } catch (error) {
      handleError(error, 'RooTraceMCPHandler.stop', { action: 'stopServer' });
      throw error;
    }
  }

  /**
   * Добавляет лог в сессию отладки
   * @deprecated Используйте SharedLogStorage.getInstance().addLog() напрямую
   */
  async addLog(hypothesisId: string, context: string, data: LogData): Promise<void> {
    const log: RuntimeLog = {
      timestamp: new Date().toISOString(),
      hypothesisId,
      context,
      data
    };
    await sharedStorage.addLog(log);
  }

  /**
   * Логирует MCP запрос
   */
  private logMCPRequest(method: string, params: any): void {
    logDebug(`Request: ${method}`, 'RooTraceMCPHandler', { method, params });
  }

  /**
   * Логирует MCP ответ
   */
  private logMCPResponse(method: string, response: any, duration: number): void {
    logDebug(`Response: ${method} (${duration}ms)`, 'RooTraceMCPHandler', { method, duration });
  }

  /**
   * Логирует MCP ошибку
   */
  private logMCPError(method: string, error: any, duration: number): void {
    handleError(error, 'RooTraceMCPHandler', { 
      method, 
      duration,
      action: 'mcpRequest'
    });
  }

  /**
   * Инъекция пробы с retry механизмом для временных ошибок
   */
  private async injectProbeWithRetry(
    filePath: string,
    lineNumber: number,
    probeType: 'log' | 'trace' | 'error',
    message: string | undefined,
    probeCode?: string,
    hypothesisId?: string,
    maxRetries: number = 3,
    retryDelay: number = 100
  ): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await injectProbe(filePath, lineNumber, probeType, message || '', probeCode, hypothesisId);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Проверяем, является ли ошибка временной (например, файл заблокирован)
        const isTemporaryError = this.isTemporaryError(lastError);
        
        if (!isTemporaryError || attempt === maxRetries - 1) {
          throw lastError;
        }

        // Ждем перед повторной попыткой
        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
        logDebug(`Retry attempt ${attempt + 1}/${maxRetries} for inject_probe`, 'RooTraceMCPHandler', {
          attempt: attempt + 1,
          maxRetries,
          filePath
        });
      }
    }

    throw lastError || new Error('Unknown error in injectProbeWithRetry');
  }

  /**
   * Определяет, является ли ошибка временной
   */
  private isTemporaryError(error: Error): boolean {
    const temporaryErrorPatterns = [
      /ENOENT/, // File not found (может быть временным)
      /EACCES/, // Permission denied (может быть временным)
      /EBUSY/,  // Resource busy
      /ETIMEDOUT/, // Timeout
      /ECONNRESET/ // Connection reset
    ];

    return temporaryErrorPatterns.some(pattern => pattern.test(error.message));
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
