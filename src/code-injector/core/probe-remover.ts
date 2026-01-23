/**
 * Логика удаления проб из кода
 */

import * as fs from 'fs';
import * as path from 'path';
import { withFileLock } from '../../file-lock-utils';
import { sanitizeFilePath as utilsSanitizeFilePath } from '../../utils';
import { getWorkspaceRoot } from '../../utils';
import { InjectionResult } from '../types';
import { getProbe, removeProbeFromRegistry, removeProbesForFile } from './probe-registry';
import { removeHostInit } from '../host-detection/host-init-registry';

/**
 * Sanitize and validate a file path
 */
function sanitizeFilePath(inputPath: string): string {
  const workspaceRoot = getWorkspaceRoot();
  return utilsSanitizeFilePath(inputPath, workspaceRoot);
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
    const probeInfo = getProbe(probeId);
    
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
    removeProbeFromRegistry(probeId);

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
        removeHostInit(safeFilePath);
      } else if (fileExtension === '.go') {
        const hostInitRegex = /\/\/\s*RooTrace\s*\[init\].*?[\s\S]*?\/\/\s*RooTrace\s*\[init\]:\s*end/g;
        cleanedContent = cleanedContent.replace(hostInitRegex, '');
        removeHostInit(safeFilePath);
      }
      
      // Убираем лишние пустые строки (более 2 подряд заменяем на 2)
      const finalContent = cleanedContent.replace(/\n\s*\n\s*\n+/g, '\n\n');
      
      // Записываем очищенное содержимое обратно в файл
      await fs.promises.writeFile(safeFilePath, finalContent, 'utf8');
      
      // Очищаем реестр проб для этого файла
      removeProbesForFile(filePath);

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
