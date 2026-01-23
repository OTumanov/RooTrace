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
import { injectProbe, getAllProbes, removeAllProbesFromFile, getServerUrl } from './code-injector';
import { SharedLogStorage, RuntimeLog, Hypothesis } from './shared-log-storage';
import { handleError, logInfo, logDebug } from './error-handler';
import { LogData } from './types';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getRootraceFilePath } from './rootrace-dir-utils';
import { RulesLoader } from './rules-loader';
import { ContextMonitor } from './context-monitor';
import { MessageQueue } from './message-queue';
import { MCP_TOOL_SCHEMAS } from './mcp-handler/tool-schemas';
import { getWorkspaceRoot, normalizeFilePath as utilsNormalizeFilePath, findGitRoot } from './utils';

const execAsync = promisify(exec);

// Используем shared log storage вместо изолированного debugSession
const sharedStorage = SharedLogStorage.getInstance();

// Мониторинг контекста для защиты от отравления
const contextMonitor = ContextMonitor.getInstance();

// Основной класс для обработки MCP-запросов
export class RooTraceMCPHandler {
  private server: Server | null = null;
  private startTime: number = Date.now();
  private committedFiles: Set<string> = new Set(); // Трекер файлов, для которых был сделан коммит
  private messageQueue = MessageQueue.getInstance(); // Очередь сообщений для обработки queued запросов
  private static readonly READ_LOGS_APPROVAL_FILE = 'allow-read-runtime-logs.json';
  private static readonly READ_LOGS_APPROVAL_MAX_AGE_MS = 2 * 60 * 1000; // 2 minutes
  private static readonly AUTO_DEBUG_APPROVAL_FILE = 'allow-auto-debug.json';
  private static readonly AUTO_DEBUG_APPROVAL_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes (user-granted)

  constructor() {
    // EventEmitter удален, так как не использовался
  }

  private getWorkspaceRootForFiles(): string {
    // Используем общую утилиту для получения workspace root
    return getWorkspaceRoot();
  }

