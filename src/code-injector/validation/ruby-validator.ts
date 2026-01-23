/**
 * Валидатор синтаксиса для Ruby
 */

import { BaseValidator } from './base-validator';
import { SyntaxValidationResult } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class RubyValidator extends BaseValidator {
  readonly supportedLanguages = ['ruby', 'rb'];

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
      const { stderr, stdout } = await execAsync(`ruby -c "${safeFilePath}"`, { timeout });
      const output = (stderr || stdout || '').trim();
      if (output.includes('SyntaxError') || output.includes('syntax error')) {
        errors.push(output);
      } else if (output && !output.includes('Syntax OK')) {
        warnings.push(output);
      }
    } catch (error: any) {
      const errorMsg = error.stderr || error.stdout || error.message || String(error);
      if (errorMsg.includes('SyntaxError') || errorMsg.includes('syntax error')) {
        errors.push(errorMsg);
      } else if (errorMsg.includes('command not found') || errorMsg.includes('ruby: command not found')) {
        warnings.push('Ruby not found in PATH, syntax check skipped');
      } else {
        warnings.push(`Ruby check skipped: ${errorMsg.substring(0, 200)}`);
      }
    }

    return this.createResult(errors.length === 0, errors.length > 0 ? errors : undefined, warnings.length > 0 ? warnings : undefined);
  }
}
