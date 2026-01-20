import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { decryptObject, getEncryptionKey } from './encryption-utils';
import { withFileLock } from './file-lock-utils';

const execAsync = promisify(exec);

// Условный импорт vscode - доступен только в контексте VS Code расширения
let vscode: typeof import('vscode') | undefined;
try {
  vscode = require('vscode');
} catch (e) {
  // vscode недоступен (например, в MCP сервере) - это нормально
  vscode = undefined;
}

/**
 * Получает корень рабочей области проекта
 * Использует workspace root из VS Code, если доступен, иначе fallback на process.cwd()
 */
function getProjectRoot(): string {
  if (vscode) {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        return workspaceFolders[0].uri.fsPath;
      }
    } catch (e) {
      // Игнорируем ошибки при доступе к workspace в MCP контексте
    }
  }
  return process.cwd();
}

// Base directory of the project (workspace root)
// Используем функцию для получения актуального workspace root
let PROJECT_ROOT = getProjectRoot();

/**
 * Sanitize and validate a file path to ensure it stays within the project directory.
 * Returns an absolute, normalized path if safe, otherwise throws an error.
 */
function sanitizeFilePath(inputPath: string): string {
  // Обновляем PROJECT_ROOT на случай изменения workspace
  PROJECT_ROOT = getProjectRoot();
  
  // Resolve against current working directory if relative
  const resolved = path.resolve(PROJECT_ROOT, inputPath);
  const normalized = path.normalize(resolved);
  if (!normalized.startsWith(PROJECT_ROOT + path.sep)) {
    throw new Error(`Invalid file path: path traversal detected (${inputPath})`);
  }
  return normalized;
}

// Интерфейс для результата инъекции пробы
interface InjectionResult {
  success: boolean;
  message: string;
  insertedCode?: string;
  syntaxCheck?: {
    passed: boolean;
    errors?: string[];
    warnings?: string[];
  };
  rollback?: boolean; // Флаг, указывающий что файл был откачен из-за ошибки синтаксиса
  error?: string; // Сообщение об ошибке при неудачной инъекции
}

// Интерфейс для информации о пробе
interface ProbeInfo {
  id: string;
  filePath: string;
  lineNumber: number;
  originalCode: string;
  injectedCode: string;
  probeType: string;
  message: string;
  actualLineNumber?: number; // Реальный номер строки, куда была вставлена проба (после корректировки)
  probeLinesCount?: number; // Количество строк пробы (для многострочных проб)
}

// Хранилище для информации о пробах
const probeRegistry = new Map<string, ProbeInfo>();

// Хранилище для отслеживания файлов, в которые уже вставлена инициализация хоста
const filesWithHostInit = new Set<string>();

/**
 * Генерирует код инициализации хоста для Python файлов
 * Определяет правильный хост для Docker окружения с fallback цепочкой
 * @returns Код инициализации, который устанавливает _rootrace_host
 */
function generatePythonHostInitCode(): string {
  // Генерируем код, который определяет правильный хост один раз при загрузке модуля
  // Fallback цепочка:
  // 1. ROO_TRACE_HOST env var (высший приоритет - пользователь может переопределить)
  // 2. Проверка Docker (/.dockerenv или /proc/self/cgroup)
  // 3. Пробуем резолвить host.docker.internal (работает на Mac/Windows/Linux с --add-host)
  // 4. Если не работает - определяем gateway IP через socket.connect(8.8.8.8)
  // 5. Если все не работает - localhost (fallback для локального окружения)
  return `# RooTrace [init] Host detection - устанавливаем _rootrace_host для всех проб
try:
    import os, socket
    _rootrace_host = os.environ.get('ROO_TRACE_HOST')
    if not _rootrace_host:
        is_docker = False
        if os.path.exists('/.dockerenv'):
            is_docker = True
        elif os.path.exists('/proc/self/cgroup'):
            try:
                with open('/proc/self/cgroup', 'r') as f:
                    if 'docker' in f.read():
                        is_docker = True
            except:
                pass
        if is_docker:
            try:
                socket.gethostbyname('host.docker.internal')
                _rootrace_host = 'host.docker.internal'
            except:
                try:
                    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                    s.connect(('8.8.8.8', 80))
                    container_ip = s.getsockname()[0]
                    s.close()
                    _rootrace_host = '.'.join(container_ip.split('.')[:-1]) + '.1'
                except:
                    _rootrace_host = 'localhost'
        else:
            _rootrace_host = 'localhost'
except:
    _rootrace_host = 'localhost'
# RooTrace [init]: end
`;
}

/**
 * Извлекает имя пакета из Go файла
 * @param fileContent - содержимое Go файла
 * @returns имя пакета или 'main' по умолчанию
 */
function extractGoPackageName(fileContent: string): string {
  const packageMatch = fileContent.match(/^package\s+(\w+)/m);
  return packageMatch ? packageMatch[1] : 'main';
}

/**
 * Проверяет, какие импорты уже есть в Go файле
 * @param fileContent - содержимое Go файла
 * @returns объект с информацией о наличии импортов
 */