  /**
   * Разрешение на чтение логов должно приходить ТОЛЬКО от пользователя (кнопкой в UI).
   * MCP-сервер не должен позволять агенту дергать read_runtime_logs самостоятельно.
   */
  private checkReadRuntimeLogsApproval(): { allowed: boolean; reason?: string } {
    try {
      // Long-lived (but expiring) user grant: allow the agent to read logs without pressing the button each time.
      // This is still a USER action (granted via popup button), just less strict for hands-free debugging.
      const autoPath = getRootraceFilePath(RooTraceMCPHandler.AUTO_DEBUG_APPROVAL_FILE);
      if (fs.existsSync(autoPath)) {
        try {
          const rawAuto = fs.readFileSync(autoPath, 'utf8');
          const dataAuto = JSON.parse(rawAuto) as { approvedAt?: string; approvedAtMs?: number };
          const approvedAtMsAuto =
            typeof dataAuto.approvedAtMs === 'number'
              ? dataAuto.approvedAtMs
              : (dataAuto.approvedAt ? Date.parse(dataAuto.approvedAt) : NaN);
          if (Number.isFinite(approvedAtMsAuto)) {
            const ageAuto = Date.now() - approvedAtMsAuto;
            if (ageAuto >= 0 && ageAuto <= RooTraceMCPHandler.AUTO_DEBUG_APPROVAL_MAX_AGE_MS) {
              return { allowed: true };
            }
          }
        } catch {
          // ignore malformed auto grant; fall back to strict gate
        }
      }

      const approvalPath = getRootraceFilePath(RooTraceMCPHandler.READ_LOGS_APPROVAL_FILE);
      if (!fs.existsSync(approvalPath)) {
        return { allowed: false, reason: 'No user approval file present' };
      }
      const raw = fs.readFileSync(approvalPath, 'utf8');
      const data = JSON.parse(raw) as { approvedAt?: string; approvedAtMs?: number };
      const approvedAtMs =
        typeof data.approvedAtMs === 'number'
          ? data.approvedAtMs
          : (data.approvedAt ? Date.parse(data.approvedAt) : NaN);
      if (!Number.isFinite(approvedAtMs)) {
        return { allowed: false, reason: 'Approval file malformed' };
      }
      const age = Date.now() - approvedAtMs;
      if (age < 0 || age > RooTraceMCPHandler.READ_LOGS_APPROVAL_MAX_AGE_MS) {
        return { allowed: false, reason: `Approval expired (ageMs=${age})` };
      }
      return { allowed: true };
    } catch (e) {
      return { allowed: false, reason: `Approval check error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * Проверяет, является ли файл Python файлом
   */
  private isPythonFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.py' || ext === '.pyw' || ext === '.pyi';
  }

  /**
   * Нормализует путь файла, удаляя символ @ в начале (формат @/path/to/file из Roo Code mentions)
   * Использует общую утилиту из utils/file-path-utils
   */
  private normalizeFilePath(filePath: string): string {
    return utilsNormalizeFilePath(filePath);
  }

  /**
   * Находит корень git репозитория
   * Использует общую утилиту из utils/git-utils
   */
  private async findGitRoot(filePath: string): Promise<string | null> {
    return findGitRoot(filePath);
  }

  /**
   * Проверяет, был ли сделан git commit или .bak копия перед редактированием файла
   * Согласно промпту, коммит или .bak копия должны быть созданы ОДИН РАЗ перед первым изменением
   */
  private async checkGitCommitBeforeEdit(filePath: string): Promise<{ allowed: boolean; error?: string }> {
    // Если файл уже был закоммичен/скопирован в этой сессии, разрешаем
    if (this.committedFiles.has(filePath)) {
      return { allowed: true };
    }

    const gitRoot = await this.findGitRoot(filePath);
    const bakFilePath = `${filePath}.bak`;
    const bakExists = fs.existsSync(bakFilePath);

    // Если нет git репозитория - проверяем .bak копию
    if (!gitRoot) {
      if (bakExists) {
        // .bak копия существует - разрешаем
        this.committedFiles.add(filePath);
        return { allowed: true };
      } else {
        // Нет ни git, ни .bak - требуем создать .bak
        return {
          allowed: false,
          error: `File ${filePath} is not in a git repository and has no backup. According to protocol, you MUST create a backup copy before editing: cp "${filePath}" "${bakFilePath}". This is a safety requirement for rollback capability.`
        };
      }
    }

    // Есть git репозиторий - проверяем коммит
    try {
      // Проверяем, есть ли незакоммиченные изменения в файле
      const relativePath = path.relative(gitRoot, filePath);
      const { stdout } = await execAsync(`cd "${gitRoot}" && git status --porcelain "${relativePath}"`, { timeout: 5000 });
      
      if (stdout.trim()) {
        // Есть изменения - требуем коммит (или .bak как альтернатива)
        if (bakExists) {
          // .bak копия существует - разрешаем
          this.committedFiles.add(filePath);
          return { allowed: true };
        } else {
          // Нет коммита и нет .bak - требуем одно из двух
          return {
            allowed: false,
            error: `File ${relativePath} has uncommitted changes and no backup. According to protocol, you MUST either: (1) commit the file: git add . && git commit -m "AI Debugger: Pre-instrumentation backup", OR (2) create a backup copy: cp "${filePath}" "${bakFilePath}". This is a safety requirement.`
          };
        }
      }

      // Файл чистый - разрешаем и помечаем как закоммиченный
      this.committedFiles.add(filePath);
      return { allowed: true };
    } catch (error) {
      // If git command fails, check for .bak as fallback
      if (bakExists) {
        this.committedFiles.add(filePath);
        return { allowed: true };
      }
      // Если git команда не работает и нет .bak, разрешаем (но логируем)
      console.warn(`[RooTrace] Git check failed for ${filePath}:`, error);
      return { allowed: true };
    }
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
      // Сбрасываем мониторинг (сессия будет пересоздана при следующем запросе)
      contextMonitor.resetSession(sessionId);
    });
    
    // Настройка инструментов MCP (JSON Schema формат)
    // Схемы вынесены в отдельный файл для лучшей организации кода
    const tools = MCP_TOOL_SCHEMAS;

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
            tools: {},
            resources: {}
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

    // Обработка списка ресурсов
    this.server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
      const startTime = Date.now();
      this.logMCPRequest('list_resources', request.params);
      
      try {
        const workspaceRoot = this.getWorkspaceRootForFiles();
        const resources = [
          {
            uri: 'roo-trace://logs',
            name: 'Runtime Logs',
            description: 'Runtime logs from debugging session',
            mimeType: 'application/json'
          },
          {
            uri: 'roo-trace://status',
            name: 'Debug Status',
            description: 'Current debug status including server status and active hypotheses',
            mimeType: 'application/json'
          },
          {
            uri: 'roo-trace://rules',
            name: 'Rule Modules',
            description: 'List of available rule modules in .roo/roo-trace-rules/',
            mimeType: 'application/json'
          }
        ];

        // Добавляем ресурсы для конкретных модулей правил, если они существуют
        if (workspaceRoot) {
          const rulesDir = path.join(workspaceRoot, '.roo', 'roo-trace-rules');
          if (fs.existsSync(rulesDir)) {
            try {
              const ruleFiles = fs.readdirSync(rulesDir)
                .filter(file => file.endsWith('.md'))
                .slice(0, 50); // Ограничение на количество ресурсов
              
              for (const ruleFile of ruleFiles) {
                resources.push({
                  uri: `roo-trace://rule/${ruleFile}`,
                  name: `Rule: ${ruleFile}`,
                  description: `Rule module: ${ruleFile}`,
                  mimeType: 'text/markdown'
                });
              }
            } catch (error) {
              logDebug(`[MCP] Failed to list rule files: ${error}`);
            }
          }
        }

        const response = { resources };
        const duration = Date.now() - startTime;
        this.logMCPResponse('list_resources', response, duration);
        return response;
      } catch (error) {
        const duration = Date.now() - startTime;
        this.logMCPError('list_resources', error, duration);
        throw error;
      }
    });

    // Обработка чтения ресурсов
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const startTime = Date.now();
      const { uri } = request.params;
      this.logMCPRequest('read_resource', { uri });
      
      try {
        const workspaceRoot = this.getWorkspaceRootForFiles();
        
        if (uri === 'roo-trace://logs') {
          // Возвращаем логи
          const logs = await sharedStorage.getLogs();
          const response = {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(logs, null, 2)
            }]
          };
          const duration = Date.now() - startTime;
          this.logMCPResponse('read_resource', response, duration);
          return response;
        } else if (uri === 'roo-trace://status') {
          // Возвращаем статус отладки
          const logs = await sharedStorage.getLogs();
          const hypotheses = await sharedStorage.getHypotheses();
          const serverUrl = getServerUrl(workspaceRoot);
          
          // Подсчитываем количество логов для каждой гипотезы
          const hypothesisLogCounts = new Map<string, number>();
          for (const log of logs) {
            const count = hypothesisLogCounts.get(log.hypothesisId) || 0;
            hypothesisLogCounts.set(log.hypothesisId, count + 1);
          }
          
          const status = {
            serverUrl: serverUrl || null,
            serverActive: !!serverUrl,
            logsCount: logs.length,
            hypothesesCount: hypotheses.length,
            hypotheses: hypotheses.map(h => ({
              id: h.id,
              description: h.description,
              status: h.status,
              logsCount: hypothesisLogCounts.get(h.id) || 0
            })),
            uptime: Date.now() - this.startTime
          };
          const response = {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(status, null, 2)
            }]
          };
          const duration = Date.now() - startTime;
          this.logMCPResponse('read_resource', response, duration);
          return response;
        } else if (uri === 'roo-trace://rules') {
          // Возвращаем список доступных модулей правил
          const rulesList: string[] = [];
          if (workspaceRoot) {
            const rulesDir = path.join(workspaceRoot, '.roo', 'roo-trace-rules');
            if (fs.existsSync(rulesDir)) {
              try {
                const ruleFiles = fs.readdirSync(rulesDir)
                  .filter(file => file.endsWith('.md'))
                  .sort();
                rulesList.push(...ruleFiles);
              } catch (error) {
                logDebug(`[MCP] Failed to list rule files: ${error}`);
              }
            }
          }
          const response = {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({ rules: rulesList }, null, 2)
            }]
          };
          const duration = Date.now() - startTime;
          this.logMCPResponse('read_resource', response, duration);
          return response;
        } else if (uri.startsWith('roo-trace://rule/')) {
          // Возвращаем содержимое конкретного модуля правила
          const ruleName = uri.replace('roo-trace://rule/', '');
          if (!workspaceRoot) {
            throw new Error('Workspace root not found');
          }
          const rulePath = path.join(workspaceRoot, '.roo', 'roo-trace-rules', ruleName);
          
          // Проверка безопасности: только файлы из .roo/roo-trace-rules/
          const normalizedPath = path.normalize(rulePath);
          const rulesDir = path.normalize(path.join(workspaceRoot, '.roo', 'roo-trace-rules'));
          if (!normalizedPath.startsWith(rulesDir)) {
            throw new Error(`Invalid rule path: ${ruleName}`);
          }
          
          if (!fs.existsSync(rulePath)) {
            throw new Error(`Rule not found: ${ruleName}`);
          }
          
          const content = fs.readFileSync(rulePath, 'utf8');
          const response = {
            contents: [{
              uri,
              mimeType: 'text/markdown',
              text: content
            }]
          };
          const duration = Date.now() - startTime;
          this.logMCPResponse('read_resource', response, duration);
          return response;
        } else {
          throw new Error(`Unknown resource URI: ${uri}`);
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        this.logMCPError('read_resource', error, duration);
        throw error;
      }
    });

    // Обработка вызовов инструментов
    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const startTime = Date.now();
      const { name, arguments: args = {} } = request.params;
      this.logMCPRequest(`call_tool:${name}`, args);

      // Получаем sessionId из аргументов или используем дефолтный
      const sessionId = (args as any)?.sessionId || 'default';
      
      // Валидация и мониторинг входящего вызова инструмента
      const validation = contextMonitor.validateAndMonitorToolCall(sessionId, name, args, false);
      if (!validation.valid) {
        logDebug(`[MCP] Tool call validation failed: ${validation.validation.errors.join(', ')}`);
        // Продолжаем выполнение, но логируем предупреждение
      }
      if (validation.shouldReset) {
        logDebug(`[MCP] Session ${sessionId} should be reset due to anomalies`);
        // Сбрасываем мониторинг, но продолжаем выполнение
        contextMonitor.resetSession(sessionId);
      }

      try {
        let result: CallToolResult;

        // Нормализуем имя инструмента для обработки различных форматов
        // Модель может преобразовывать двойные дефисы в одинарные или добавлять лишние символы
        let normalizedName = name
          .replace(/mcp___roo___trace___/g, 'mcp--roo-trace--') // Исправляем тройные подчёркивания
          .replace(/mcp--roo___trace--/g, 'mcp--roo-trace--') // Смешанные варианты с подчёркиваниями
          .replace(/mcp-roo-trace-/g, 'mcp--roo-trace--') // Восстанавливаем двойные дефисы из одинарных
          .replace(/mcp--roo-trace--mcp--roo-trace--/g, 'mcp--roo-trace--') // Убираем дублирование
          .replace(/--+/g, '--') // Убираем множественные дефисы
          .replace(/___+/g, '_') // Убираем множественные подчёркивания
          .trim();
        
        // Логируем нормализацию для отладки
        if (normalizedName !== name) {
          logDebug(`[MCP] Tool name normalized: "${name}" -> "${normalizedName}"`);
        }

        switch (normalizedName) {
          case 'read_runtime_logs': {
            const { sessionId } = args as { sessionId?: string };
            // Проверяем, является ли запрос queued сообщением (неявное одобрение)
            const queued = (args as any).__queued === true;
            if (!queued) {
              const approval = this.checkReadRuntimeLogsApproval();
              if (!approval.allowed) {
                result = {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      errorCode: 'FORBIDDEN_USER_ACTION_REQUIRED',
                      error: 'FORBIDDEN: read_runtime_logs must be triggered by the USER via button (dashboard/popup).',
                      reason: approval.reason || 'not approved',
                      requiredAction: 'Click the "Read logs" / "Logs ready" button in VS Code UI.'
                    })
                  }],
                  isError: true
                };
                break;
              }
            }
            // Принудительно перезагружаем логи из файла перед чтением (для синхронизации с HTTP сервера)
            await sharedStorage.reloadLogsFromFile();
            const logs = await sharedStorage.getLogs();
            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  logs,
                  count: logs.length,
                  sessionId: sessionId || 'current',
                  queued: queued // возвращаем признак queued для отладки
                })
              }]
            };
            break;
          }

          case 'clear_logs': {
            try {
              await sharedStorage.clear();
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Logs cleared.',
                    clearedAt: new Date().toISOString()
                  })
                }]
              };
            } catch (e) {
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    errorCode: 'CLEAR_LOGS_FAILED',
                    error: e instanceof Error ? e.message : String(e)
                  })
                }],
                isError: true
              };
            }
            break;
          }

          case 'get_debug_status': {
            const hypotheses = sharedStorage.getHypotheses();
            const activeHypotheses = hypotheses.filter(h => h.status === 'active');
            
            // КРИТИЧНО: Проверяем работоспособность сервера через тестовую запись/чтение
            let serverStatus: 'active' | 'inactive' | 'error' = 'inactive';
            let serverTestResult: string | null = null;
            
            if (this.server) {
              try {
                // Получаем URL сервера
                const serverUrl = getServerUrl();
                if (!serverUrl) {
                  serverStatus = 'error';
                  serverTestResult = 'Server URL not found';
                } else {
                  // Выполняем тестовую запись/чтение
                  const testResult = await this.testServerWriteRead(serverUrl);
                  if (testResult.success) {
                    serverStatus = 'active';
                    serverTestResult = 'Server verified: write/read test passed';
                    logDebug('Server status check: write/read test passed', 'MCPHandler.get_debug_status');
                  } else {
                    serverStatus = 'error';
                    serverTestResult = `Server test failed: ${testResult.error}`;
                    logDebug(`Server status check failed: ${testResult.error}`, 'MCPHandler.get_debug_status');
                  }
                }
              } catch (error) {
                serverStatus = 'error';
                serverTestResult = `Server test error: ${error instanceof Error ? error.message : String(error)}`;
                handleError(error, 'MCPHandler.get_debug_status', { action: 'server_test' });
              }
            }
            
            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  serverStatus,
                  serverTestResult,
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
            const actualSessionId = sessionId || 'default';
            
            // Сбрасываем мониторинг контекста для этой сессии
            contextMonitor.resetSession(actualSessionId);
            
            try {
              // БЕЗОТКАЗНАЯ ОЧИСТКА: Собираем список файлов из всех источников
              const affectedFiles = new Set<string>();
              
              // 1. Получаем файлы из реестра проб (самый надежный источник)
              const allProbes = getAllProbes();
              for (const probe of allProbes) {
                if (probe.filePath && fs.existsSync(probe.filePath)) {
                  affectedFiles.add(probe.filePath);
                }
              }
              
              // 2. Получаем файлы из логов (может содержать пути)
              const logs = await sharedStorage.getLogs();
              logs.forEach(log => {
                if (log.context) {
                  // Пытаемся извлечь путь из context (формат может быть "file:line" или просто путь)
                  const contextStr = String(log.context);
                  if (contextStr.includes(':')) {
                    const filePath = contextStr.split(':')[0].trim();
                    if (filePath && fs.existsSync(filePath)) {
                      affectedFiles.add(filePath);
                    }
                  } else if (fs.existsSync(contextStr)) {
                    // Может быть просто путь
                    affectedFiles.add(contextStr);
                  }
                }
                // Также проверяем data на наличие filePath
                if (log.data && typeof log.data === 'object' && 'filePath' in log.data) {
                  const filePath = String(log.data.filePath);
                  if (filePath && fs.existsSync(filePath)) {
                    affectedFiles.add(filePath);
                  }
                }
              });
              
              // 3. Сканируем workspace на наличие файлов с маркерами RooTrace (если доступен)
              // Это опционально и может быть медленным, поэтому делаем только если нет других источников
              if (affectedFiles.size === 0) {
                // Пытаемся найти файлы с маркерами через рекурсивный поиск
                // Но только если у нас есть доступ к workspace
                try {
                  const workspaceRoot = this.getWorkspaceRootForFiles();
                  if (workspaceRoot && fs.existsSync(workspaceRoot)) {
                    const filesWithProbes = await this.findFilesWithProbes(workspaceRoot);
                    for (const file of filesWithProbes) {
                      affectedFiles.add(file);
                    }
                  }
                } catch (scanError) {
                  // Игнорируем ошибки сканирования - это опциональная функция
                  logDebug(`Workspace scan failed: ${scanError}`, 'RooTraceMCPHandler.clear_session');
                }
              }
              
              // Удаляем все пробы из каждого файла
              const removalResults: Array<{ file: string; success: boolean; message: string }> = [];
              for (const filePath of affectedFiles) {
                try {
                  // Проверяем, что файл существует и содержит маркеры перед попыткой удаления
                  if (!fs.existsSync(filePath)) {
                    removalResults.push({
                      file: filePath,
                      success: false,
                      message: `File not found: ${filePath}`
                    });
                    continue;
                  }
                  
                  // Быстрая проверка на наличие маркеров
                  const content = await fs.promises.readFile(filePath, 'utf8');
                  if (!content.includes('RooTrace [id:') && !content.includes('RooTrace[id:')) {
                    // Файл не содержит проб - пропускаем
                    continue;
                  }
                  
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
              const filesWithProbes = removalResults.filter(r => r.success || r.message.includes('probe')).length;
              
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: totalCount > 0 
                      ? `Проект очищен. Обработано ${totalCount} файлов, удалены пробы из ${successCount} файлов. Логи сброшены.`
                      : `Сессия очищена. Логи сброшены. Файлы с пробами не найдены (возможно, пробы уже удалены или были вставлены через apply_diff без регистрации).`,
                    sessionId: sessionId || 'current',
                    clearedAt: new Date().toISOString(),
                    probesRemoved: allProbes.length,
                    filesProcessed: totalCount,
                    filesWithProbesRemoved: successCount,
                    removalResults: removalResults
                  })
                }]
              };
            } catch (error) {
              // Если что-то пошло не так, все равно очищаем логи
              try {
                await sharedStorage.clear();
              } catch (clearError) {
                // Игнорируем ошибки очистки логов
              }
              
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: `Error during clear_session: ${error instanceof Error ? error.message : String(error)}`,
                    errorCode: 'CLEAR_SESSION_FAILED',
                    sessionId: sessionId || 'current',
                    note: 'Logs were cleared, but probe removal may have failed. Check removalResults for details.'
                  })
                }],
                isError: true
              };
            }
            break;
          }

          case 'inject_probes': {
            const { filePath: rawFilePath, lineNumber, probeType, message, probeCode, hypothesisId } = args as any;
            
            // Нормализуем путь (удаляем @ в начале, если есть)
            const filePath = rawFilePath ? this.normalizeFilePath(rawFilePath) : rawFilePath;
            
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

            // 🚫 КРИТИЧЕСКАЯ ПРОВЕРКА: ЗАПРЕТ inject_probes для Python файлов
            if (this.isPythonFile(filePath)) {
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: `FORBIDDEN: inject_probes is STRICTLY PROHIBITED for Python files (${filePath}). According to protocol, you MUST use Block Rewrite method (apply_diff) to replace entire function/block instead of point injection. This prevents IndentationError and maintains code structure.\n\n🛡️ CRITICAL: Before using apply_diff, you MUST create a backup: (1) If git repository: git add . && git commit -m "AI Debugger: Pre-instrumentation backup", OR (2) If no git: cp "${filePath}" "${filePath}.bak". This is a safety requirement to ensure rollback capability.`,
                    errorCode: 'FORBIDDEN_FOR_PYTHON',
                    filePath,
                    requiredMethod: 'apply_diff (Block Rewrite)',
                    requiredAction: 'git add . && git commit -m "AI Debugger: Pre-instrumentation backup" OR cp "${filePath}" "${filePath}.bak"'
                  })
                }],
                isError: true
              };
              break;
            }

            // 🛡️ SAFETY CHECK: Проверка коммита перед редактированием
            const commitCheck = await this.checkGitCommitBeforeEdit(filePath);
            if (!commitCheck.allowed) {
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: commitCheck.error,
                    errorCode: 'SAFETY_CHECK_FAILED',
                    filePath,
                    requiredAction: 'git add . && git commit -m "AI Debugger: Pre-instrumentation backup" OR cp "${filePath}" "${filePath}.bak"'
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
              
              // 🚫 КРИТИЧЕСКАЯ ПРОВЕРКА: ЗАПРЕТ inject_multiple_probes для Python файлов
              if (this.isPythonFile(probe.filePath)) {
                validationError = {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      error: `FORBIDDEN: inject_multiple_probes is STRICTLY PROHIBITED for Python files. Probe ${i + 1} targets Python file (${probe.filePath}). According to protocol, you MUST use Block Rewrite method (apply_diff) to replace entire function/block instead of multiple injections. This prevents IndentationError and maintains code structure.\n\n🛡️ CRITICAL: Before using apply_diff, you MUST create a backup: (1) If git repository: git add . && git commit -m "AI Debugger: Pre-instrumentation backup", OR (2) If no git: cp "${probe.filePath}" "${probe.filePath}.bak". This is a safety requirement to ensure rollback capability.`,
                      errorCode: 'FORBIDDEN_FOR_PYTHON',
                      probeIndex: i,
                      filePath: probe.filePath,
                      requiredMethod: 'apply_diff (Block Rewrite)',
                      requiredAction: 'git add . && git commit -m "AI Debugger: Pre-instrumentation backup" OR cp "${probe.filePath}" "${probe.filePath}.bak"'
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

            // 🛡️ SAFETY CHECK: Проверка коммита перед редактированием для всех уникальных файлов
            const uniqueFiles = [...new Set(probes.map(p => p.filePath))];
            let commitCheckError: CallToolResult | null = null;
            for (const filePath of uniqueFiles) {
              const commitCheck = await this.checkGitCommitBeforeEdit(filePath);
              if (!commitCheck.allowed) {
                commitCheckError = {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      error: commitCheck.error,
                      errorCode: 'SAFETY_CHECK_FAILED',
                      filePath,
                      requiredAction: 'git add . && git commit -m "AI Debugger: Pre-instrumentation backup" OR cp "${filePath}" "${filePath}.bak"'
                    })
                  }],
                  isError: true
                };
                break;
              }
            }
            
            // Если была ошибка проверки коммита, возвращаем её
            if (commitCheckError) {
              result = commitCheckError;
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

            // MCP-сервер не имеет доступа к VS Code UI. Поэтому пишем "UI event" в workspace,
            // а расширение (extension host) ловит изменение файла и показывает popup с кнопками.
            const stepNum = stepNumber || 1;
            const requestId = `ui_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const uiEvent = {
              type: 'show_user_instructions',
              requestId,
              stepNumber: stepNum,
              instructions,
              createdAt: new Date().toISOString()
            };

            const uiEventPath = getRootraceFilePath('ui.json');
            const uiResponsePath = getRootraceFilePath('ui-response.json');
            try {
              fs.writeFileSync(uiEventPath, JSON.stringify(uiEvent, null, 2), 'utf8');
            } catch (e) {
              // Если не удалось записать UI-event, деградируем в текстовый вывод
              const fallback = `## 📋 Шаг ${stepNum}: Инструкции по отладке\n\n${instructions}\n\n(Не удалось показать popup в VS Code: ${e instanceof Error ? e.message : String(e)})`;
              result = {
                content: [{ type: 'text', text: fallback }]
              };
              break;
            }

            // Ждём, пока пользователь нажмёт кнопку в VS Code (через response-файл).
            // По запросу пользователя увеличиваем ожидание минимум до 2 минут.
            const maxWaitMs = 2 * 60 * 1000;
            const pollIntervalMs = 200;
            const startWait = Date.now();

            let choice: string | null = null;
            while (Date.now() - startWait < maxWaitMs) {
              try {
                if (fs.existsSync(uiResponsePath)) {
                  const raw = fs.readFileSync(uiResponsePath, 'utf8');
                  if (raw && raw.trim().length > 0) {
                    const resp = JSON.parse(raw) as { requestId?: string; choice?: string | null };
                    if (resp?.requestId === requestId) {
                      choice = typeof resp.choice === 'string' ? resp.choice : null;
                      break;
                    }
                  }
                }
              } catch {
                // игнорируем временные ошибки чтения/парсинга во время записи
              }
              await new Promise(r => setTimeout(r, pollIntervalMs));
            }

            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: choice
                    ? 'User selected an option in VS Code popup.'
                    : 'Timed out waiting for user click in VS Code popup (2 minutes).',
                  requestId,
                  choice,
                  uiEventPath,
                  uiResponsePath
                })
              }]
            };
            break;
          }

          case 'read_file': {
            const { path: singlePath, paths, startLine, endLine, limit } = args as {
              path?: string;
              paths?: string[];
              startLine?: number;
              endLine?: number;
              limit?: number;
            };

            // Нормализуем пути: удаляем символ @ в начале, если он есть (формат @/path/to/file из Roo Code mentions)
            const normalizePath = (p: string): string => {
              return p.startsWith('@') ? p.substring(1) : p;
            };

            // Определяем список файлов для чтения
            let fileList: string[] = [];
            const maxLimit = limit ? Math.min(limit, 100) : 100; // максимальный лимит 100 файлов

            if (paths && Array.isArray(paths)) {
              fileList = paths.slice(0, maxLimit).map(normalizePath);
            } else if (singlePath && typeof singlePath === 'string') {
              fileList = [normalizePath(singlePath)];
            } else {
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: 'Missing or invalid parameters: either "path" (string) or "paths" (array) must be provided',
                    errorCode: 'MISSING_PARAMETERS'
                  })
                }],
                isError: true
              };
              break;
            }

            // Если передан только один файл и указаны startLine/endLine, применяем диапазон
            const useRange = fileList.length === 1 && (startLine !== undefined || endLine !== undefined);
            const rangeStart = startLine !== undefined ? Math.max(1, startLine) : 1;
            const rangeEnd = endLine !== undefined ? Math.max(rangeStart, endLine) : Infinity;

            try {
              // Чтение файлов параллельно
              const readPromises = fileList.map(async (filePath) => {
                try {
                  const absolutePath = path.resolve(filePath);
                  const content = await fs.promises.readFile(absolutePath, 'utf-8');
                  
                  // Применяем диапазон строк, если нужно
                  if (useRange) {
                    const lines = content.split('\n');
                    const start = rangeStart - 1;
                    const end = rangeEnd === Infinity ? lines.length : Math.min(rangeEnd, lines.length);
                    if (start >= lines.length || start < 0 || end <= start) {
                      return {
                        path: filePath,
                        content: '',
                        error: `Invalid line range: start=${rangeStart}, end=${rangeEnd}, file lines=${lines.length}`
                      };
                    }
                    const slicedLines = lines.slice(start, end);
                    return {
                      path: filePath,
                      content: slicedLines.join('\n'),
                      lineRange: { start: rangeStart, end: rangeEnd }
                    };
                  }
                  
                  return { path: filePath, content };
                } catch (err) {
                  return {
                    path: filePath,
                    content: '',
                    error: err instanceof Error ? err.message : String(err)
                  };
                }
              });

              const results = await Promise.all(readPromises);

              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    files: results,
                    count: results.length,
                    lineRange: useRange ? { start: rangeStart, end: rangeEnd } : undefined
                  })
                }]
              };
            } catch (error) {
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: `Failed to read files: ${error instanceof Error ? error.message : String(error)}`,
                    errorCode: 'READ_FILE_FAILED'
                  })
                }],
                isError: true
              };
            }
            break;
          }

          case 'mcp--roo-trace--get_problems': {
            const { filePath: rawFilePath } = args as { filePath?: string };
            
            // Нормализуем путь (удаляем @ в начале, если есть)
            const filePath = rawFilePath ? this.normalizeFilePath(rawFilePath) : rawFilePath;
            
            try {
              // Получаем URL сервера extension
              const serverUrl = getServerUrl();
              if (!serverUrl) {
                result = {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      error: 'Server URL not found. Extension server may not be running.',
                      errorCode: 'SERVER_NOT_FOUND'
                    })
                  }],
                  isError: true
                };
                break;
              }

              // Формируем URL для запроса диагностик
              const url = new URL(serverUrl);
              url.pathname = '/diagnostics';
              if (filePath) {
                url.searchParams.set('file', filePath);
              }

              // Выполняем HTTP GET запрос
              const diagnostics = await new Promise<any>((resolve, reject) => {
                const options: http.RequestOptions = {
                  hostname: url.hostname,
                  port: url.port || 51234,
                  path: url.pathname + url.search,
                  method: 'GET',
                  timeout: 5000
                };

                const req = http.request(options, (res) => {
                  let responseData = '';

                  res.on('data', (chunk) => {
                    responseData += chunk.toString();
                  });

                  res.on('end', () => {
                    try {
                      if (res.statusCode !== 200) {
                        reject(new Error(`Server returned status ${res.statusCode}: ${responseData}`));
                        return;
                      }
                      const parsed = JSON.parse(responseData);
                      resolve(parsed);
                    } catch (error) {
                      reject(new Error(`Failed to parse response: ${error}`));
                    }
                  });
                });

                req.on('error', (error) => {
                  reject(error);
                });

                req.on('timeout', () => {
                  req.destroy();
                  reject(new Error('Request timeout'));
                });

                req.end();
              });

              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    diagnostics: diagnostics.diagnostics || [],
                    count: diagnostics.count || 0,
                    filePath: filePath || 'all files'
                  })
                }]
              };
            } catch (error) {
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                    errorCode: 'DIAGNOSTICS_FETCH_FAILED'
                  })
                }],
                isError: true
              };
            }
            break;
          }

          case 'mcp--roo-trace--load_rule': {
            const { rulePath } = args as { rulePath: string };
            
            try {
              if (!rulePath) {
                result = {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      error: 'rulePath is required',
                      errorCode: 'MISSING_RULE_PATH'
                    })
                  }],
                  isError: true
                };
                break;
              }

              // Загружаем правило
              const content = await RulesLoader.loadSpecificRule(rulePath);
              
              if (content === null) {
                result = {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      error: `Rule file not found or empty: ${rulePath}`,
                      errorCode: 'RULE_NOT_FOUND'
                    })
                  }],
                  isError: true
                };
                break;
              }

              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    rulePath: rulePath,
                    content: content
                  })
                }]
              };
            } catch (error) {
              result = {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                    errorCode: 'LOAD_RULE_FAILED',
                    rulePath: rulePath
                  })
                }],
                isError: true
              };
            }
            break;
          }

          default:
            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: `Unknown tool: ${name} (normalized: ${normalizedName})`,
                  errorCode: 'UNKNOWN_TOOL',
                  availableTools: tools.map(t => t.name)
                })
              }],
              isError: true
            };
        }

        // Валидация ответа инструмента
        const responseValidation = contextMonitor.validateToolResponse(sessionId, result);
        if (!responseValidation.valid) {
          logDebug(`[MCP] Tool response validation failed: ${responseValidation.errors.join(', ')}`);
          // Продолжаем, но логируем предупреждение
        }

        // Мониторинг аномалий в ответе (если это ошибка)
        if (result.isError) {
          const firstContent = result.content?.[0];
          const errorText = (firstContent && 'text' in firstContent) ? firstContent.text : '';
          contextMonitor.validateAndMonitorToolCall(sessionId, name, args, true);
          if (errorText) {
            const messageValidation = contextMonitor.validateAndMonitorMessage(sessionId, errorText, 'tool');
            if (messageValidation.shouldReset) {
              logDebug(`[MCP] Session ${sessionId} should be reset due to error anomalies`);
              contextMonitor.resetSession(sessionId);
            }
          }
        }

        const duration = Date.now() - startTime;
        this.logMCPResponse(`call_tool:${name}`, result, duration);
        return result;

      } catch (error) {
        const duration = Date.now() - startTime;
        this.logMCPError(`call_tool:${name}`, error, duration);
        
        // Мониторинг ошибок
        contextMonitor.validateAndMonitorToolCall(sessionId, name, args, true);
        
        // Возвращаем структурированный error response вместо throw
        const errorResult: CallToolResult = {
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
        
        // Валидация ответа об ошибке
        contextMonitor.validateToolResponse(sessionId, errorResult);
        
        return errorResult;
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
   * Тестирует работоспособность сервера через запись/чтение
   * Отправляет тестовый POST запрос, затем читает логи и сверяет результат
   */
  private async testServerWriteRead(serverUrl: string): Promise<{ success: boolean; error?: string }> {
    const testId = `test_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const testMessage = `Server test: ${testId}`;
    const testData = {
      hypothesisId: 'H1',
      message: testMessage,
      state: { testId, timestamp: new Date().toISOString() }
    };

    return new Promise((resolve) => {
      try {
        // Шаг 1: Отправляем тестовый POST запрос
        const url = new URL(serverUrl);
        const postData = JSON.stringify(testData);
        
        const options: http.RequestOptions = {
          hostname: url.hostname,
          port: url.port || 51234,
          path: url.pathname || '/',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          },
          timeout: 5000
        };

        const req = http.request(options, async (res) => {
          let responseData = '';
          
          res.on('data', (chunk) => {
            responseData += chunk.toString();
          });
          
          res.on('end', async () => {
            try {
              // Проверяем ответ сервера
              if (res.statusCode !== 200) {
                resolve({ success: false, error: `Server returned status ${res.statusCode}: ${responseData}` });
                return;
              }

              // Шаг 2: Ждем немного, чтобы запись завершилась
              await new Promise(resolve => setTimeout(resolve, 200));

              // Шаг 3: Читаем логи из storage
              const logs = await sharedStorage.getLogs();
              
              // Шаг 4: Ищем наш тестовый лог
              const testLog = logs.find(log => 
                log.hypothesisId === 'H1' && 
                log.context === testMessage
              );

              if (!testLog) {
                resolve({ 
                  success: false, 
                  error: `Test log not found in storage. Total logs: ${logs.length}` 
                });
                return;
              }

              // Шаг 5: Проверяем, что данные совпадают
              if (testLog.data && typeof testLog.data === 'object' && 'testId' in testLog.data) {
                const logTestId = (testLog.data as any).testId;
                if (logTestId === testId) {
                  // Тестовый лог оставляем в storage - он не помешает и может быть полезен для диагностики
                  logDebug(`Server test passed: write/read verified, testId=${testId}`, 'MCPHandler.testServerWriteRead');
                  resolve({ success: true });
                } else {
                  resolve({ 
                    success: false, 
                    error: `Test ID mismatch: expected ${testId}, got ${logTestId}` 
                  });
                }
              } else {
                resolve({ 
                  success: false, 
                  error: `Test log data format incorrect: ${JSON.stringify(testLog.data)}` 
                });
              }
            } catch (error) {
              resolve({ 
                success: false, 
                error: `Error reading logs: ${error instanceof Error ? error.message : String(error)}` 
              });
            }
          });
        });

        req.on('error', (error) => {
          resolve({ 
            success: false, 
            error: `HTTP request error: ${error.message}` 
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ 
            success: false, 
            error: 'HTTP request timeout' 
          });
        });

        req.write(postData);
        req.end();

      } catch (error) {
        resolve({ 
          success: false, 
          error: `Test setup error: ${error instanceof Error ? error.message : String(error)}` 
        });
      }
    });
  }

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

  /**
   * Рекурсивно находит все файлы с маркерами RooTrace в директории
   * Используется как fallback, если реестр проб и логи не содержат информации о файлах
   */
  private async findFilesWithProbes(rootDir: string, maxDepth: number = 5, currentDepth: number = 0): Promise<string[]> {
    const filesWithProbes: string[] = [];
    
    if (currentDepth >= maxDepth) {
      return filesWithProbes;
    }
    
    try {
      const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
      
      for (const entry of entries) {
        // Пропускаем скрытые директории и node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'venv' || entry.name === '__pycache__') {
          continue;
        }
        
        const fullPath = path.join(rootDir, entry.name);
        
        try {
          if (entry.isDirectory()) {
            // Рекурсивно сканируем поддиректории
            const subFiles = await this.findFilesWithProbes(fullPath, maxDepth, currentDepth + 1);
            filesWithProbes.push(...subFiles);
          } else if (entry.isFile()) {
            // Проверяем только текстовые файлы с кодом
            const ext = path.extname(entry.name).toLowerCase();
            const codeExtensions = ['.js', '.ts', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.cs', '.php', '.rb', '.swift', '.kt'];
            
            if (codeExtensions.includes(ext)) {
              try {
                const content = await fs.promises.readFile(fullPath, 'utf8');
                // Быстрая проверка на наличие маркеров
                if (content.includes('RooTrace [id:') || content.includes('RooTrace[id:')) {
                  filesWithProbes.push(fullPath);
                }
              } catch (readError) {
                // Игнорируем ошибки чтения (бинарные файлы, права доступа и т.д.)
                continue;
              }
            }
          }
        } catch (entryError) {
          // Игнорируем ошибки доступа к отдельным файлам/директориям
          continue;
        }
      }
    } catch (dirError) {
      // Игнорируем ошибки доступа к директории
      logDebug(`Error scanning directory ${rootDir}: ${dirError}`, 'RooTraceMCPHandler.findFilesWithProbes');
    }
    
    return filesWithProbes;
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
