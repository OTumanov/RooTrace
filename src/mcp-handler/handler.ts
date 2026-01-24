/**
 * Основной класс для обработки MCP-запросов RooTrace
 * 
 * Этот класс является оркестратором, который регистрирует обработчики
 * и делегирует выполнение соответствующим модулям.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  InitializeRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  CallToolResult,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { SharedLogStorage } from '../shared-log-storage';
import { ContextMonitor } from '../context-monitor';
import { MessageQueue } from '../message-queue';
import { handleError, logInfo, logDebug } from '../error-handler';
import { MCP_TOOL_SCHEMAS } from './tool-schemas';
import { HandlerContext } from './handlers/base-handler';

// Импорты для обработчиков запросов
import { handleInitialize } from './request-handlers';
import { handleListTools } from './request-handlers';

// Импорты для обработчиков ресурсов
import { handleListResources } from './resources';
import { handleReadResource } from './resources';

// Импорты для обработчиков инструментов
import {
  handleReadRuntimeLogs,
  handleClearLogs,
  handleGetDebugStatus,
  handleClearSession,
  handleInjectProbes,
  handleInjectMultipleProbes,
  handleShowUserInstructions,
  handleReadFile,
  handleGetProblems,
  handleLoadRule
} from './handlers';

// Импорты утилит
import { getWorkspaceRoot } from '../utils';
import { normalizeFilePath, isPythonFile, findGitRoot, findFilesWithProbes } from './file-utils';
import { getRootraceFilePath } from '../rootrace-dir-utils';
import { injectProbe, getAllProbes, removeAllProbesFromFile, getServerUrl } from '../code-injector';
import { testServerWriteRead } from './server-utils';
import { checkReadRuntimeLogsApproval, checkGitCommitBeforeEdit } from './security';
import { injectProbeWithRetry } from './injection-utils';
import { RulesLoader } from '../rules-loader';

// Глобальные экземпляры (singletons)
const sharedStorage = SharedLogStorage.getInstance();
const contextMonitor = ContextMonitor.getInstance();

/**
 * Основной класс для обработки MCP-запросов
 */
export class RooTraceMCPHandler {
  private server: Server | null = null;
  private startTime: number = Date.now();
  private committedFiles: Set<string> = new Set();
  private messageQueue = MessageQueue.getInstance();

  constructor() {
    // Инициализация
  }

  /**
   * Запускает MCP-сервер RooTrace
   */
  async start(): Promise<void> {
    // Инициализация мониторинга контекста
    contextMonitor.setConfig({
      maxAnomalyScore: 50,
      maxMessages: 1000,
      maxToolCalls: 500,
      resetOnAnomalyThreshold: true
    });
    
    // Устанавливаем callback для автоматического сброса сессии
    contextMonitor.setResetCallback((reason: string, sessionId: string) => {
      logInfo(`[MCP] Auto-resetting session ${sessionId} due to: ${reason}`, 'RooTraceMCPHandler');
      contextMonitor.resetSession(sessionId);
    });
    
    // Настройка инструментов MCP
    const tools = MCP_TOOL_SCHEMAS;

    // Создание сервера
    this.server = new Server(
      { name: 'RooTrace', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {} } }
    );

    // Регистрация обработчиков запросов
    this.registerRequestHandlers();
    
    // Регистрация обработчиков ресурсов
    this.registerResourceHandlers();
    
    // Регистрация обработчиков инструментов
    this.registerToolHandlers();

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
   * Останавливает MCP-сервер
   */
  async stop(): Promise<void> {
    try {
      if (this.server) {
        logInfo('MCP Server stopping...', 'RooTraceMCPHandler.stop');
        this.server = null;
        logInfo('MCP Server stopped', 'RooTraceMCPHandler.stop');
      }
    } catch (error) {
      handleError(error, 'RooTraceMCPHandler.stop', { action: 'stopServer' });
      throw error;
    }
  }

  /**
   * Создает контекст для обработчиков
   */
  private createHandlerContext(): HandlerContext {
    return {
      sharedStorage,
      contextMonitor,
      messageQueue: this.messageQueue,
      getWorkspaceRoot,
      normalizeFilePath,
      isPythonFile,
      findGitRoot,
      getRootraceFilePath,
      injectProbe,
      getAllProbes,
      removeAllProbesFromFile,
      getServerUrl,
      testServerWriteRead: async (serverUrl: string): Promise<{ success: boolean; error?: string }> => {
        const result = await testServerWriteRead(serverUrl, sharedStorage);
        return result;
      },
      checkReadRuntimeLogsApproval: () => checkReadRuntimeLogsApproval(getRootraceFilePath),
      checkGitCommitBeforeEdit: async (filePath: string): Promise<{ allowed: boolean; error?: string }> => {
        return checkGitCommitBeforeEdit(filePath, this.committedFiles, findGitRoot);
      },
      injectProbeWithRetry: async (
        filePath: string,
        lineNumber: number,
        probeType: 'log' | 'trace' | 'error',
        message: string | undefined,
        probeCode?: string,
        hypothesisId?: string
      ) => {
        return injectProbeWithRetry(
          {
            filePath,
            lineNumber,
            probeType,
            message,
            probeCode,
            hypothesisId
          },
          injectProbe
        );
      },
      findFilesWithProbes,
      loadRule: async (rulePath: string) => {
        return RulesLoader.loadSpecificRule(rulePath);
      },
      startTime: this.startTime,
      committedFiles: this.committedFiles
    };
  }

