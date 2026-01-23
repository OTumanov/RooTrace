/**
 * Основная логика инъекции проб в код
 */

import * as fs from 'fs';
import * as path from 'path';
import { withFileLock } from '../../file-lock-utils';
import { getWorkspaceRoot, sanitizeFilePath as utilsSanitizeFilePath, getLanguageFromFileExtension } from '../../utils';
import { 
  InjectionResult, 
  ProbeInfo
} from '../types';
import { getServerUrl } from '../config/server-url';
import { getSyntaxCheckTimeout, isSyntaxValidationEnabled } from '../config/config-reader';
import { getGenerator } from '../generators/generator-factory';
import { getValidator } from '../validation/validator-factory';
import { generatePythonHostInitCode } from '../host-detection/python-host-init';
import { generateGoHostInitCode, ensureGoProbeImports } from '../host-detection/go-host-init';
import { hasHostInit, markHostInit } from '../host-detection/host-init-registry';
import { findInsertionPosition } from '../positioning/insertion-position';
import { applyIndentation } from '../positioning/indentation-handler';
import { registerProbe } from './probe-registry';

/**
 * Sanitize and validate a file path to ensure it stays within the project directory.
 * Returns an absolute, normalized path if safe, otherwise throws an error.
 */
function sanitizeFilePath(inputPath: string): string {
  const workspaceRoot = getWorkspaceRoot();
  return utilsSanitizeFilePath(inputPath, workspaceRoot);
}


/**
 * Проверяет синтаксис файла после инжекции пробы
 */
