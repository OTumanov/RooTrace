/**
 * Валидатор синтаксиса для C++
 */

import { BaseValidator } from './base-validator';
import { SyntaxValidationResult } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class CppValidator extends BaseValidator {
  readonly supportedLanguages = ['cpp', 'c++', 'cxx', 'cc'];

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
      let compiler = 'g++';
      try {
        await execAsync('which g++', { timeout: 1000 });
      } catch {
        compiler = 'clang++';
      }
      
      const { stderr } = await execAsync(`${compiler} -fsyntax-only -std=c++17 "${safeFilePath}" 2>&1`, { timeout });
      if (stderr) {
        if (stderr.includes('error:') || stderr.includes('Error:')) {
          errors.push(stderr);
        } else {
          warnings.push(stderr);
        }
      }
    } catch (error: any) {
      const errorMsg = error.stderr || error.message || String(error);
      if (errorMsg.includes('syntax error') || errorMsg.includes('parse error')) {
        errors.push(errorMsg);
      } else if (errorMsg.includes('command not found')) {
        warnings.push('C++ compiler (g++/clang++) not found in PATH, syntax check skipped');
      } else {
        warnings.push(`C++ check skipped: ${errorMsg.substring(0, 200)}`);
      }
    }

    return this.createResult(errors.length === 0, errors.length > 0 ? errors : undefined, warnings.length > 0 ? warnings : undefined);
  }
}
