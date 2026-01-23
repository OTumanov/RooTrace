/**
 * Валидатор синтаксиса для JavaScript
 */

import { BaseValidator } from './base-validator';
import { SyntaxValidationResult } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class JavaScriptValidator extends BaseValidator {
  readonly supportedLanguages = ['javascript', 'js', 'jsx'];

  async validate(
    filePath: string,
    timeout: number
  ): Promise<SyntaxValidationResult> {
    const fileCheck = this.checkFileExists(filePath);
    if (!fileCheck.exists) {
      return this.createResult(false, [fileCheck.error!]);
    }

    const safeFilePath = fileCheck.safePath!;
    const errors: string[] = [];

    try {
      const { stderr } = await execAsync(`node --check "${safeFilePath}"`, { timeout });
      if (stderr) {
        errors.push(stderr);
      }
    } catch (error: any) {
      const errorMsg = error.stderr || error.message || String(error);
      errors.push(errorMsg);
    }

    return this.createResult(errors.length === 0, errors.length > 0 ? errors : undefined);
  }
}