function checkGoImports(fileContent: string): { hasNet: boolean; hasOs: boolean; hasStrings: boolean; hasHttp: boolean; hasBytes: boolean; hasTime: boolean } {
  return {
    hasNet: /["']net["']/.test(fileContent),
    hasOs: /["']os["']/.test(fileContent),
    hasStrings: /["']strings["']/.test(fileContent),
    hasHttp: /["']net\/http["']/.test(fileContent),
    hasBytes: /["']bytes["']/.test(fileContent),
    hasTime: /["']time["']/.test(fileContent)
  };
}

/**
 * Генерирует код инициализации хоста для Go файлов
 * Определяет правильный хост для Docker окружения с fallback цепочкой
 * @param fileContent - содержимое Go файла (для проверки импортов)
 * @returns Код инициализации, который устанавливает rootraceHost
 */
function generateGoHostInitCode(fileContent: string): string {
  // Проверяем, какие импорты уже есть в файле
  const imports = checkGoImports(fileContent);
  
  // Собираем список недостающих импортов для инициализации
  const neededImports: string[] = [];
  if (!imports.hasNet) neededImports.push('"net"');
  if (!imports.hasOs) neededImports.push('"os"');
  if (!imports.hasStrings) neededImports.push('"strings"');
  
  // Генерируем блок импортов только если нужны новые
  let importBlock = '';
  if (neededImports.length > 0) {
    importBlock = `import (
    ${neededImports.join('\n    ')}
)

`;
  }
  
  // Генерируем код, который определяет правильный хост один раз при загрузке пакета
  // Fallback цепочка аналогична Python
  return `// RooTrace [init] Host detection - устанавливаем rootraceHost для всех проб
${importBlock}var rootraceHost = func() string {
    if host := os.Getenv("ROO_TRACE_HOST"); host != "" {
        return host
    }
    
    // Проверка Docker
    isDocker := false
    if _, err := os.Stat("/.dockerenv"); err == nil {
        isDocker = true
    } else if cgroup, err := os.ReadFile("/proc/self/cgroup"); err == nil {
        isDocker = strings.Contains(string(cgroup), "docker")
    }
    
    if isDocker {
        // Пробуем резолвить host.docker.internal
        if _, err := net.LookupHost("host.docker.internal"); err == nil {
            return "host.docker.internal"
        }
        
        // Определяем gateway IP через dial
        conn, err := net.Dial("udp", "8.8.8.8:80")
        if err == nil {
            localAddr := conn.LocalAddr().(*net.UDPAddr)
            conn.Close()
            // Берем первый 3 октета и добавляем .1
            parts := strings.Split(localAddr.IP.String(), ".")
            if len(parts) == 4 {
                return strings.Join(parts[:3], ".") + ".1"
            }
        }
        return "localhost"
    }
    
    return "localhost"
}()
// RooTrace [init]: end
`;
}

/**
 * Добавляет недостающие импорты в Go файл, если они нужны для проб
 * @param fileContent - содержимое Go файла
 * @returns обновленное содержимое с добавленными импортами
 */
function ensureGoProbeImports(fileContent: string): string {
  const imports = checkGoImports(fileContent);
  const neededForProbes: string[] = [];
  
  // Пробы Go используют: http, bytes, time, strings (strings уже нужен для rootraceHost)
  if (!imports.hasHttp) neededForProbes.push('"net/http"');
  if (!imports.hasBytes) neededForProbes.push('"bytes"');
  if (!imports.hasTime) neededForProbes.push('"time"');
  // strings уже проверяется в generateGoHostInitCode
  
  if (neededForProbes.length === 0) {
    return fileContent; // Все импорты уже есть
  }
  
  // Находим блок импортов и добавляем недостающие
  const lines = fileContent.split('\n');
  let importStart = -1;
  let importEnd = -1;
  let inImportBlock = false;
  let importIndent = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed === 'import (' || trimmed.startsWith('import (')) {
      importStart = i;
      inImportBlock = true;
      importIndent = line.match(/^(\s*)/)?.[1] || '';
      continue;
    }
    
    if (inImportBlock && trimmed === ')') {
      importEnd = i;
      break;
    }
    
    // Однострочный import
    if (trimmed.startsWith('import ')) {
      importStart = i;
      importEnd = i;
      break;
    }
  }
  
  // Если есть блок импортов, добавляем недостающие
  if (importStart >= 0 && importEnd >= importStart) {
    const newLines = [...lines];
    if (inImportBlock && importEnd > importStart) {
      // Многострочный блок - добавляем перед закрывающей скобкой
      neededForProbes.forEach(imp => {
        newLines.splice(importEnd, 0, importIndent + '    ' + imp);
      });
    } else {
      // Однострочный или нужно создать блок
      const importLine = lines[importStart];
      const importLineTrimmed = importLine.trim();
      if (importLineTrimmed.includes('import (')) {
        // Уже есть многострочный блок, но мы не вошли в цикл правильно
        // Добавляем перед закрывающей скобкой
        neededForProbes.forEach(imp => {
          newLines.splice(importEnd + 1, 0, importIndent + '    ' + imp);
        });
      } else {
        // Преобразуем однострочный в многострочный
        const oldImport = lines[importStart];
        newLines[importStart] = importIndent + 'import (';
        newLines.splice(importStart + 1, 0, importIndent + '    ' + oldImport.replace(/^import\s+/, '').replace(/;$/, ','));
        neededForProbes.forEach((imp, idx) => {
          newLines.splice(importStart + 2 + idx, 0, importIndent + '    ' + imp);
        });
        newLines.splice(importStart + 2 + neededForProbes.length, 0, importIndent + ')');
      }
    }
    return newLines.join('\n');
  }
  
  // Если импортов нет вообще, создаем блок после package
  const packageMatch = fileContent.match(/^(package\s+\w+)/m);
  if (packageMatch) {
    const packageLine = packageMatch[1];
    const allImports = ['"net"', '"os"', '"strings"', ...neededForProbes].filter((imp, idx, arr) => arr.indexOf(imp) === idx);
    const importBlock = `import (
    ${allImports.join('\n    ')}
)`;
    return fileContent.replace(packageMatch[0], packageMatch[0] + '\n\n' + importBlock);
  }
  
  return fileContent;
}

/**
 * Получает таймаут для проверки синтаксиса из конфигурации VS Code
 * @returns Таймаут в миллисекундах (по умолчанию 10000)
 */
function getSyntaxCheckTimeout(): number {
  if (vscode) {
    try {
      const config = vscode.workspace.getConfiguration('rooTrace');
      return config.get<number>('syntaxCheckTimeout', 10000);
    } catch (e) {
      // Игнорируем ошибки при доступе к конфигурации в MCP контексте
    }
  }
  return 10000; // Значение по умолчанию
}

/**
 * Проверяет, включена ли валидация синтаксиса в конфигурации
 * @returns true если валидация включена, false иначе
 */
function isSyntaxValidationEnabled(): boolean {
  if (vscode) {
    try {
      const config = vscode.workspace.getConfiguration('rooTrace');
      return config.get<boolean>('enableSyntaxValidation', true);
    } catch (e) {
      // Игнорируем ошибки при доступе к конфигурации в MCP контексте
    }
  }
  return true; // Значение по умолчанию
}

/**
 * Проверяет синтаксис файла после инжекции пробы
 * @param filePath - путь к файлу
 * @param language - язык программирования
 * @returns Результат проверки синтаксиса
 */
async function validateSyntax(filePath: string, language: string): Promise<{ passed: boolean; errors?: string[]; warnings?: string[] }> {
  try {
    // Проверяем, включена ли валидация синтаксиса
    if (!isSyntaxValidationEnabled()) {
      return { passed: true, warnings: ['Syntax validation is disabled in settings'] };
    }

    const safeFilePath = sanitizeFilePath(filePath);
    
    // Проверяем существование файла
    if (!fs.existsSync(safeFilePath)) {
      return { passed: false, errors: ['File does not exist'] };
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const timeout = getSyntaxCheckTimeout();

    switch (language.toLowerCase()) {
      case 'python':
      case 'py': {
        // Используем py_compile для проверки синтаксиса Python
        try {
          // Экранируем путь для shell
          const escapedPath = safeFilePath.replace(/"/g, '\\"');
          const { stderr, stdout } = await execAsync(`python3 -m py_compile "${escapedPath}"`, { timeout });
          const output = (stderr || stdout || '').trim();
          if (output && !output.includes('SyntaxError') && !output.includes('IndentationError')) {
            // Если есть вывод, но это не синтаксическая ошибка, это может быть предупреждение
            warnings.push(output);
          }
        } catch (error: any) {
          // py_compile возвращает ошибку через exception при синтаксических ошибках
          const errorOutput = (error.stderr || error.stdout || error.message || String(error)).trim();
          // Извлекаем только информацию об ошибке синтаксиса
          if (errorOutput.includes('SyntaxError') || errorOutput.includes('IndentationError') || 
              errorOutput.includes('File') && errorOutput.includes('line')) {
            errors.push(errorOutput);
          } else if (errorOutput.includes('command not found') || errorOutput.includes('python3: command not found')) {
            warnings.push('Python3 not found in PATH, syntax check skipped');
          } else {
            // Другие ошибки (например, проблемы с импортами) не являются синтаксическими
            warnings.push(`Python check warning: ${errorOutput.substring(0, 200)}`);
          }
        }
        break;
      }

      case 'javascript':
      case 'js':
      case 'jsx': {
        // Используем node --check для проверки синтаксиса JavaScript
        try {
          const { stderr } = await execAsync(`node --check "${safeFilePath}"`, { timeout });
          if (stderr) {
            errors.push(stderr);
          }
        } catch (error: any) {
          const errorMsg = error.stderr || error.message || String(error);
          errors.push(errorMsg);
        }
        break;
      }

      case 'typescript':
      case 'ts':
      case 'tsx': {
        // Для TypeScript проверяем через tsc, если доступен
        try {
          // Используем --noEmit для проверки без генерации файлов
          // --skipLibCheck пропускает проверку библиотек
          // --isolatedModules для более строгой проверки
          const { stderr, stdout } = await execAsync(`tsc --noEmit --skipLibCheck --isolatedModules "${safeFilePath}" 2>&1`, { timeout });
          const output = (stderr || stdout || '').trim();
          if (output && !output.includes('Found 0 errors') && !output.includes('error TS')) {
            // Если есть реальные ошибки (не просто предупреждения о отсутствии tsconfig)
            if (output.includes('error TS')) {
              errors.push(output);
            } else if (!output.includes('Cannot find name') && !output.includes('Cannot find module')) {
              // Игнорируем ошибки о неопределенных модулях/типах, но проверяем синтаксис
              warnings.push(`TypeScript check: ${output.substring(0, 200)}`);
            }
          }
        } catch (error: any) {
          const errorOutput = (error.stderr || error.stdout || error.message || String(error)).trim();
          // Если tsc не найден или tsconfig отсутствует, пробуем node --check как fallback
          if (errorOutput.includes('command not found') || errorOutput.includes('Cannot find') || errorOutput.includes('tsconfig')) {
            try {
              const { stderr } = await execAsync(`node --check "${safeFilePath}"`, { timeout });
              if (stderr) {
                warnings.push(`TypeScript check skipped (tsc not available or no tsconfig), JS syntax check: ${stderr.substring(0, 200)}`);
              }
            } catch (jsError: any) {
              const jsErrorMsg = jsError.stderr || jsError.message || String(jsError);
              // Проверяем только синтаксические ошибки, игнорируем ошибки выполнения
              if (jsErrorMsg.includes('SyntaxError') || jsErrorMsg.includes('Unexpected token')) {
                errors.push(`JavaScript syntax error: ${jsErrorMsg.substring(0, 200)}`);
              } else {
                warnings.push(`TypeScript/JavaScript check skipped: ${jsErrorMsg.substring(0, 200)}`);
              }
            }
          } else {
            // Реальная ошибка компиляции TypeScript
            errors.push(`TypeScript compilation error: ${errorOutput.substring(0, 500)}`);
          }
        }
        break;
      }

      case 'java': {
        // Для Java используем javac для проверки синтаксиса
        try {
          const { stderr } = await execAsync(`javac -Xlint:all "${safeFilePath}"`, { timeout });
          if (stderr) {
            // javac может выводить предупреждения в stderr, но это не всегда ошибки
            if (stderr.includes('error:')) {
              errors.push(stderr);
            } else {
              warnings.push(stderr);
            }
          }
        } catch (error: any) {
          const errorMsg = error.stderr || error.message || String(error);
          // javac может требовать classpath, поэтому это может быть не критично
          warnings.push(`Java syntax check skipped: ${errorMsg}`);
        }
        break;
      }

      case 'go': {
        // Для Go используем go build для проверки синтаксиса
        try {
          const { stderr } = await execAsync(`go build -o /dev/null "${safeFilePath}"`, { timeout });
          if (stderr) {
            errors.push(stderr);
          }
        } catch (error: any) {
          const errorMsg = error.stderr || error.message || String(error);
          // Проверяем, является ли это синтаксической ошибкой или ошибкой компиляции
          if (errorMsg.includes('syntax error') || errorMsg.includes('unexpected')) {
            errors.push(errorMsg);
          } else if (errorMsg.includes('command not found')) {
            warnings.push('Go compiler not found in PATH, syntax check skipped');
          } else {
            // Другие ошибки (например, отсутствие зависимостей) не являются синтаксическими
            warnings.push(`Go check warning: ${errorMsg.substring(0, 200)}`);
          }
        }
        break;
      }

      case 'rust':
      case 'rs': {
        // Для Rust используем rustc для проверки синтаксиса
        try {
          const { stderr } = await execAsync(`rustc --crate-type lib --edition 2021 "${safeFilePath}" 2>&1`, { timeout });
          if (stderr) {
            // rustc выводит ошибки в stderr
            if (stderr.includes('error:') && (stderr.includes('expected') || stderr.includes('unexpected') || stderr.includes('syntax'))) {
              errors.push(stderr);
            } else if (stderr.includes('error:')) {
              // Другие ошибки компиляции (например, отсутствие зависимостей) не являются синтаксическими
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
        break;
      }

      case 'cpp':
      case 'c++':
      case 'cxx':
      case 'cc': {
        // Для C++ используем g++ или clang++ для проверки синтаксиса
        try {
          // Пробуем сначала g++, потом clang++
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
        break;
      }

      case 'php': {
        // Для PHP используем php -l для проверки синтаксиса
        try {
          const { stderr, stdout } = await execAsync(`php -l "${safeFilePath}"`, { timeout });
          const output = (stderr || stdout || '').trim();
          if (output.includes('Parse error') || output.includes('syntax error')) {
            errors.push(output);
          } else if (output && !output.includes('No syntax errors')) {
            warnings.push(output);
          }
        } catch (error: any) {
          const errorMsg = error.stderr || error.stdout || error.message || String(error);
          if (errorMsg.includes('Parse error') || errorMsg.includes('syntax error')) {
            errors.push(errorMsg);
          } else if (errorMsg.includes('command not found') || errorMsg.includes('php: command not found')) {
            warnings.push('PHP not found in PATH, syntax check skipped');
          } else {
            warnings.push(`PHP check skipped: ${errorMsg.substring(0, 200)}`);
          }
        }
        break;
      }

      case 'ruby':
      case 'rb': {
        // Для Ruby используем ruby -c для проверки синтаксиса
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
        break;
      }

      case 'csharp':
      case 'cs': {
        // Для C# используем csc или dotnet для проверки синтаксиса
        try {
          // Пробуем сначала dotnet, потом csc
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
        break;
      }

      case 'swift': {
        // Для Swift используем swiftc для проверки синтаксиса
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
        break;
      }

      case 'kotlin':
      case 'kt':
      case 'kts': {
        // Для Kotlin используем kotlinc для проверки синтаксиса
        try {
          const { stderr } = await execAsync(`kotlinc -script "${safeFilePath}" 2>&1`, { timeout });
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
            warnings.push('Kotlin compiler not found in PATH, syntax check skipped');
          } else {
            warnings.push(`Kotlin check skipped: ${errorMsg.substring(0, 200)}`);
          }
        }
        break;
      }

      // Для других языков пока пропускаем проверку
      default:
        warnings.push(`Syntax validation not implemented for ${language}`);
    }

    return {
      passed: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  } catch (error) {
    return {
      passed: false,
      errors: [`Syntax validation failed: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

/**
 * Находит корень рабочей области, ища маркерные файлы (.ai_debug_config, .debug_port, .git)
 * @param filePath - путь к файлу, от которого начинать поиск
 * @returns путь к корню рабочей области или null
 */
function findWorkspaceRoot(filePath: string): string | null {
  try {
    let currentPath = path.resolve(filePath);
    
    // Если путь существует и это файл, берем его директорию
    // Если путь не существует, предполагаем что это файл и берем директорию
    if (fs.existsSync(currentPath)) {
      if (!fs.statSync(currentPath).isDirectory()) {
        currentPath = path.dirname(currentPath);
      }
    } else {
      // Файл еще не существует, берем директорию из пути
      currentPath = path.dirname(currentPath);
    }
    
    // Поднимаемся вверх по директориям, ища маркерные файлы
    let searchPath = currentPath;
    const root = path.parse(searchPath).root;
    
    while (searchPath !== root) {
      // Проверяем наличие маркерных файлов (в .rootrace или старые в корне)
      const rootraceDir = path.join(searchPath, '.rootrace');
      const hasConfigInRootrace = fs.existsSync(path.join(rootraceDir, 'ai_debug_config'));
      const hasPortInRootrace = fs.existsSync(path.join(rootraceDir, 'debug_port'));
      const hasConfig = fs.existsSync(path.join(searchPath, '.ai_debug_config'));
      const hasPort = fs.existsSync(path.join(searchPath, '.debug_port'));
      const hasGit = fs.existsSync(path.join(searchPath, '.git'));
      const hasRoo = fs.existsSync(path.join(searchPath, '.roo'));
      
      if (hasConfigInRootrace || hasPortInRootrace || hasConfig || hasPort || hasGit || hasRoo) {
        return searchPath;
      }
      
      // Поднимаемся на уровень выше
      const parentPath = path.dirname(searchPath);
      if (parentPath === searchPath) {
        break; // Достигли корня файловой системы
      }
      searchPath = parentPath;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Проверяет, является ли проект Docker-проектом (есть Dockerfile или docker-compose.yml в корне)
 * @param projectRoot - корень проекта
 * @returns true если найдены Docker файлы
 */
/**
 * Читает URL сервера из .ai_debug_config файла или .debug_port файла
 * Ищет конфиг в рабочей области, начиная от указанного пути или PROJECT_ROOT
 * ВСЕГДА возвращает localhost - определение Docker окружения происходит во время выполнения через _rootrace_host/rootraceHost
 * @param workspacePath - путь к рабочей области (опционально)
 * @param filePath - путь к файлу, для которого нужен URL (используется для поиска рабочей области)
 * @returns URL сервера (всегда с localhost) или null, если файл не найден
 */
export function getServerUrl(workspacePath?: string, filePath?: string): string | null {
  try {
    // Определяем базовый путь для поиска конфига
    let basePath: string | null = null;
    
    // 1. Используем переданный workspacePath, если есть
    if (workspacePath) {
      basePath = path.resolve(workspacePath);
    }
    // 2. Если есть filePath, пытаемся найти рабочую область от него
    else if (filePath) {
      basePath = findWorkspaceRoot(filePath);
    }
    // 3. Fallback на PROJECT_ROOT
    if (!basePath) {
      basePath = PROJECT_ROOT;
    }
    
    // Сначала пытаемся прочитать из .rootrace/ai_debug_config (предпочтительный способ)
    const rootraceDir = path.join(basePath, '.rootrace');
    const configPathInRootrace = path.join(rootraceDir, 'ai_debug_config');
    const configPathOld = path.join(basePath, '.ai_debug_config'); // Старый путь для обратной совместимости
    
    // Пробуем сначала .rootrace, потом старый путь
    const configPath = fs.existsSync(configPathInRootrace) ? configPathInRootrace : configPathOld;
    
    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        
        // Try to parse as JSON first (for backwards compatibility)
        let config: { url: string } | null = null;
        try {
          config = JSON.parse(configContent);
        } catch (parseError) {
          // If JSON parsing fails, try to decrypt
          try {
            const encryptionKey = getEncryptionKey();
            config = decryptObject(configContent, encryptionKey);
          } catch (decryptError) {
            // Если не удалось расшифровать, пробуем .debug_port
            config = null;
          }
        }
        
        if (config && config.url) {
          // ВСЕГДА возвращаем URL как есть - определение Docker происходит во время выполнения
          // через _rootrace_host (Python) или rootraceHost (Go)
          return config.url;
        }
      } catch (error) {
        // Если ошибка чтения конфига, пробуем .debug_port
      }
    }
    
    // Fallback 1: пытаемся прочитать порт из .rootrace/debug_port или .debug_port (старый путь)
    const portFilePathInRootrace = path.join(rootraceDir, 'debug_port');
    const portFilePathOld = path.join(basePath, '.debug_port');
    const portFilePath = fs.existsSync(portFilePathInRootrace) ? portFilePathInRootrace : portFilePathOld;
    if (fs.existsSync(portFilePath)) {
      try {
        const portContent = fs.readFileSync(portFilePath, 'utf8').trim();
        const port = parseInt(portContent, 10);
        if (!isNaN(port) && port > 0 && port < 65536) {
          // ВСЕГДА используем localhost - определение Docker происходит во время выполнения
          // через _rootrace_host (Python) или rootraceHost (Go)
          return `http://localhost:${port}/`;
        }
      } catch (error) {
        // Игнорируем ошибки чтения .debug_port
      }
    }
    
    // Fallback 2: используем стандартный порт (51234)
    // ВСЕГДА используем localhost - определение Docker происходит во время выполнения
    // через _rootrace_host (Python) или rootraceHost (Go)
    return `http://localhost:51234/`;
  } catch (error) {
    return null;
  }
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
 * 
 * @example
 * ```typescript
 * const result = await injectProbe('src/app.py', 42, 'log', 'Checking user input');
 * if (result.success) {
 *   console.log('Probe injected successfully');
 * } else {
 *   console.error('Failed to inject probe:', result.message);
 * }
 * ```
 * 
 * @throws {Error} Если путь к файлу невалиден или файл не существует
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
    // Message может быть пустым, если передан probeCode
    if (typeof message !== 'string') {
      return { success: false, message: 'Invalid message parameter (must be a string)' };
    }
    
    // Если probeCode не передан, message обязателен
    if (!probeCode && message.length === 0) {
      return { success: false, message: 'Message parameter is required when probeCode is not provided' };
    }

    // Асинхронно проверяем, существует ли файл
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
      
      if ((isPython || isGo) && !filesWithHostInit.has(safeFilePath)) {
        if (isPython) {
          // Проверяем, есть ли уже переменная _rootrace_host или инициализация
          const hasHostInit = fileContent.includes('_rootrace_host') && fileContent.includes('RooTrace [init]');
          
          if (!hasHostInit) {
            // Вставляем инициализацию хоста в начало файла (после импортов или в самом начале)
            const initCode = generatePythonHostInitCode();
            
            // Ищем место для вставки: после импортов или в начало файла
            let insertLineIndex = 0;
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim();
              // Пропускаем комментарии в начале файла и пустые строки
              if (line.startsWith('#') || line === '') {
                continue;
              }
              // Если нашли не-комментарий и не-пустую строку - это начало кода
              insertLineIndex = i;
              break;
            }
            
            // Вставляем инициализацию
            lines.splice(insertLineIndex, 0, ...initCode.split('\n'));
            fileContent = lines.join('\n');
            filesWithHostInit.add(safeFilePath);
          } else {
            // Инициализация уже есть
            filesWithHostInit.add(safeFilePath);
          }
        } else if (isGo) {
          // Проверяем, есть ли уже переменная rootraceHost или инициализация
          const hasHostInit = fileContent.includes('rootraceHost') && fileContent.includes('RooTrace [init]');
          
          if (!hasHostInit) {
            // Убеждаемся что все нужные импорты есть для проб (http, bytes, time)
            fileContent = ensureGoProbeImports(fileContent);
            lines = fileContent.split('\n');
            
            // Генерируем код инициализации
            const initCode = generateGoHostInitCode(fileContent);
            
            // Ищем место для вставки: после package declaration и импортов, перед первым кодом
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
                // Пропускаем блок импортов
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
              // После package и импортов ищем первый код (не комментарий, не пустая строка)
              if (foundPackage && (foundImports || !line.startsWith('import'))) {
                if (line !== '' && !line.startsWith('//') && !line.startsWith('/*')) {
                  insertLineIndex = i;
                  break;
                }
              }
            }
            
            // Если package не найден, вставляем в начало
            if (!foundPackage) {
              insertLineIndex = 0;
            } else if (insertLineIndex === 0 && foundPackage) {
              // Если не нашли место после импортов, вставляем после package
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim().startsWith('package ')) {
                  insertLineIndex = i + 1;
                  break;
                }
              }
            }
            
            // Вставляем инициализацию
            lines.splice(insertLineIndex, 0, ...initCode.split('\n'));
            fileContent = lines.join('\n');
            filesWithHostInit.add(safeFilePath);
          } else {
            // Инициализация уже есть, но нужно проверить импорты для проб
            fileContent = ensureGoProbeImports(fileContent);
            lines = fileContent.split('\n');
            filesWithHostInit.add(safeFilePath);
          }
        }
      }
      
      // Проверяем, что номер строки допустим (проверка после получения lock, но перед основной логикой)
      if (lineNumber < 1 || lineNumber > lines.length) {
        return {
          success: false,
          message: `Line number ${lineNumber} is out of range. Document has ${lines.length} lines.`
        };
      }

      // Язык уже определен выше (для Python инициализации)
      
      // Генерируем короткий уникальный ID для этой пробы (формат: a1b2)
      const probeId = Math.random().toString(36).substring(2, 6);
      
      // Используем переданный probeCode или генерируем автоматически
      let finalProbeCode: string;
      // Определяем тип комментария для языка
      const commentChar = language === 'python' || language === 'py' ? '#' : '//';
      
      if (probeCode && probeCode.trim().length > 0) {
        // Используем переданный код пробы
        // Нормализуем переносы строк: заменяем экранированные \n на реальные переносы
        finalProbeCode = probeCode.replace(/\\n/g, '\n');
        
        // Оборачиваем код в маркеры с UUID для точного удаления
        // Формат: // RooTrace [id: a1b2] Hypothesis H1: message
        //         ...код пробы...
        //         // RooTrace [id: a1b2]: end
        const hypothesisPrefix = hypothesisId ? `Hypothesis ${hypothesisId}: ` : '';
        finalProbeCode = `${commentChar} RooTrace [id: ${probeId}] ${hypothesisPrefix}${message}\n${finalProbeCode}\n${commentChar} RooTrace [id: ${probeId}]: end`;
      } else {
        // Генерируем код пробы для конкретного языка
        // Пытаемся найти рабочую область для чтения конфига
        // Используем путь к файлу для поиска рабочей области
        const serverUrl = getServerUrl(undefined, safeFilePath);
        
        // Логируем URL для диагностики (видно в MCP сервере)
        console.error(`[RooTrace] Generating probe code: language=${language}, serverUrl=${serverUrl}, hypothesisId=${hypothesisId || 'auto'}, message=${message.substring(0, 50)}...`);
        
        // КРИТИЧЕСКИ ВАЖНО: Если URL не найден, это критическая ошибка
        if (!serverUrl) {
          console.error(`[RooTrace] CRITICAL: Server URL not found! File: ${safeFilePath}, PROJECT_ROOT: ${PROJECT_ROOT}`);
          // Проверяем, существует ли .rootrace директория
          const rootraceDir = path.join(PROJECT_ROOT, '.rootrace');
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
        
        // Оборачиваем сгенерированный код в маркеры с UUID
        const hypothesisPrefix = hypothesisId ? `Hypothesis ${hypothesisId}: ` : '';
        finalProbeCode = `${commentChar} RooTrace [id: ${probeId}] ${hypothesisPrefix}${message}\n${generatedCode}\n${commentChar} RooTrace [id: ${probeId}]: end`;
      }

      // Вставляем пробу перед указанной строкой (индексация с 0)
      const lineIndex = lineNumber - 1;
      const originalCode = lines[lineIndex];
      const trimmedCode = originalCode.trim();
    
    // Определяем отступ целевой строки для правильной вставки пробы
    // Для Python критично сохранять правильные отступы
    const indentMatch = originalCode.match(/^(\s*)/);
    let baseIndent = indentMatch ? indentMatch[1] : '';
    let insertIndex = lineIndex;
    
    // 🐍 PYTHON INDENTATION SAFETY: Автоматическая страховка от ошибок LLM
    // Для Python файлов программно вычисляем отступ из строки перед вставкой
    // и гарантируем, что baseIndent установлен правильно
    if ((language === 'python' || language === 'py') && lineIndex >= 0 && lineIndex < lines.length) {
      const targetLine = lines[lineIndex];
      const targetIndentMatch = targetLine.match(/^(\s*)/);
      const targetIndent = targetIndentMatch ? targetIndentMatch[1] : '';
      
      // Принудительно используем отступ целевой строки для Python
      // Это предотвращает ошибки, когда LLM неправильно угадывает отступы
      if (targetIndent.length > 0) {
        baseIndent = targetIndent;
      }
    }
    
    // Для Python: если целевая строка - это определение функции/метода (def),
    // нужно вставить код ВНУТРИ функции, а не перед её определением
    if ((language === 'python' || language === 'py')) {
      // Проверяем, является ли целевая строка return statement или другим statement, после которого код недостижим
      // Если да, вставляем ПЕРЕД этой строкой
      if (trimmedCode.startsWith('return ') || trimmedCode.startsWith('raise ') || 
          trimmedCode.startsWith('break ') || trimmedCode.startsWith('continue ') ||
          trimmedCode === 'return' || trimmedCode === 'raise' || trimmedCode === 'break' || trimmedCode === 'continue') {
        // Вставляем перед return/raise/break/continue
        insertIndex = lineIndex;
        baseIndent = indentMatch ? indentMatch[1] : '';
      }
      // Проверяем, является ли СЛЕДУЮЩАЯ строка return (значит бот указал строку перед return)
      else if (lineIndex + 1 < lines.length) {
        const nextLine = lines[lineIndex + 1];
        const nextTrimmed = nextLine.trim();
        if (nextTrimmed.startsWith('return ') || nextTrimmed.startsWith('raise ') || 
            nextTrimmed.startsWith('break ') || nextTrimmed.startsWith('continue ') ||
            nextTrimmed === 'return' || nextTrimmed === 'raise' || nextTrimmed === 'break' || nextTrimmed === 'continue') {
          // Вставляем перед следующей строкой (которая является return)
          insertIndex = lineIndex + 1;
          const nextIndentMatch = nextLine.match(/^(\s*)/);
          baseIndent = nextIndentMatch ? nextIndentMatch[1] : '';
        }
      }
      // Проверяем, является ли ПРЕДЫДУЩАЯ строка return (значит бот указал строку после return)
      // Это критично - код после return недостижим!
      if (lineIndex > 0 && (trimmedCode === '' || trimmedCode.startsWith('#'))) {
        const prevLine = lines[lineIndex - 1];
        const prevTrimmed = prevLine.trim();
        if (prevTrimmed.startsWith('return ') || prevTrimmed.startsWith('raise ') || 
            prevTrimmed.startsWith('break ') || prevTrimmed.startsWith('continue ') ||
            prevTrimmed === 'return' || prevTrimmed === 'raise' || prevTrimmed === 'break' || prevTrimmed === 'continue') {
          // Вставляем ПЕРЕД предыдущей строкой (которая является return), а не после
          insertIndex = lineIndex - 1;
          const prevIndentMatch = prevLine.match(/^(\s*)/);
          baseIndent = prevIndentMatch ? prevIndentMatch[1] : '';
        }
      }
      // Также проверяем, если целевая строка сама по себе является строкой после return
      else if (lineIndex > 0) {
        const prevLine = lines[lineIndex - 1];
        const prevTrimmed = prevLine.trim();
        const prevIndentMatch = prevLine.match(/^(\s*)/);
        const prevIndent = prevIndentMatch ? prevIndentMatch[1] : '';
        const currentIndent = indentMatch ? indentMatch[1] : '';
        
        // Если предыдущая строка - return, а текущая имеет тот же или больший отступ, значит это недостижимый код
        if ((prevTrimmed.startsWith('return ') || prevTrimmed.startsWith('raise ') || 
            prevTrimmed.startsWith('break ') || prevTrimmed.startsWith('continue ') ||
            prevTrimmed === 'return' || prevTrimmed === 'raise' || prevTrimmed === 'break' || prevTrimmed === 'continue') &&
            currentIndent.length >= prevIndent.length && trimmedCode !== '') {
          // Вставляем ПЕРЕД предыдущей строкой (которая является return)
          insertIndex = lineIndex - 1;
          baseIndent = prevIndent;
        }
      }
      // Проверяем, является ли целевая строка определением функции/метода
      if (trimmedCode.startsWith('def ') || trimmedCode.startsWith('async def ')) {
        // Определяем отступ для тела функции (обычно +4 пробела или +1 таб от def)
        const defIndent = indentMatch ? indentMatch[1] : '';
        // Стандартный отступ для тела функции в Python - 4 пробела или 1 таб
        const bodyIndent = defIndent + (defIndent.includes('\t') ? '\t' : '    ');
        
        // Ищем первую строку тела функции (следующая непустая строка с отступом >= bodyIndent)
        // или вставляем после строки с def, если тело пустое
        let foundBodyLine = false;
        for (let i = lineIndex + 1; i < lines.length; i++) {
          const nextLine = lines[i];
          const nextIndentMatch = nextLine.match(/^(\s*)/);
          const nextIndent = nextIndentMatch ? nextIndentMatch[1] : '';
          
          // Если следующая строка пустая или комментарий, пропускаем
          if (nextLine.trim() === '' || nextLine.trim().startsWith('#')) {
            continue;
          }
          
          // Если следующая строка имеет отступ >= bodyIndent, это тело функции
          if (nextIndent.length >= bodyIndent.length) {
            insertIndex = i;
            baseIndent = nextIndent;
            foundBodyLine = true;
            break;
          }
          
          // Если следующая строка имеет меньший отступ, значит мы вышли из функции
          if (nextIndent.length <= defIndent.length && nextLine.trim() !== '') {
            // Вставляем после строки с def, используя стандартный отступ тела
            insertIndex = lineIndex + 1;
            baseIndent = bodyIndent;
            foundBodyLine = true;
            break;
          }
        }
        
        // Если не нашли тело функции, вставляем после строки с def
        if (!foundBodyLine) {
          insertIndex = lineIndex + 1;
          baseIndent = bodyIndent;
        }
      } else {
        // Если это не определение функции и не return/raise/break/continue, используем стандартную логику
        // Но только если мы еще не установили insertIndex выше
        if (insertIndex === lineIndex) {
          // Стандартная логика для других случаев
          if (!baseIndent || trimmedCode === '') {
            // Ищем предыдущую непустую строку с отступом
            for (let i = lineIndex - 1; i >= 0; i--) {
              const prevLine = lines[i];
              const prevIndentMatch = prevLine.match(/^(\s*)/);
              if (prevIndentMatch && prevLine.trim() !== '') {
                // Используем отступ предыдущей строки
                baseIndent = prevIndentMatch[1];
                break;
              }
            }
          }
          
          // Если все еще нет отступа, используем отступ строки выше или минимальный
          if (!baseIndent && lineIndex > 0) {
            const prevLine = lines[lineIndex - 1];
            const prevIndentMatch = prevLine.match(/^(\s*)/);
            if (prevIndentMatch) {
              baseIndent = prevIndentMatch[1];
            }
          }
        }
      }
    }
    
      // Разбиваем код пробы на строки для правильной вставки с отступами
      const probeLines = finalProbeCode.split('\n');
      const indentedProbeLines = probeLines.map((line, index) => {
        // Определяем, нужны ли отступы для этого языка
        const needsIndent = language === 'python' || language === 'py' || 
                           language === 'java' || language === 'csharp' || language === 'cs' ||
                           language === 'scala' || language === 'sc' || language === 'kotlin' ||
                           language === 'go' || language === 'ruby' || language === 'rb' ||
                           language === 'swift' || language === 'rust' || language === 'rs' ||
                           language === 'dart' || language === 'lua' || language === 'perl' ||
                           language === 'r' || language === 'matlab';
        
        // Для первой строки используем baseIndent, для остальных сохраняем относительный отступ
        if (index === 0) {
          // Добавляем отступ к первой строке, если нужен
          if (needsIndent && baseIndent) {
            return baseIndent + line.trimStart();
          }
          return line;
        } else {
          // Для последующих строк определяем относительный отступ
          const lineIndentMatch = line.match(/^(\s*)/);
          const lineIndent = lineIndentMatch ? lineIndentMatch[1] : '';
          const firstLineIndent = probeLines[0].match(/^(\s*)/)?.[1] || '';
          
          // Вычисляем относительный отступ
          const relativeIndent = lineIndent.length - firstLineIndent.length;
          
          // Применяем baseIndent + относительный отступ
          if (needsIndent && baseIndent) {
            const additionalIndent = ' '.repeat(Math.max(0, relativeIndent));
            return baseIndent + additionalIndent + line.trimStart();
          }
          return line;
        }
      });
      
      // Создаем новый массив строк с вставленными пробами
      const newLines = [...lines];
      newLines.splice(insertIndex, 0, ...indentedProbeLines);

      // Записываем измененное содержимое обратно в файл
      const newContent = newLines.join('\n');
      await fs.promises.writeFile(safeFilePath, newContent, 'utf8');
      
      // БЕЗОТКАЗНОСТЬ: Проверяем синтаксис ПОСЛЕ записи, но ПЕРЕД фиксацией результата
      const syntaxCheck = await validateSyntax(safeFilePath, language);
      
      // Если синтаксис сломан - откатываем файл немедленно!
      if (!syntaxCheck.passed) {
        // ROLLBACK: Возвращаем файл в исходное состояние
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
      const actualLineNumber = insertIndex + 1; // insertIndex is 0-based, lineNumber is 1-based
      
      // Сохраняем информацию о пробе с реальной позицией вставки
      probeRegistry.set(probeId, {
        id: probeId,
        filePath,
        lineNumber,
        originalCode,
        injectedCode: finalProbeCode, // Сохраняем оригинальный код без отступов
        probeType,
        message,
        actualLineNumber: actualLineNumber, // Реальная позиция вставки
        probeLinesCount: probeLinesCount // Количество строк пробы
      });

      const locationMessage = insertIndex !== lineIndex 
        ? `Successfully injected ${probeType} probe at ${filePath}:${actualLineNumber} (adjusted from requested line ${lineNumber} to insert inside function body)`
        : `Successfully injected ${probeType} probe at ${filePath}:${lineNumber}`;
      
      // Если есть предупреждения, добавляем их в сообщение
      let finalMessage = locationMessage;
      if (syntaxCheck.warnings && syntaxCheck.warnings.length > 0) {
        finalMessage += `\n⚠️ Warnings:\n${syntaxCheck.warnings.join('\n')}`;
      }
      
      return {
        success: true,
        message: finalMessage,
        insertedCode: finalProbeCode, // Возвращаем оригинальный код без отступов для отображения
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

/**
 * Функция для удаления пробы по ID
 * @param filePath - путь к файлу
 * @param probeId - ID пробы для удаления
 * @returns Результат удаления
 */
export async function removeProbe(filePath: string, probeId: string): Promise<InjectionResult> {
  try {
    // Sanitize file path
    let safeFilePath: string;
    try {
      safeFilePath = sanitizeFilePath(filePath);
    } catch (e) {
      return {
        success: false,
        message: `Invalid file path: ${filePath} - ${e instanceof Error ? e.message : String(e)}`
      };
    }

    // Проверяем, существует ли проба в реестре
    const probeInfo = probeRegistry.get(probeId);
    
    if (!probeInfo || probeInfo.filePath !== filePath) {
      return {
        success: false,
        message: `Probe with ID ${probeId} not found in file ${filePath}`
      };
    }

    // Читаем содержимое файла
    const fileContent = await fs.promises.readFile(safeFilePath, 'utf8');
    const lines = fileContent.split('\n');

    // Ищем пробу в файле - используем более гибкий поиск
    // Сначала пытаемся найти по полному совпадению injectedCode
    let probeLineIndex = -1;
    let probeLinesCount = 1; // Количество строк пробы
    
    // Разбиваем injectedCode на строки для поиска многострочных проб
    const probeCodeLines = probeInfo.injectedCode.split('\n').map(line => line.trim());
    
    // Ищем первую строку пробы
    for (let i = 0; i < lines.length; i++) {
      const lineTrimmed = lines[i].trim();
      
      // Проверяем, содержит ли строка ключевые части пробы
      // Ищем по URL сервера или по hypothesisId из сообщения
      const hasProbeMarker = lineTrimmed.includes('urllib.request') || 
                             lineTrimmed.includes('fetch(') ||
                             lineTrimmed.includes('hypothesisId') ||
                             lineTrimmed.includes('RooTrace') ||
                             (probeCodeLines.length > 0 && lineTrimmed.includes(probeCodeLines[0].substring(0, Math.min(50, probeCodeLines[0].length))));
      
      if (hasProbeMarker) {
        // Проверяем, что это действительно наша проба - ищем по message или hypothesisId
        const hasMessage = probeInfo.message ? lineTrimmed.includes(probeInfo.message.substring(0, Math.min(30, probeInfo.message.length))) : false;
        
        if (hasProbeMarker && (hasMessage || probeCodeLines.length === 0 || lineTrimmed.includes(probeCodeLines[0].substring(0, Math.min(30, probeCodeLines[0].length))))) {
          probeLineIndex = i;
          
          // Если проба многострочная, определяем количество строк
          if (probeCodeLines.length > 1) {
            // Проверяем следующие строки
            let foundLines = 1;
            for (let j = 1; j < probeCodeLines.length && i + j < lines.length; j++) {
              const nextLineTrimmed = lines[i + j].trim();
              if (nextLineTrimmed.includes(probeCodeLines[j].substring(0, Math.min(30, probeCodeLines[j].length))) || 
                  nextLineTrimmed === '' || 
                  nextLineTrimmed.startsWith('except') || 
                  nextLineTrimmed.startsWith('} catch') ||
                  nextLineTrimmed.startsWith('}') ||
                  nextLineTrimmed.startsWith('end')) {
                foundLines++;
              } else {
                break;
              }
            }
            probeLinesCount = foundLines;
          }
          break;
        }
      }
    }

    if (probeLineIndex === -1) {
      // Если не нашли по точному совпадению, пробуем найти по частичному совпадению injectedCode
      const probeCodeSearch = probeInfo.injectedCode.substring(0, Math.min(100, probeInfo.injectedCode.length));
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(probeCodeSearch)) {
          probeLineIndex = i;
          break;
        }
      }
    }

    if (probeLineIndex === -1) {
      return {
        success: false,
        message: `Could not locate the probe code in the file. Probe message: "${probeInfo.message}"`
      };
    }

    // Удаляем строки пробы (может быть одна или несколько для многострочных проб)
    const newLines = [...lines];
    newLines.splice(probeLineIndex, probeLinesCount);

    // Записываем измененное содержимое обратно в файл
    const newContent = newLines.join('\n');
    await fs.promises.writeFile(safeFilePath, newContent, 'utf8');

    // Удаляем информацию о пробе из реестра
    probeRegistry.delete(probeId);

    return {
      success: true,
      message: `Successfully removed probe ${probeId} from ${filePath}`
    };
  } catch (error) {
    return {
      success: false,
      message: `Error removing probe: ${error instanceof Error ? error.message : String(error)}`
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
 * 
 * @example
 * ```typescript
 * const code = generateProbeCode('python', 'log', 'User login', 'http://localhost:3000/', 'H1');
 * // Возвращает: try: import urllib.request, json; ...
 * ```
 */
export function generateProbeCode(
  language: string, 
  probeType: 'log' | 'trace' | 'error', 
  message: string,
  serverUrl?: string | null,
  hypothesisId?: string
): string {
  // Генерируем hypothesisId из message, если не указан (H1-H5)
  // Валидируем переданный hypothesisId
  let hId: string;
  if (hypothesisId && /^H[1-5]$/.test(hypothesisId.trim())) {
    hId = hypothesisId.trim();
  } else if (hypothesisId) {
    // Если передан невалидный hypothesisId, генерируем новый
    hId = `H${Math.abs(message.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % 5 + 1}`;
  } else {
    // Генерируем hypothesisId из message (H1-H5)
    hId = `H${Math.abs(message.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % 5 + 1}`;
  }
  
  // Экранируем кавычки в message для использования в коде
  const escapedMessage = message.replace(/"/g, '\\"').replace(/'/g, "\\'");
  
  // Используем serverUrl если передан, иначе пытаемся прочитать из конфига
  // Если URL не найден, генерируем код с предупреждением вместо использования захардкоженного порта
  // Примечание: getServerUrl() без параметров использует PROJECT_ROOT, что может быть неправильным
  // Поэтому лучше всегда передавать serverUrl из injectProbe
  const url = serverUrl || null;
  
  if (!url) {
    // Если URL не найден, возвращаем код с ошибкой, который будет виден при выполнении
    // Это лучше, чем использовать неправильный захардкоженный порт
    const errorMsg = 'RooTrace server URL not configured. Please ensure .ai_debug_config or .debug_port exists.';
    switch (language.toLowerCase()) {
      case 'python':
      case 'py':
        return `raise RuntimeError("${errorMsg}")`;
      case 'javascript':
      case 'typescript':
      case 'js':
      case 'ts':
      case 'jsx':
      case 'tsx':
        return `throw new Error("${errorMsg}");`;
      default:
        return `// ERROR: ${errorMsg}`;
    }
  }
  
  // Генерируем код пробы в зависимости от языка
  switch (language.toLowerCase()) {
    case 'javascript':
    case 'typescript':
    case 'js':
    case 'ts':
      // Добавляем логирование в консоль для JavaScript/TypeScript
      return `try { console.error('[RooTrace Probe] EXECUTING: ${hId} - ${escapedMessage}, URL: ${url}'); fetch('${url}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hypothesisId: '${hId}', message: '${escapedMessage}', state: {} }) }).then(res => { console.error('[RooTrace Probe] SUCCESS: ${hId} - status=' + res.status + ', URL: ${url}'); }).catch(err => { console.error('[RooTrace Probe ERROR] ${hId} - ' + err.name + ': ' + err.message + ', URL: ${url}'); }); } catch(e) { console.error('[RooTrace Probe ERROR] ${hId} - ' + e.name + ': ' + e.message + ', URL: ${url}'); }`;
      
    case 'python':
    case 'py':
      // Для Python используем urllib (встроенная библиотека) - однострочный вариант
      // КРИТИЧЕСКИ ВАЖНО: timeout=5.0 для тяжелых операций (IFC, многопоточность, CPU-intensive)
      // ДОБАВЛЕНО: улучшенное логирование с URL и traceback для ошибок
      // ДОБАВЛЕНО: параллельное логирование в файл И в консоль (stderr) для видимости
      // ДОБАВЛЕНО: поддержка Docker - определение хоста происходит во время выполнения через _rootrace_host
      // Экранируем URL для использования в строке Python
      const escapedUrl = url.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      // Генерируем код для отправки данных на сервер
      // Используем переменную _rootrace_host, которая должна быть инициализирована в начале файла
      // Переменная _rootrace_host определяется ВО ВРЕМЯ ВЫПОЛНЕНИЯ внутри Docker контейнера
      // Если переменная не инициализирована (старые пробы), используем URL напрямую как fallback
      return `try: import urllib.request, json, os, traceback, sys; log_file = os.path.expanduser('~/.roo_probe_debug.log'); base_url = '${escapedUrl}'; server_url = base_url.replace('localhost', _rootrace_host) if '_rootrace_host' in globals() and 'localhost' in base_url else base_url; log_msg = f"Probe EXECUTING: {hId} - {escapedMessage}, URL: {server_url}\\n"; open(log_file, 'a').write(log_msg); sys.stderr.write(f"[RooTrace Probe] {log_msg}"); req = urllib.request.Request(server_url, data=json.dumps({'hypothesisId': '${hId}', 'message': '${escapedMessage}', 'state': {}}).encode('utf-8'), headers={'Content-Type': 'application/json'}); resp = urllib.request.urlopen(req, timeout=5.0); success_msg = f"Probe SUCCESS: {hId} - status={resp.getcode()}, URL={server_url}\\n"; open(log_file, 'a').write(success_msg); sys.stderr.write(f"[RooTrace Probe] {success_msg}"); except Exception as e: log_file = os.path.expanduser('~/.roo_probe_debug.log'); error_msg = f"Probe ERROR: {hId} - {type(e).__name__}: {str(e)}, URL: {server_url if 'server_url' in locals() else base_url}\\n{traceback.format_exc()}\\n"; open(log_file, 'a').write(error_msg); sys.stderr.write(f"[RooTrace Probe ERROR] {error_msg}"); pass`;
      
    case 'java':
      return `try {
    java.net.URL url = new java.net.URL("${url}");
    java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
    conn.setRequestMethod("POST");
    conn.setRequestProperty("Content-Type", "application/json");
    conn.setDoOutput(true);
    String json = "{\\"hypothesisId\\":\\"${hId}\\",\\"message\\":\\"${escapedMessage}\\",\\"state\\":{}}";
    conn.getOutputStream().write(json.getBytes());
    conn.getResponseCode();
} catch(Exception e) {}`;
      
    case 'csharp':
    case 'cs':
      return `try {
    using (var client = new System.Net.Http.HttpClient()) {
        var content = new System.Net.Http.StringContent("{\\"hypothesisId\\":\\"${hId}\\",\\"message\\":\\"${escapedMessage}\\",\\"state\\":{}}", System.Text.Encoding.UTF8, "application/json");
        client.PostAsync("${url}", content).Wait();
    }
} catch {}`;
      
    case 'cpp':
    case 'c++':
      // C++ используем curl через system call (если доступен) или комментарий
      return `std::system(("curl -s -X POST -H \\"Content-Type: application/json\\" -d '{\\"hypothesisId\\":\\"${hId}\\",\\"message\\":\\"${escapedMessage}\\",\\"state\\":{}}' '" + std::string("${url}") + "' > /dev/null 2>&1 &").c_str());`;
      
    case 'go':
      // Для Go используем переменную rootraceHost, которая должна быть инициализирована в начале файла
      // Если переменная не инициализирована (старые пробы), используем URL напрямую как fallback
      const escapedUrlGo = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      // Заменяем localhost на rootraceHost если переменная существует
      // ВАЖНО: Проба должна использовать импорты http, bytes, json, strings, time которые уже могут быть в файле
      // или будут добавлены при инициализации rootraceHost
      return `go func() {
    defer func() { recover() }()
    serverURL := "${escapedUrlGo}"
    if rootraceHost != "" && strings.Contains(serverURL, "localhost") {
        serverURL = strings.Replace(serverURL, "localhost", rootraceHost, 1)
    }
    jsonData := []byte(\`{"hypothesisId":"${hId}","message":"${escapedMessage}","state":{}}\`)
    req, _ := http.NewRequest("POST", serverURL, bytes.NewBuffer(jsonData))
    req.Header.Set("Content-Type", "application/json")
    client := &http.Client{Timeout: 100 * time.Millisecond}
    client.Do(req)
}()`;
      
    case 'php':
      return `try {
    $ch = curl_init('${url}');
    curl_setopt($ch, CURLOPT_POST, 1);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['hypothesisId' => '${hId}', 'message' => '${escapedMessage}', 'state' => []]));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_TIMEOUT_MS, 100);
    curl_exec($ch);
    curl_close($ch);
} catch(Exception $e) {}`;
      
    case 'ruby':
      return `begin
    require 'net/http'
    require 'json'
    uri = URI('${url}')
    http = Net::HTTP.new(uri.host, uri.port)
    http.read_timeout = 0.1
    req = Net::HTTP::Post.new(uri.path)
    req['Content-Type'] = 'application/json'
    req.body = {hypothesisId: '${hId}', message: '${escapedMessage}', state: {}}.to_json
    http.request(req)
rescue
end`;
      
    case 'swift':
      return `do {
    let url = URL(string: "${url}")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: ["hypothesisId": "${hId}", "message": "${escapedMessage}", "state": [:]], options: [])
    request.timeoutInterval = 0.1
    URLSession.shared.dataTask(with: request).resume()
} catch {}`;
      
    case 'kotlin':
      return `try {
    val url = java.net.URL("${url}")
    val conn = url.openConnection() as java.net.HttpURLConnection
    conn.requestMethod = "POST"
    conn.setRequestProperty("Content-Type", "application/json")
    conn.doOutput = true
    conn.outputStream.write("{\\"hypothesisId\\":\\"${hId}\\",\\"message\\":\\"${escapedMessage}\\",\\"state\\":{}}".toByteArray())
    conn.responseCode
} catch(e: Exception) {}`;
      
    case 'css':
      // Для CSS используем комментарий
      return `/* RooTrace probe: ${escapedMessage} */`;
      
    case 'html':
      // Для HTML используем комментарий
      return `<!-- RooTrace probe: ${escapedMessage} -->`;
      
    case 'rust':
    case 'rs':
      // Rust использует reqwest или ureq, но для простоты используем однострочный вариант с ureq
      return `std::thread::spawn(|| { let _ = ureq::post("${url}").set("Content-Type", "application/json").send_json(ureq::json!({"hypothesisId": "${hId}", "message": "${escapedMessage}", "state": {}})); });`;
      
    case 'scala':
    case 'sc':
      return `try {
    import java.net.{URL, HttpURLConnection}
    val url = new URL("${url}")
    val conn = url.openConnection.asInstanceOf[HttpURLConnection]
    conn.setRequestMethod("POST")
    conn.setRequestProperty("Content-Type", "application/json")
    conn.setDoOutput(true)
    val json = s"""{"hypothesisId":"${hId}","message":"${escapedMessage}","state":{}}"""
    conn.getOutputStream.write(json.getBytes)
    conn.getResponseCode
} catch { case _: Exception => }`;
      
    case 'lua':
      return `pcall(function()
    local http = require("socket.http")
    local ltn12 = require("ltn12")
    local json = require("json")
    local data = json.encode({hypothesisId="${hId}", message="${escapedMessage}", state={}})
    http.request{
        url = "${url}",
        method = "POST",
        headers = {["Content-Type"] = "application/json", ["Content-Length"] = #data},
        source = ltn12.source.string(data)
    }
end)`;
      
    case 'perl':
    case 'pl':
    case 'pm':
      return `eval {
    use LWP::UserAgent;
    my $ua = LWP::UserAgent->new(timeout => 0.1);
    my $req = HTTP::Request->new(POST => "${url}");
    $req->header('Content-Type' => 'application/json');
    $req->content('{"hypothesisId":"${hId}","message":"${escapedMessage}","state":{}}');
    $ua->request($req);
};`;
      
    case 'r':
      return `tryCatch({
    library(httr)
    POST("${url}", body = list(hypothesisId = "${hId}", message = "${escapedMessage}", state = list()), encode = "json", timeout(0.1))
}, error = function(e) {})`;
      
    case 'matlab':
    case 'm':
    case 'mm':
      return `try
    options = weboptions('RequestMethod', 'post', 'MediaType', 'application/json', 'Timeout', 0.1);
    webwrite('${url}', struct('hypothesisId', '${hId}', 'message', '${escapedMessage}', 'state', struct()), options);
catch
end`;
      
    case 'dart':
      return `try {
    import 'dart:convert';
    import 'package:http/http.dart' as http;
    http.post(Uri.parse("${url}"), headers: {'Content-Type': 'application/json'}, body: jsonEncode({'hypothesisId': '${hId}', 'message': '${escapedMessage}', 'state': {}})).timeout(Duration(milliseconds: 100));
} catch(e) {}`;
      
    default:
      // Для неизвестных языков используем JavaScript как fallback
      return `try { fetch('${url}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hypothesisId: '${hId}', message: '${escapedMessage}', state: {} }) }).catch(() => {}); } catch(e) {}`;
  }
}

/**
 * Вспомогательная функция для определения языка по расширению файла
 * @param fileExtension - расширение файла
 * @returns название языка
 */
function getLanguageFromFileExtension(fileExtension: string): string {
  const languageMap: { [key: string]: string } = {
    'js': 'javascript',
    'ts': 'typescript',
    'py': 'python',
    'java': 'java',
    'css': 'css',
    'html': 'html',
    'htm': 'html',
    'cs': 'csharp',
    'cpp': 'cpp',
    'cxx': 'cpp',
    'cc': 'cpp',
    'go': 'go',
    'php': 'php',
    'rb': 'ruby',
    'swift': 'swift',
    'kt': 'kotlin',
    'kts': 'kotlin',
    'rs': 'rust',
    'scala': 'scala',
    'sc': 'scala',
    'lua': 'lua',
    'pl': 'perl',
    'pm': 'perl',
    'r': 'r',
    'm': 'matlab',
    'mm': 'matlab',
    'dart': 'dart',
    'jsx': 'javascript',
    'tsx': 'typescript'
  };
  
  return languageMap[fileExtension] || fileExtension;
}

/**
 * Получает информацию о всех зарегистрированных пробах
 * 
 * Возвращает список всех проб, которые были успешно инъектированы в текущей сессии.
 * Каждая проба содержит информацию о файле, позиции, типе и сообщении.
 * 
 * @returns Массив объектов ProbeInfo с информацией о всех пробах
 * 
 * @example
 * ```typescript
 * const probes = getAllProbes();
 * console.log(`Total probes: ${probes.length}`);
 * probes.forEach(probe => {
 *   console.log(`Probe ${probe.id} in ${probe.filePath}:${probe.lineNumber}`);
 * });
 * ```
 */
export function getAllProbes(): ProbeInfo[] {
  return Array.from(probeRegistry.values());
}

/**
 * Функция для удаления всех проб в файле
 * Использует регулярные выражения для поиска блоков RooTrace [id: ...] и удаления их целиком
 * @param filePath - путь к файлу
 * @returns Результат операции
 */
export async function removeAllProbesFromFile(filePath: string): Promise<InjectionResult> {
  try {
    // Sanitize file path
    let safeFilePath: string;
    try {
      safeFilePath = sanitizeFilePath(filePath);
    } catch (e) {
      return {
        success: false,
        message: `Invalid file path: ${filePath} - ${e instanceof Error ? e.message : String(e)}`
      };
    }

    return await withFileLock(safeFilePath, async () => {
      // Читаем содержимое файла
      let content = await fs.promises.readFile(safeFilePath, 'utf8');
      const originalContent = content;
      
      // БЕЗОТКАЗНОСТЬ: Регулярка ищет всё от стартового маркера до конечного, включая многострочный код
      // Поддерживает и // и #
      // Формат: // RooTrace [id: xxxx] ... \n ...код... \n // RooTrace [id: xxxx]: end
      const probeRegex = /(\/\/\s*RooTrace\s*\[id:\s*[a-z0-9]+\].*?[\s\S]*?\/\/\s*RooTrace\s*\[id:\s*[a-z0-9]+\]:\s*end)|(#\s*RooTrace\s*\[id:\s*[a-z0-9]+\].*?[\s\S]*?#\s*RooTrace\s*\[id:\s*[a-z0-9]+\]:\s*end)/g;
      
      // Подсчитываем количество удаленных проб
      let removedCount = 0;
      const matches = content.match(probeRegex);
      if (matches) {
        removedCount = matches.length;
      }
      
      // Удаляем все блоки проб
      let cleanedContent = content.replace(probeRegex, '');
      
      // Удаляем инициализацию хоста для Python и Go
      const fileExtension = path.extname(filePath).toLowerCase();
      if (fileExtension === '.py' || fileExtension === '.pyw' || fileExtension === '.pyi') {
        const hostInitRegex = /#\s*RooTrace\s*\[init\].*?[\s\S]*?#\s*RooTrace\s*\[init\]:\s*end/g;
        cleanedContent = cleanedContent.replace(hostInitRegex, '');
        filesWithHostInit.delete(safeFilePath);
      } else if (fileExtension === '.go') {
        const hostInitRegex = /\/\/\s*RooTrace\s*\[init\].*?[\s\S]*?\/\/\s*RooTrace\s*\[init\]:\s*end/g;
        cleanedContent = cleanedContent.replace(hostInitRegex, '');
        filesWithHostInit.delete(safeFilePath);
      }
      
      // Убираем лишние пустые строки (более 2 подряд заменяем на 2)
      const finalContent = cleanedContent.replace(/\n\s*\n\s*\n+/g, '\n\n');
      
      // Записываем очищенное содержимое обратно в файл
      await fs.promises.writeFile(safeFilePath, finalContent, 'utf8');
      
      // Очищаем реестр проб для этого файла
      const registryEntries = Array.from(probeRegistry.entries());
      for (const [probeId, probe] of registryEntries) {
        const probeFilePath = probe.filePath;
        if (probeFilePath === filePath || probeFilePath === safeFilePath || 
            path.resolve(probeFilePath) === path.resolve(safeFilePath)) {
          probeRegistry.delete(probeId);
        }
      }

      return {
        success: true,
        message: `Successfully removed ${removedCount} probe block(s) from ${filePath}`
      };
    });
  } catch (error) {
    return {
      success: false,
      message: `Error removing all probes from file: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
/**
 * Очищает реестр проб (используется только для тестирования)
 * 
 * Удаляет все записи о пробах из внутреннего реестра. Используется в unit-тестах
 * для изоляции тестовых случаев.
 * 
 * @internal
 * @example
 * ```typescript
 * // В тесте
 * clearProbeRegistryForTesting();
 * // Теперь реестр пуст
 * ```
 */
export function clearProbeRegistryForTesting(): void {
  probeRegistry.clear();
}