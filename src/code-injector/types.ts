/**
 * Типы и интерфейсы для модуля code-injector
 */

/**
 * Результат инъекции пробы
 */
export interface InjectionResult {
  success: boolean;
  message: string;
  insertedCode?: string;
  syntaxCheck?: SyntaxValidationResult;
  rollback?: boolean; // Флаг, указывающий что файл был откачен из-за ошибки синтаксиса
  error?: string; // Сообщение об ошибке при неудачной инъекции
}

/**
 * Информация о пробе
 */
export interface ProbeInfo {
  id: string;
  filePath: string;
  lineNumber: number;
  originalCode: string;
  injectedCode: string;
  probeType: string;
  message: string;
  actualLineNumber?: number; // Реальный номер строки, куда была вставлена проба (после корректировки)
  probeLinesCount?: number; // Количество строк пробы (для многострочных проб)
}

/**
 * Результат проверки синтаксиса
 */
export interface SyntaxValidationResult {
  passed: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * Интерфейс для генератора кода проб
 */
export interface ProbeCodeGenerator {
  /**
   * Генерирует код пробы для указанного языка
   * @param language Язык программирования (например, 'python', 'javascript')
   * @param probeType Тип пробы: 'log', 'trace', или 'error'
   * @param message Сообщение для логирования (будет экранировано)
   * @param serverUrl URL сервера RooTrace
   * @param hypothesisId ID гипотезы (H1-H5), опционально
   * @returns Сгенерированный код пробы для вставки в файл, или null если язык не поддерживается
   */
  generate(
    language: string,
    probeType: 'log' | 'trace' | 'error',
    message: string,
    serverUrl: string,
    hypothesisId?: string
  ): string | null;
  
  /**
   * Поддерживаемые языки (массив расширений или названий языков)
   */
  readonly supportedLanguages: string[];
}

/**
 * Интерфейс для валидатора синтаксиса
 */
export interface SyntaxValidator {
  /**
   * Проверяет синтаксис файла после инъекции пробы
   * @param filePath Путь к файлу для проверки
   * @param timeout Таймаут проверки в миллисекундах
   * @returns Результат проверки синтаксиса
   */
  validate(
    filePath: string,
    timeout: number
  ): Promise<SyntaxValidationResult>;
  
  /**
   * Поддерживаемые языки
   */
  readonly supportedLanguages: string[];
}

/**
 * Опции для генерации пробы
 */
export interface ProbeGenerationOptions {
  indent?: string; // Отступ для пробы
  probeType?: 'log' | 'trace' | 'error';
  hypothesisId?: string;
}
