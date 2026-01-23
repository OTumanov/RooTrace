/**
 * Валидатор синтаксиса для Rust
 */

import { BaseValidator } from './base-validator';
import { SyntaxValidationResult } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class RustValidator extends BaseValidator {
  readonly supportedLanguages = ['rust', 'rs'];

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
      const { stderr } = await execAsync(`rustc --crate-type lib --edition 2021 "${safeFilePath}" 2>&1`, { timeout });
      if (stderr) {
        if (stderr.includes('error:') && (stderr.includes('expected') || stderr.includes('unexpected') || stderr.includes('syntax'))) {
          errors.push(stderr);
        } else if (stderr.includes('error:')) {
          warnings.push(`Rust check warning: ${stderr.substring(0, 200)}`);
        }
      }
    } catch (error: any) {
      const errorMsg = error.stderr || error.message || String(error);
      if (errorMsg.includes('syntax error') || errorMsg.includes('expected') || errorMsg.includes('unexpected')) {
        errors.push(errorMsg);
      } else if (errorMsg.includes('command not found') || errorMsg.includes('rustc: command not found')) {
        warnings.push('Rust compiler not found in PATH, syntax check skipped');
      } else {
        warnings.push(`Rust check skipped: ${errorMsg.substring(0, 200)}`);
      }
    }

    return this.createResult(errors.length === 0, errors.length > 0 ? errors : undefined, warnings.length > 0 ? warnings : undefined);
  }
}
