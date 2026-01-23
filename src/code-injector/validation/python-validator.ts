/**
 * Валидатор синтаксиса для Python
 */

import { BaseValidator } from './base-validator';
import { SyntaxValidationResult } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class PythonValidator extends BaseValidator {
  readonly supportedLanguages = ['python', 'py'];

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
    const escapedPath = safeFilePath.replace(/"/g, '\\"');
    let pythonCommand = 'python3';
    let checkPassed = false;
    
    try {
      // Пробуем python3 сначала
      const { stderr, stdout } = await execAsync(`${pythonCommand} -m py_compile "${escapedPath}"`, { timeout });
      const output = (stderr || stdout || '').trim();
      if (output && !output.includes('SyntaxError') && !output.includes('IndentationError')) {
        warnings.push(output);
      }
      checkPassed = true;
    } catch (error: any) {
      const errorOutput = (error.stderr || error.stdout || error.message || String(error)).trim();
      
      // Если python3 не найден, пробуем python
      if (errorOutput.includes('command not found') || errorOutput.includes('python3: command not found') || 
          errorOutput.includes('/bin/sh: python3: command not found')) {
        try {
          pythonCommand = 'python';
          const { stderr: stderr2, stdout: stdout2 } = await execAsync(`${pythonCommand} -m py_compile "${escapedPath}"`, { timeout });
          const output2 = (stderr2 || stdout2 || '').trim();
          if (output2 && !output2.includes('SyntaxError') && !output2.includes('IndentationError')) {
            warnings.push(output2);
          }
          checkPassed = true;
          warnings.push(`Used 'python' instead of 'python3' (python3 not found)`);
        } catch (error2: any) {
          const errorOutput2 = (error2.stderr || error2.stdout || error2.message || String(error2)).trim();
          if (errorOutput2.includes('command not found') || errorOutput2.includes('python: command not found') || 
              errorOutput2.includes('/bin/sh: python: command not found')) {
            warnings.push('Neither python3 nor python found in PATH, syntax check skipped');
          } else if (errorOutput2.includes('SyntaxError') || errorOutput2.includes('IndentationError') || 
                     errorOutput2.includes('File') && errorOutput2.includes('line')) {
            errors.push(errorOutput2);
          } else {
            warnings.push(`Python check warning: ${errorOutput2.substring(0, 200)}`);
          }
        }
      } else if (errorOutput.includes('SyntaxError') || errorOutput.includes('IndentationError') || 
                 errorOutput.includes('File') && errorOutput.includes('line')) {
        errors.push(errorOutput);
      } else {
        warnings.push(`Python check warning: ${errorOutput.substring(0, 200)}`);
      }
    }

    return this.createResult(errors.length === 0, errors.length > 0 ? errors : undefined, warnings.length > 0 ? warnings : undefined);
  }
}
