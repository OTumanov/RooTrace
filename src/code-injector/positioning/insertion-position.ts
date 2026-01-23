/**
 * Общая логика определения позиции вставки
 */

import { InsertionPosition, PositioningContext } from './types';
import { findPythonInsertionPosition } from './python-positioning';

/**
 * Определяет позицию вставки пробы для указанного языка
 * 
 * @param context Контекст для определения позиции
 * @returns Позиция вставки с индексом и отступом
 */
export function findInsertionPosition(context: PositioningContext): InsertionPosition {
  const { language, lineIndex, originalCode } = context;
  
  // Для Python используем специальную логику
  if (language === 'python' || language === 'py') {
    return findPythonInsertionPosition(context);
  }
  
  // Для остальных языков используем стандартную логику
  const indentMatch = originalCode.match(/^(\s*)/);
  const baseIndent = indentMatch ? indentMatch[1] : '';
  
  // Если нет отступа, ищем в предыдущих строках
  let finalIndent = baseIndent;
  if (!finalIndent && lineIndex > 0) {
    for (let i = lineIndex - 1; i >= 0; i--) {
      const prevLine = context.lines[i];
      const prevIndentMatch = prevLine.match(/^(\s*)/);
      if (prevIndentMatch && prevLine.trim() !== '') {
        finalIndent = prevIndentMatch[1];
        break;
      }
    }
  }
  
  return {
    insertIndex: lineIndex,
    baseIndent: finalIndent,
    adjusted: false
  };
}