  /**
   * Регистрирует обработчики базовых MCP запросов
   */
  private registerRequestHandlers(): void {
    if (!this.server) return;

    // Обработка Initialize Request
    this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      return handleInitialize(request);
    });

    // Обработка ListTools Request
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      return handleListTools(request);
    });
  }

  /**
   * Регистрирует обработчики ресурсов
   */
  private registerResourceHandlers(): void {
    if (!this.server) return;

    // Обработка ListResources Request
    this.server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
      return handleListResources(request, getWorkspaceRoot);
    });

    // Обработка ReadResource Request
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return handleReadResource(request, sharedStorage, getWorkspaceRoot, this.startTime);
    });
  }

  /**
   * Регистрирует обработчики инструментов
   */
  private registerToolHandlers(): void {
    if (!this.server) return;

    const tools = MCP_TOOL_SCHEMAS;
    const context = this.createHandlerContext();

    // Обработка вызовов инструментов
    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const startTime = Date.now();
      const { name, arguments: args = {} } = request.params;
      logDebug(`[MCP] Tool call: ${name}`, 'RooTraceMCPHandler');

      // Получаем sessionId из аргументов или используем дефолтный
      const sessionId = (args as any)?.sessionId || 'default';
      
      // Валидация и мониторинг входящего вызова инструмента
      const validation = contextMonitor.validateAndMonitorToolCall(sessionId, name, args, false);
      if (!validation.valid) {
        logDebug(`[MCP] Tool call validation failed: ${validation.validation.errors.join(', ')}`);
      }
      if (validation.shouldReset) {
        logDebug(`[MCP] Session ${sessionId} should be reset due to anomalies`);
        contextMonitor.resetSession(sessionId);
      }

      try {
        let result: CallToolResult;

        // ПРОСТОЕ ПРЯМОЕ СРАВНЕНИЕ: ищем инструмент по точному имени (case-insensitive)
        const nameLower = name.toLowerCase();
        const matchingTool = tools.find(t => t.name.toLowerCase() === nameLower);
        
        if (!matchingTool) {
          const availableTools = tools.map(t => t.name);
          logDebug(`[MCP] Tool name not found: "${name}". Available tools: ${availableTools.join(', ')}`);
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Unknown tool: ${name}`,
                errorCode: 'UNKNOWN_TOOL',
                availableTools: availableTools,
                suggestion: `Did you mean one of: ${availableTools.slice(0, 3).join(', ')}? Use the exact tool name from availableTools list.`
              })
            }],
            isError: true
          };
          const duration = Date.now() - startTime;
          logDebug(`[MCP] Tool call ${name} completed in ${duration}ms`, 'RooTraceMCPHandler');
          return result;
        }
        
        const actualToolName = matchingTool.name;
        logDebug(`[MCP] Tool name matched: "${name}" -> "${actualToolName}"`);

        // Вызываем соответствующий обработчик
        switch (actualToolName) {
          case 'read_runtime_logs':
            result = await handleReadRuntimeLogs(args, context);
            break;
          
          case 'clear_logs':
            result = await handleClearLogs(args, context);
            break;
          
          case 'get_debug_status':
            result = await handleGetDebugStatus(args, context);
            break;
          
          case 'clear_session':
            result = await handleClearSession(args, context);
            break;
          
          case 'inject_probes':
            result = await handleInjectProbes(args, context);
            break;
          
          case 'inject_multiple_probes':
            result = await handleInjectMultipleProbes(args, context);
            break;
          
          case 'show_user_instructions':
            result = await handleShowUserInstructions(args, context);
            break;
          
          case 'read_file':
            result = await handleReadFile(args, context);
            break;
          
          case 'get_problems':
            result = await handleGetProblems(args, context);
            break;
          
          case 'load_rule':
            result = await handleLoadRule(args, context);
            break;
          
          default:
            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: `Handler not implemented for tool: ${actualToolName}`,
                  errorCode: 'HANDLER_NOT_IMPLEMENTED'
                })
              }],
              isError: true
            };
        }

        const duration = Date.now() - startTime;
        logDebug(`[MCP] Tool call ${name} completed in ${duration}ms`, 'RooTraceMCPHandler');
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        handleError(error, 'RooTraceMCPHandler.callTool', { toolName: name, duration });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
              errorCode: 'TOOL_EXECUTION_ERROR'
            })
          }],
          isError: true
        };
      }
    });
  }

  /**
   * @deprecated Используйте SharedLogStorage.getInstance().addLog() напрямую
   */
  async addLog(hypothesisId: string, context: string, data: any): Promise<void> {
    const log = {
      timestamp: new Date().toISOString(),
      hypothesisId,
      context,
      data
    };
    await sharedStorage.addLog(log);
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