async function validateSyntax(filePath: string, language: string): Promise<{ passed: boolean; errors?: string[]; warnings?: string[] }> {
  try {
    if (!isSyntaxValidationEnabled()) {
      return { passed: true, warnings: ['Syntax validation is disabled in settings'] };
    }

    const timeout = getSyntaxCheckTimeout();
    const validator = getValidator(language);
    
    if (validator) {
      const result = await validator.validate(filePath, timeout);
      return {
        passed: result.passed,
        errors: result.errors,
        warnings: result.warnings
      };
    }

    return {
      passed: true,
      warnings: [`Syntax validation not implemented for ${language}`]
    };
  } catch (error) {
    return {
      passed: false,
      errors: [`Syntax validation failed: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

/**
 * Генерирует код пробы для указанного языка программирования
 * 
 * Создает код, который отправляет данные на сервер RooTrace при выполнении.
 * Поддерживает множество языков: JavaScript, TypeScript, Python, Java, Go, Rust,
 * C++, PHP, Ruby, C#, Swift, Kotlin и другие.
 * 
 * @param language - Язык программирования (например, 'python', 'javascript', 'go')
 * @param probeType - Тип пробы: 'log', 'trace', или 'error'
 * @param message - Сообщение для логирования (будет экранировано для безопасности)
 * @param serverUrl - URL сервера RooTrace. Если не указан, вернется код с ошибкой.
 * @param hypothesisId - ID гипотезы (H1-H5). Если не указан, будет сгенерирован из message.
 * @returns Сгенерированный код пробы для вставки в файл
 */
export function generateProbeCode(
  language: string, 
  probeType: 'log' | 'trace' | 'error', 
  message: string,
  serverUrl?: string | null,
  hypothesisId?: string
): string {
  const url = serverUrl || null;
  
  if (!url) {
    const errorMsg = 'RooTrace server URL not configured. Please ensure .ai_debug_config or .debug_port exists.';
    const generator = getGenerator(language);
    if (generator) {
      if (generator.supportedLanguages.includes('python') || generator.supportedLanguages.includes('py')) {
        return `raise RuntimeError("${errorMsg}")`;
      }
      if (generator.supportedLanguages.includes('javascript') || generator.supportedLanguages.includes('js')) {
        return `throw new Error("${errorMsg}");`;
      }
    }
    return `// ERROR: ${errorMsg}`;
  }
  
  const generator = getGenerator(language);
  
  if (generator) {
    const code = generator.generate(language, probeType, message, url, hypothesisId);
    if (code) {
      return code;
    }
  }
  
  const fallbackGenerator = getGenerator('fallback');
  if (fallbackGenerator) {
    const code = fallbackGenerator.generate(language, probeType, message, url, hypothesisId);
    if (code) {
      return code;
    }
  }
  
  // Последний fallback - простой JavaScript код
  const hId = hypothesisId && /^H[1-5]$/.test(hypothesisId.trim()) 
    ? hypothesisId.trim() 
    : `H${Math.abs(message.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % 5 + 1}`;
  const escapedMessage = message.replace(/"/g, '\\"').replace(/'/g, "\\'");
  return `try { fetch('${url}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hypothesisId: '${hId}', message: '${escapedMessage}', state: {} }) }).catch(() => {}); } catch(e) {}`;
}

/**
 * Инъекция пробы в код для отладки
 * 
 * Вставляет код пробы в указанную строку файла. Проба автоматически отправляет данные
 * на сервер RooTrace при выполнении. Поддерживает множество языков программирования
 * и автоматически определяет правильное место для вставки (например, внутри функции
 * для Python).
 * 
 * @param filePath - Путь к файлу (относительный или абсолютный). Будет проверен на path traversal.
 * @param lineNumber - Номер строки для инъекции (1-based). Будет скорректирован для правильной вставки.
 * @param probeType - Тип пробы: 'log' (обычное логирование), 'trace' (трассировка), 'error' (ошибка).
 * @param message - Сообщение для логирования. Используется для идентификации пробы.
 * @param probeCode - Опциональный пользовательский код пробы. Если не указан, будет сгенерирован автоматически.
 * @param hypothesisId - Опциональный ID гипотезы (H1-H5). Если не указан, будет сгенерирован из message.
 * @returns Promise с результатом инъекции, включая информацию о синтаксических ошибках, если они есть.
 */
export async function injectProbe(
  filePath: string,
  lineNumber: number,
  probeType: 'log' | 'trace' | 'error',
  message: string,
  probeCode?: string,
  hypothesisId?: string
): Promise<InjectionResult> {
  try {
    // Sanitize and validate inputs
    let safeFilePath: string;
    try {
      safeFilePath = sanitizeFilePath(filePath);
    } catch (e) {
      return {
        success: false,
        message: `Invalid file path: ${filePath} - ${e instanceof Error ? e.message : String(e)}`
      };
    }
    if (typeof lineNumber !== 'number' || isNaN(lineNumber) || lineNumber < 1) {
      return { success: false, message: 'Invalid lineNumber parameter' };
    }
    if (!probeType) {
      return { success: false, message: 'Invalid probeType parameter' };
    }
    if (typeof message !== 'string') {
      return { success: false, message: 'Invalid message parameter (must be a string)' };
    }
    
    if (!probeCode && message.length === 0) {
      return { success: false, message: 'Message parameter is required when probeCode is not provided' };
    }

    // Проверяем, существует ли файл
    try {
      await fs.promises.access(safeFilePath, fs.constants.F_OK);
    } catch {
      return {
        success: false,
        message: `File does not exist: ${safeFilePath}`
      };
    }

    // Используем улучшенный механизм блокировок с очередью операций
    return await withFileLock(safeFilePath, async () => {
      // Читаем содержимое файла
      let fileContent = await fs.promises.readFile(safeFilePath, 'utf8');
      let lines = fileContent.split('\n');
      
      // Проверяем, есть ли уже инициализация хоста (для Python и Go)
      const fileExtension = filePath.split('.').pop()?.toLowerCase() || '';
      const language = getLanguageFromFileExtension(fileExtension);
      const isPython = language === 'python' || language === 'py';
      const isGo = language === 'go';
      
      if ((isPython || isGo) && !hasHostInit(safeFilePath)) {
        if (isPython) {
          const fileHasHostInit = fileContent.includes('_rootrace_host') && fileContent.includes('RooTrace [init]');
          
          if (!fileHasHostInit) {
            const initCode = generatePythonHostInitCode();
            
            let insertLineIndex = 0;
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim();
              if (line.startsWith('#') || line === '') {
                continue;
              }
              insertLineIndex = i;
              break;
            }
            
            lines.splice(insertLineIndex, 0, ...initCode.split('\n'));
            fileContent = lines.join('\n');
            markHostInit(safeFilePath);
          } else {
            markHostInit(safeFilePath);
          }
        } else if (isGo) {
          const fileHasHostInit = fileContent.includes('rootraceHost') && fileContent.includes('RooTrace [init]');
          
          if (!fileHasHostInit) {
            fileContent = ensureGoProbeImports(fileContent);
            lines = fileContent.split('\n');
            
            const initCode = generateGoHostInitCode(fileContent);
            
            let insertLineIndex = 0;
            let foundPackage = false;
            let foundImports = false;
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim();
              if (line.startsWith('package ')) {
                foundPackage = true;
                continue;
              }
              if (foundPackage && (line.startsWith('import ') || line === 'import (')) {
                foundImports = true;
                if (line === 'import (' || line.startsWith('import (')) {
                  let j = i + 1;
                  while (j < lines.length && !lines[j].trim().startsWith(')')) {
                    j++;
                  }
                  if (j < lines.length) {
                    i = j;
                    continue;
                  }
                }
                continue;
              }
              if (foundPackage && (foundImports || !line.startsWith('import'))) {
                if (line !== '' && !line.startsWith('//') && !line.startsWith('/*')) {
                  insertLineIndex = i;
                  break;
                }
              }
            }
            
            if (!foundPackage) {
              insertLineIndex = 0;
            } else if (insertLineIndex === 0 && foundPackage) {
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim().startsWith('package ')) {
                  insertLineIndex = i + 1;
                  break;
                }
              }
            }
            
            lines.splice(insertLineIndex, 0, ...initCode.split('\n'));
            fileContent = lines.join('\n');
            markHostInit(safeFilePath);
          } else {
            fileContent = ensureGoProbeImports(fileContent);
            lines = fileContent.split('\n');
            markHostInit(safeFilePath);
          }
        }
      }
      
      // Проверяем, что номер строки допустим
      if (lineNumber < 1 || lineNumber > lines.length) {
        return {
          success: false,
          message: `Line number ${lineNumber} is out of range. Document has ${lines.length} lines.`
        };
      }

      // Генерируем короткий уникальный ID для этой пробы
      const probeId = Math.random().toString(36).substring(2, 6);
      
      // Используем переданный probeCode или генерируем автоматически
      let finalProbeCode: string;
      const commentChar = language === 'python' || language === 'py' ? '#' : '//';
      
      if (probeCode && probeCode.trim().length > 0) {
        finalProbeCode = probeCode.replace(/\\n/g, '\n');
        const hypothesisPrefix = hypothesisId ? `Hypothesis ${hypothesisId}: ` : '';
        finalProbeCode = `${commentChar} RooTrace [id: ${probeId}] ${hypothesisPrefix}${message}\n${finalProbeCode}\n${commentChar} RooTrace [id: ${probeId}]: end`;
      } else {
        const serverUrl = getServerUrl(undefined, safeFilePath);
        
        console.error(`[RooTrace] Generating probe code: language=${language}, serverUrl=${serverUrl}, hypothesisId=${hypothesisId || 'auto'}, message=${message.substring(0, 50)}...`);
        
        if (!serverUrl) {
          const workspaceRoot = getWorkspaceRoot();
          console.error(`[RooTrace] CRITICAL: Server URL not found! File: ${safeFilePath}, workspaceRoot: ${workspaceRoot}`);
          const rootraceDir = path.join(workspaceRoot, '.rootrace');
          const configPath = path.join(rootraceDir, 'ai_debug_config');
          const portPath = path.join(rootraceDir, 'debug_port');
          console.error(`[RooTrace] Checking config paths: .rootrace exists=${fs.existsSync(rootraceDir)}, config exists=${fs.existsSync(configPath)}, port exists=${fs.existsSync(portPath)}`);
        }
        
        const generatedCode = generateProbeCode(language, probeType, message, serverUrl, hypothesisId);
        
        if (!generatedCode) {
          return {
            success: false,
            message: `Unsupported file type: ${fileExtension}`
          };
        }
        
        const hypothesisPrefix = hypothesisId ? `Hypothesis ${hypothesisId}: ` : '';
        finalProbeCode = `${commentChar} RooTrace [id: ${probeId}] ${hypothesisPrefix}${message}\n${generatedCode}\n${commentChar} RooTrace [id: ${probeId}]: end`;
      }

      // Определяем позицию вставки
      const lineIndex = lineNumber - 1;
      const originalCode = lines[lineIndex];
      const trimmedCode = originalCode.trim();
      
      const position = findInsertionPosition({
        lines,
        lineIndex,
        language,
        originalCode,
        trimmedCode
      });
      
      const { insertIndex, baseIndent } = position;
      
      // Применяем отступы к коду пробы
      const indentedProbeLines = applyIndentation(finalProbeCode, baseIndent, language);
      
      // Создаем новый массив строк с вставленными пробами
      const newLines = [...lines];
      newLines.splice(insertIndex, 0, ...indentedProbeLines);

      // Записываем измененное содержимое обратно в файл
      const newContent = newLines.join('\n');
      await fs.promises.writeFile(safeFilePath, newContent, 'utf8');
      
      // Проверяем синтаксис ПОСЛЕ записи
      const syntaxCheck = await validateSyntax(safeFilePath, language);
      
      // Если синтаксис сломан - откатываем файл немедленно!
      if (!syntaxCheck.passed) {
        await fs.promises.writeFile(safeFilePath, fileContent, 'utf8');
        return {
          success: false,
          message: `Syntax check failed: ${syntaxCheck.errors?.[0] || 'Unknown syntax error'}`,
          insertedCode: undefined,
          syntaxCheck: syntaxCheck,
          rollback: true
        };
      }
      
      // Определяем количество строк пробы для точного удаления
      const probeLinesArray = indentedProbeLines;
      const probeLinesCount = probeLinesArray.length;
      const actualLineNumber = insertIndex + 1;
      
      // Сохраняем информацию о пробе с реальной позицией вставки
      const probeInfo: ProbeInfo = {
        id: probeId,
        filePath,
        lineNumber,
        originalCode,
        injectedCode: finalProbeCode,
        probeType,
        message,
        actualLineNumber: actualLineNumber,
        probeLinesCount: probeLinesCount
      };
      
      registerProbe(probeId, probeInfo);

      const locationMessage = position.adjusted
        ? `Successfully injected ${probeType} probe at ${filePath}:${actualLineNumber} (adjusted from requested line ${lineNumber}${position.adjustmentReason ? `: ${position.adjustmentReason}` : ''})`
        : `Successfully injected ${probeType} probe at ${filePath}:${lineNumber}`;
      
      let finalMessage = locationMessage;
      if (syntaxCheck.warnings && syntaxCheck.warnings.length > 0) {
        finalMessage += `\n⚠️ Warnings:\n${syntaxCheck.warnings.join('\n')}`;
      }
      
      return {
        success: true,
        message: finalMessage,
        insertedCode: finalProbeCode,
        syntaxCheck: syntaxCheck
      };
    });
  } catch (error) {
    return {
      success: false,
      message: `Error injecting probe: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
