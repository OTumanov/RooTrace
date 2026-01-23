/**
 * Валидатор синтаксиса для TypeScript
 */

import { BaseValidator } from './base-validator';
import { SyntaxValidationResult } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class TypeScriptValidator extends BaseValidator {
  readonly supportedLanguages = ['typescript', 'ts', 'tsx'];

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
      const { stderr, stdout } = await execAsync(`tsc --noEmit --skipLibCheck --isolatedModules "${safeFilePath}" 2>&1`, { timeout });
      const output = (stderr || stdout || '').trim();
      if (output && !output.includes('Found 0 errors') && !output.includes('error TS')) {
        if (output.includes('error TS')) {
          errors.push(output);
        } else if (!output.includes('Cannot find name') && !output.includes('Cannot find module')) {
          warnings.push(`TypeScript check: ${output.substring(0, 200)}`);
        }
      }
    } catch (error: any) {
      const errorOutput = (error.stderr || error.stdout || error.message || String(error)).trim();
      if (errorOutput.includes('command not found') || errorOutput.includes('Cannot find') || errorOutput.includes('tsconfig')) {
        try {
          const { stderr } = await execAsync(`node --check "${safeFilePath}"`, { timeout });
          if (stderr) {
            warnings.push(`TypeScript check skipped (tsc not available or no tsconfig), JS syntax check: ${stderr.substring(0, 200)}`);
          }
        } catch (jsError: any) {
          const jsErrorMsg = jsError.stderr || jsError.message || String(jsError);
          if (jsErrorMsg.includes('SyntaxError') || jsErrorMsg.includes('Unexpected token')) {
            errors.push(`JavaScript syntax error: ${jsErrorMsg.substring(0, 200)}`);
          } else {
            warnings.push(`TypeScript/JavaScript check skipped: ${jsErrorMsg.substring(0, 200)}`);
          }
        }
      } else {
        errors.push(`TypeScript compilation error: ${errorOutput.substring(0, 500)}`);
      }
    }

    return this.createResult(errors.length === 0, errors.length > 0 ? errors : undefined, warnings.length > 0 ? warnings : undefined);
  }
}
