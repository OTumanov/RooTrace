/**
 * Валидатор синтаксиса для Swift
 */

import { BaseValidator } from './base-validator';
import { SyntaxValidationResult } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class SwiftValidator extends BaseValidator {
  readonly supportedLanguages = ['swift'];

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
      const { stderr } = await execAsync(`swiftc -typecheck "${safeFilePath}" 2>&1`, { timeout });
      if (stderr) {
        if (stderr.includes('error:') || stderr.includes('syntax error')) {
          errors.push(stderr);
        } else {
          warnings.push(stderr.substring(0, 200));
        }
      }
    } catch (error: any) {
      const errorMsg = error.stderr || error.message || String(error);
      if (errorMsg.includes('error:') || errorMsg.includes('syntax error')) {
        errors.push(errorMsg);
      } else if (errorMsg.includes('command not found')) {
        warnings.push('Swift compiler not found in PATH, syntax check skipped');
      } else {
        warnings.push(`Swift check skipped: ${errorMsg.substring(0, 200)}`);
      }
    }

    return this.createResult(errors.length === 0, errors.length > 0 ? errors : undefined, warnings.length > 0 ? warnings : undefined);
  }
}
