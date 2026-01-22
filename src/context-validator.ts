/**
 * Валидатор контекста для защиты от отравления контекста
 * Проверяет данные перед добавлением в контекст сессии
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ValidationOptions {
  maxLength?: number;
  allowControlChars?: boolean;
  checkJson?: boolean;
  checkSuspiciousPatterns?: boolean;
}

export class ContextValidator {
  private static readonly DEFAULT_MAX_LENGTH = 100000; // 100KB
  private static readonly CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;
  private static readonly SUSPICIOUS_PATTERNS = [
    /eval\s*\(/i,
    /Function\s*\(/i,
    /setTimeout\s*\(/i,
    /setInterval\s*\(/i,
    /document\.write/i,
    /innerHTML\s*=/i,
    /<script/i,
    /javascript:/i,
    /onerror\s*=/i,
    /onload\s*=/i
  ];

  /**
   * Валидирует текст перед добавлением в контекст
   */
  static validateText(
    text: string,
    options: ValidationOptions = {}
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const {
      maxLength = ContextValidator.DEFAULT_MAX_LENGTH,
      allowControlChars = false,
      checkJson = false,
      checkSuspiciousPatterns = true
    } = options;

    // Проверка на пустоту
    if (!text || typeof text !== 'string') {
      return {
        valid: false,
        errors: ['Text is empty or not a string'],
        warnings: []
      };
    }

    // Проверка длины
    if (text.length > maxLength) {
      errors.push(`Text exceeds maximum length: ${text.length} > ${maxLength}`);
    }

    // Проверка на control characters
    if (!allowControlChars) {
      const controlChars = text.match(ContextValidator.CONTROL_CHARS_REGEX);
      if (controlChars && controlChars.length > 0) {
        const uniqueChars = [...new Set(controlChars)];
        warnings.push(
          `Found ${controlChars.length} control characters: ${uniqueChars
            .map((c) => `0x${c.charCodeAt(0).toString(16)}`)
            .join(', ')}`
        );
      }
    }

    // Проверка на валидность JSON (если ожидается JSON)
    if (checkJson) {
      try {
        JSON.parse(text);
      } catch (e) {
        errors.push(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Проверка на подозрительные паттерны
    if (checkSuspiciousPatterns) {
      for (const pattern of ContextValidator.SUSPICIOUS_PATTERNS) {
        if (pattern.test(text)) {
          warnings.push(`Suspicious pattern detected: ${pattern.source}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Валидирует объект перед добавлением в контекст
   */
  static validateObject(
    obj: any,
    options: ValidationOptions = {}
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Проверка на null/undefined
    if (obj === null || obj === undefined) {
      return {
        valid: false,
        errors: ['Object is null or undefined'],
        warnings: []
      };
    }

    // Проверка на циклические ссылки
    try {
      JSON.stringify(obj);
    } catch (e) {
      if (e instanceof Error && e.message.includes('circular')) {
        errors.push('Object contains circular references');
      } else {
        errors.push(`Cannot serialize object: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Проверка размера объекта
    const serialized = JSON.stringify(obj);
    const textValidation = ContextValidator.validateText(serialized, options);
    errors.push(...textValidation.errors);
    warnings.push(...textValidation.warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Валидирует tool call request
   */
  static validateToolCall(
    toolName: string,
    args: any
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Проверка имени инструмента
    if (!toolName || typeof toolName !== 'string') {
      errors.push('Tool name is empty or not a string');
    } else if (toolName.length > 100) {
      errors.push(`Tool name too long: ${toolName.length} > 100`);
    } else if (!/^[a-zA-Z0-9_-]+$/.test(toolName)) {
      warnings.push(`Tool name contains unusual characters: ${toolName}`);
    }

    // Проверка аргументов
    if (args !== null && args !== undefined) {
      const argsValidation = ContextValidator.validateObject(args, {
        maxLength: 50000, // 50KB для аргументов
        checkSuspiciousPatterns: true
      });
      errors.push(...argsValidation.errors);
      warnings.push(...argsValidation.warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Валидирует tool response
   */
  static validateToolResponse(response: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Проверка структуры ответа
    if (!response || typeof response !== 'object') {
      errors.push('Response is not an object');
      return { valid: false, errors, warnings };
    }

    // Проверка content
    if (response.content && Array.isArray(response.content)) {
      for (const item of response.content) {
        if (item.type === 'text' && item.text) {
          const textValidation = ContextValidator.validateText(item.text, {
            maxLength: 200000, // 200KB для ответов
            checkSuspiciousPatterns: true
          });
          errors.push(...textValidation.errors);
          warnings.push(...textValidation.warnings);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}
