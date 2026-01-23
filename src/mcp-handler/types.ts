/**
 * Типы и интерфейсы для MCP Handler
 * 
 * Этот файл содержит все типы, используемые в mcp-handler.ts и связанных модулях.
 */

/**
 * Результат проверки разрешения на чтение логов
 */
export interface ReadLogsApprovalResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Результат проверки git commit перед редактированием
 */
export interface GitCommitCheckResult {
  allowed: boolean;
  error?: string;
}

/**
 * Результат тестирования сервера
 */
export interface ServerTestResult {
  success: boolean;
  error?: string;
}

/**
 * Параметры для инструмента inject_probes
 */
export interface InjectProbesParams {
  filePath: string;
  lineNumber: number;
  probeType: 'log' | 'trace' | 'error';
  message?: string;
  probeCode?: string;
  hypothesisId?: string;
}

/**
 * Параметры для инструмента inject_multiple_probes
 */
export interface InjectMultipleProbesParams {
  probes: Array<{
    filePath: string;
    lineNumber: number;
    probeType: 'log' | 'trace' | 'error';
    message?: string;
    probeCode?: string;
    hypothesisId?: string;
  }>;
}

/**
 * Параметры для инструмента show_user_instructions
 */
export interface ShowUserInstructionsParams {
  instructions: string;
  stepNumber?: number;
}

/**
 * Параметры для инструмента read_file
 */
export interface ReadFileParams {
  path?: string;
  paths?: string[];
  startLine?: number;
  endLine?: number;
  limit?: number;
}

/**
 * Параметры для инструмента get_problems
 */
export interface GetProblemsParams {
  filePath?: string;
}

/**
 * Параметры для инструмента load_rule
 */
export interface LoadRuleParams {
  rulePath: string;
}

/**
 * Параметры для инструмента read_runtime_logs
 */
export interface ReadRuntimeLogsParams {
  sessionId?: string;
}

/**
 * Параметры для инструмента clear_session
 */
export interface ClearSessionParams {
  sessionId?: string;
}

/**
 * Результат удаления проб из файла
 */
export interface ProbeRemovalResult {
  file: string;
  success: boolean;
  message: string;
}

/**
 * Результат очистки сессии
 */
export interface ClearSessionResult {
  success: boolean;
  message: string;
  sessionId: string;
  clearedAt: string;
  probesRemoved: number;
  filesProcessed: number;
  filesWithProbesRemoved: number;
  removalResults: ProbeRemovalResult[];
}

/**
 * Результат инъекции пробы
 */
export interface ProbeInjectionResult {
  success: boolean;
  filePath: string;
  lineNumber: number;
  probeType: string;
  message?: string;
  confirmation: string;
  insertedCode?: string;
  syntaxCheck?: {
    passed: boolean;
    errors?: string[];
    warnings?: string[];
  };
  warning?: string;
}

/**
 * Результат множественной инъекции проб
 */
export interface MultipleProbeInjectionResult {
  success: boolean;
  message: string;
  results: ProbeInjectionResult[];
  totalProbes: number;
  successfulProbes: number;
  failedProbes: number;
  hasSyntaxErrors: boolean;
  warning?: string;
}

/**
 * Результат показа инструкций пользователю
 */
export interface ShowUserInstructionsResult {
  success: boolean;
  message: string;
  requestId: string;
  choice: string | null;
  uiEventPath: string;
  uiResponsePath: string;
}

/**
 * Результат чтения файла
 */
export interface ReadFileResult {
  success: boolean;
  files: Array<{
    path: string;
    content: string;
    error?: string;
    lineRange?: {
      start: number;
      end: number;
    };
  }>;
  count: number;
  lineRange?: {
    start: number;
    end: number;
  };
}

/**
 * Результат получения диагностик
 */
export interface GetProblemsResult {
  success: boolean;
  diagnostics: Array<{
    file: string;
    line: number;
    column: number;
    severity: string;
    message: string;
    source?: string;
  }>;
  count: number;
  filePath: string | 'all files';
}

/**
 * Результат загрузки правила
 */
export interface LoadRuleResult {
  success: boolean;
  rulePath: string;
  content: string;
}

/**
 * Результат чтения логов
 */
export interface ReadRuntimeLogsResult {
  logs: any[];
  count: number;
  sessionId: string;
  queued?: boolean;
}

/**
 * Результат очистки логов
 */
export interface ClearLogsResult {
  success: boolean;
  message: string;
  clearedAt: string;
}

/**
 * Статус отладки
 */
export interface DebugStatus {
  serverStatus: 'active' | 'inactive' | 'error';
  serverTestResult: string | null;
  activeHypotheses: any[];
  currentSession: string;
  lastUpdated: string;
  uptime: number;
}
