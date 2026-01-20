import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  InitializeRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  CallToolResult
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

const execAsync = promisify(exec);

// Используем shared log storage вместо изолированного debugSession
const sharedStorage = SharedLogStorage.getInstance();

// Основной класс для обработки MCP-запросов
export class RooTraceMCPHandler {
  private server: Server | null = null;
  private startTime: number = Date.now();
  private committedFiles: Set<string> = new Set(); // Трекер файлов, для которых был сделан коммит
  private static readonly READ_LOGS_APPROVAL_FILE = 'allow-read-runtime-logs.json';
  private static readonly READ_LOGS_APPROVAL_MAX_AGE_MS = 2 * 60 * 1000; // 2 minutes
  private static readonly AUTO_DEBUG_APPROVAL_FILE = 'allow-auto-debug.json';
  private static readonly AUTO_DEBUG_APPROVAL_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes (user-granted)

  constructor() {
    // EventEmitter удален, так как не использовался
  }

  private getWorkspaceRootForFiles(): string {
    const envWorkspace = process.env.ROO_TRACE_WORKSPACE || process.env.ROO_TRACE_WORKSPACE_ROOT;
    if (envWorkspace && typeof envWorkspace === 'string' && envWorkspace.trim().length > 0) {
      return envWorkspace.trim();
    }
    return process.cwd();
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
   * Находит корень git репозитория
   */
  private async findGitRoot(filePath: string): Promise<string | null> {
    try {
      let currentPath = path.resolve(filePath);
      if (fs.existsSync(currentPath) && !fs.statSync(currentPath).isDirectory()) {
        currentPath = path.dirname(currentPath);
      } else if (!fs.existsSync(currentPath)) {
        currentPath = path.dirname(currentPath);
      }

      const root = path.parse(currentPath).root;
      while (currentPath !== root) {
        const gitPath = path.join(currentPath, '.git');
        if (fs.existsSync(gitPath)) {
          return currentPath;
        }
        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) break;
        currentPath = parentPath;
      }
      return null;
    } catch {
      return null;
    }
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
        name: 'clear_logs',
        description: 'Очищает ТОЛЬКО логи (без удаления проб/гипотез). Аналог кнопки очистки логов на дашборде.',
        inputSchema: {
          type: 'object',
          properties: {}
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
        description: 'Инъекция проб в код для дополнительной отладочной информации. ⚠️ ЗАПРЕЩЕНО для Python файлов (.py) - используйте apply_diff (Block Rewrite) вместо этого. 🛡️ ВАЖНО: Перед использованием apply_diff ОБЯЗАТЕЛЬНО создайте резервную копию: если git репозиторий - `git add . && git commit -m "AI Debugger: Pre-instrumentation backup"`, если нет git - `cp <file> <file>.bak`.',
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
        description: 'Инъекция нескольких проб в код за один вызов. ⚠️ ЗАПРЕЩЕНО для Python файлов (.py) - используйте apply_diff (Block Rewrite) вместо этого. 🛡️ ВАЖНО: Перед использованием apply_diff ОБЯЗАТЕЛЬНО создайте резервную копию: если git репозиторий - `git add . && git commit -m "AI Debugger: Pre-instrumentation backup"`, если нет git - `cp <file> <file>.bak`. Для других языков используйте этот инструмент вместо множественных вызовов inject_probes - это более эффективно и избегает проблем с вложенностью.',
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
