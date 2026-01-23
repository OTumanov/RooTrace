/**
 * Валидатор синтаксиса для Go
 */

import { BaseValidator } from './base-validator';
import { SyntaxValidationResult } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class GoValidator extends BaseValidator {
  readonly supportedLanguages = ['go'];

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
      const { stderr } = await execAsync(`go build -o /dev/null "${safeFilePath}"`, { timeout });
      if (stderr) {
        errors.push(stderr);
      }
    } catch (error: any) {
      const errorMsg = error.stderr || error.message || String(error);
      if (errorMsg.includes('syntax error') || errorMsg.includes('unexpected')) {
        errors.push(errorMsg);
      } else if (errorMsg.includes('command not found')) {
        warnings.push('Go compiler not found in PATH, syntax check skipped');
      } else {
        warnings.push(`Go check warning: ${errorMsg.substring(0, 200)}`);
      }
    }

    return this.createResult(errors.length === 0, errors.length > 0 ? errors : undefined, warnings.length > 0 ? warnings : undefined);
  }
}
