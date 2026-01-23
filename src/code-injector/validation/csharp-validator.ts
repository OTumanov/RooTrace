/**
 * Валидатор синтаксиса для C#
 */

import { BaseValidator } from './base-validator';
import { SyntaxValidationResult } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class CSharpValidator extends BaseValidator {
  readonly supportedLanguages = ['csharp', 'cs'];

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
      let command = `dotnet build "${safeFilePath}" --no-restore 2>&1`;
      try {
        await execAsync('which dotnet', { timeout: 1000 });
      } catch {
        command = `csc /nologo /t:library "${safeFilePath}" 2>&1`;
      }
      
      const { stderr, stdout } = await execAsync(command, { timeout });
      const output = (stderr || stdout || '').trim();
      if (output.includes('error CS') || output.includes('syntax error')) {
        errors.push(output);
      } else if (output && !output.includes('Build succeeded')) {
        warnings.push(`C# check: ${output.substring(0, 200)}`);
      }
    } catch (error: any) {
      const errorMsg = error.stderr || error.stdout || error.message || String(error);
      if (errorMsg.includes('error CS') || errorMsg.includes('syntax error')) {
        errors.push(errorMsg);
      } else if (errorMsg.includes('command not found')) {
        warnings.push('C# compiler (dotnet/csc) not found in PATH, syntax check skipped');
      } else {
        warnings.push(`C# check skipped: ${errorMsg.substring(0, 200)}`);
      }
    }

    return this.createResult(errors.length === 0, errors.length > 0 ? errors : undefined, warnings.length > 0 ? warnings : undefined);
  }
}
