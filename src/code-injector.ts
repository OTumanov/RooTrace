import * as vscode from 'vscode';

// Интерфейс для результата инъекции пробы
interface InjectionResult {
  success: boolean;
  message: string;
  insertedCode?: string;
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
}

// Хранилище для информации о пробах
const probeRegistry = new Map<string, ProbeInfo>();

/**
 * Функция для инъекции пробы в код
 * @param filePath - путь к файлу (относительный или абсолютный)
 * @param lineNumber - номер строки для инъекции
 * @param probeType - 'log', 'trace', 'error'
 * @param message - сообщение для логирования
 * @returns Результат инъекции
 */
export async function injectProbe(
  filePath: string, 
  lineNumber: number, 
  probeType: 'log' | 'trace' | 'error', 
  message: string
): Promise<InjectionResult> {
  try {
    // Проверяем параметры
    if (!filePath || lineNumber === undefined || !probeType || !message) {
      return {
        success: false,
        message: 'Missing required parameters: filePath, lineNumber, probeType, and message are required'
      };
    }

    // Получаем расширение файла для определения языка
    const fileExtension = filePath.split('.').pop()?.toLowerCase() || '';
    
    // Получаем URI файла
    const fileUri = vscode.Uri.file(filePath);
    
    // Проверяем, существует ли файл
    try {
      await vscode.workspace.fs.stat(fileUri);
    } catch (error) {
      return {
        success: false,
        message: `File does not exist: ${filePath}`
      };
    }
    
    // Открываем документ
    const document = await vscode.workspace.openTextDocument(fileUri);
    
    // Проверяем, что номер строки допустим
    if (lineNumber < 1 || lineNumber > document.lineCount) {
      return {
        success: false,
        message: `Line number ${lineNumber} is out of range. Document has ${document.lineCount} lines.`
      };
    }
    
    // Генерируем код пробы для конкретного языка
    const language = getLanguageFromFileExtension(fileExtension);
    const probeCode = generateProbeCode(language, probeType, message);
    
    if (!probeCode) {
      return {
        success: false,
        message: `Unsupported file type: ${fileExtension}`
      };
    }
    
    // Получаем текст строки, в которую будем вставлять пробу
    const lineIndex = lineNumber - 1; // Индексация строк начинается с 0
    const line = document.lineAt(lineIndex);
    
    // Создаем редактирование
    const edit = new vscode.WorkspaceEdit();
    
    // Определяем позицию для вставки
    // Вставляем пробу перед указанной строкой
    const position = new vscode.Position(lineIndex, 0);
    edit.insert(fileUri, position, probeCode + '\n');
    
    // Применяем редактирование
    const success = await vscode.workspace.applyEdit(edit);
    
    if (!success) {
      return {
        success: false,
        message: 'Failed to apply code injection edit'
      };
    }
    
    // Сохраняем изменения
    await document.save();
    
    // Генерируем уникальный ID для этой пробы
    const probeId = `probe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Сохраняем информацию о пробе
    probeRegistry.set(probeId, {
      id: probeId,
      filePath,
      lineNumber,
      originalCode: line.text,
      injectedCode: probeCode,
      probeType,
      message
    });
    
    return {
      success: true,
      message: `Successfully injected ${probeType} probe at ${filePath}:${lineNumber}`,
      insertedCode: probeCode
    };
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
    // Проверяем, существует ли проба в реестре
    const probeInfo = probeRegistry.get(probeId);
    
    if (!probeInfo || probeInfo.filePath !== filePath) {
      return {
        success: false,
        message: `Probe with ID ${probeId} not found in file ${filePath}`
      };
    }
    
    // Получаем URI файла
    const fileUri = vscode.Uri.file(filePath);
    
    // Открываем документ
    const document = await vscode.workspace.openTextDocument(fileUri);
    
    // Создаем редактирование для удаления пробы
    const edit = new vscode.WorkspaceEdit();
    
    // Найдем строку с пробой
    let probeLineIndex = -1;
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      if (line.text.includes(probeInfo.injectedCode)) {
        probeLineIndex = i;
        break;
      }
    }
    
    if (probeLineIndex === -1) {
      return {
        success: false,
        message: `Could not locate the probe code in the file`
      };
    }
    
    // Определяем диапазон для удаления
    const startPosition = new vscode.Position(probeLineIndex, 0);
    const endPosition = new vscode.Position(probeLineIndex + 1, 0); // Удаляем всю строку с пробой и следующую пустую строку
    const range = new vscode.Range(startPosition, endPosition);
    
    // Удаляем пробу
    edit.delete(fileUri, range);
    
    // Применяем редактирование
    const success = await vscode.workspace.applyEdit(edit);
    
    if (!success) {
      return {
        success: false,
        message: 'Failed to apply code removal edit'
      };
    }
    
    // Сохраняем изменения
    await document.save();
    
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
 * Функция для генерации кода пробы для конкретного языка
 * @param language - язык программирования
 * @param probeType - тип пробы ('log', 'trace', 'error')
 * @param message - сообщение для пробы
 * @returns Сгенерированный код пробы
 */
export function generateProbeCode(language: string, probeType: 'log' | 'trace' | 'error', message: string): string {
  // Определяем префикс в зависимости от типа пробы
  let probePrefix = '[RooTrace]';
  if (probeType === 'error') {
    probePrefix = '[RooTrace ERROR]';
  } else if (probeType === 'trace') {
    probePrefix = '[RooTrace TRACE]';
  }
  
  // Генерируем код пробы в зависимости от языка
  switch (language.toLowerCase()) {
    case 'javascript':
    case 'typescript':
    case 'js':
    case 'ts':
      return `console.log('${probePrefix}: ${message}');`;
      
    case 'python':
    case 'py':
      return `print(f'${probePrefix}: {message}')`;
      
    case 'java':
      return `System.out.println("${probePrefix}: " + ${message});`;
      
    case 'csharp':
    case 'cs':
      return `Console.WriteLine("${probePrefix}: " + ${message});`;
      
    case 'cpp':
    case 'c++':
      return `std::cout << "${probePrefix}: " << ${message} << std::endl;`;
      
    case 'go':
      return `fmt.Println("${probePrefix}: ", ${message})`;
      
    case 'php':
      return `echo "${probePrefix}: " . ${message} . "\\n";`;
      
    case 'ruby':
      return `puts "${probePrefix}: #{${message}}"`;
      
    case 'swift':
      return `print("${probePrefix}: \\(${message})")`;
      
    case 'kotlin':
      return `println("${probePrefix}: " + ${message})`;
      
    default:
      // Для неизвестных языков используем JavaScript как fallback
      return `console.log('${probePrefix}: ${message}');`;
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
 * Функция для получения всех зарегистрированных проб
 * @returns Массив информации о пробах
 */
export function getAllProbes(): ProbeInfo[] {
  return Array.from(probeRegistry.values());
}

/**
 * Функция для удаления всех проб в файле
 * @param filePath - путь к файлу
 * @returns Результат операции
 */
export async function removeAllProbesFromFile(filePath: string): Promise<InjectionResult> {
  try {
    // Находим все пробы в данном файле
    const probesToRemove = Array.from(probeRegistry.entries())
      .filter(([_, probe]) => probe.filePath === filePath);
    
    if (probesToRemove.length === 0) {
      return {
        success: true,
        message: `No probes found in file: ${filePath}`
      };
    }
    
    // Удаляем все пробы в файле
    for (const [probeId, _] of probesToRemove) {
      await removeProbe(filePath, probeId);
    }
    
    return {
      success: true,
      message: `Successfully removed ${probesToRemove.length} probes from ${filePath}`
    };
  } catch (error) {
    return {
      success: false,
      message: `Error removing all probes from file: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}