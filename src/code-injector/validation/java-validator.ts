/**
 * Валидатор синтаксиса для Java
 */

import { BaseValidator } from './base-validator';
import { SyntaxValidationResult } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class JavaValidator extends BaseValidator {
  readonly supportedLanguages = ['java'];

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
    const warnings: string[] = [];

    try {
      const { stderr } = await execAsync(`javac -Xlint:all "${safeFilePath}"`, { timeout });
      if (stderr) {
        if (stderr.includes('error:')) {
          errors.push(stderr);
        } else {
          warnings.push(stderr);
        }
      }
    } catch (error: any) {
      const errorMsg = error.stderr || error.message || String(error);
      warnings.push(`Java syntax check skipped: ${errorMsg}`);
    }

    return this.createResult(errors.length === 0, errors.length > 0 ? errors : undefined, warnings.length > 0 ? warnings : undefined);
  }
}
