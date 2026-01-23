/**
 * Базовый класс для валидаторов синтаксиса
 */

import { SyntaxValidator, SyntaxValidationResult } from '../types';
import * as fs from 'fs';
import { sanitizeFilePath as utilsSanitizeFilePath, getWorkspaceRoot } from '../../utils';

/**
 * Базовый класс для валидаторов
 * Упрощает создание новых валидаторов
 */
export abstract class BaseValidator implements SyntaxValidator {
  abstract readonly supportedLanguages: string[];

  /**
   * Проверяет существование файла
   */
  protected checkFileExists(filePath: string): { exists: boolean; safePath?: string; error?: string } {
    try {
      const workspaceRoot = getWorkspaceRoot();
      const safePath = utilsSanitizeFilePath(filePath, workspaceRoot);
      if (!fs.existsSync(safePath)) {
        return { exists: false, error: 'File does not exist' };
      }
      return { exists: true, safePath };
    } catch (error) {
      return { 
        exists: false, 
        error: `Invalid file path: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  /**
   * Создает результат валидации
   */
  protected createResult(
    passed: boolean,
    errors?: string[],
    warnings?: string[]
  ): SyntaxValidationResult {
    return {
      passed,
      errors: errors && errors.length > 0 ? errors : undefined,
      warnings: warnings && warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Проверяет синтаксис файла
   */
  abstract validate(
    filePath: string,
    timeout: number
  ): Promise<SyntaxValidationResult>;
}
