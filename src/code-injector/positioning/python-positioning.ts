/**
 * Специфичная логика позиционирования для Python
 */

import { InsertionPosition, PositioningContext } from './types';

/**
 * Определяет позицию вставки для Python с учетом особенностей языка
 * 
 * Особенности Python:
 * - Если целевая строка - def, вставляем внутри функции
 * - Если целевая строка - return/raise/break/continue, вставляем перед ней
 * - Избегаем недостижимого кода после return
 * - Сохраняем правильные отступы
 */
export function findPythonInsertionPosition(context: PositioningContext): InsertionPosition {
  const { lines, lineIndex, originalCode, trimmedCode } = context;
  
  const indentMatch = originalCode.match(/^(\s*)/);
  let baseIndent = indentMatch ? indentMatch[1] : '';
  let insertIndex = lineIndex;
  let adjusted = false;
  let adjustmentReason: string | undefined;
  
  // 🐍 PYTHON INDENTATION SAFETY: Автоматическая страховка от ошибок LLM
  // Для Python файлов программно вычисляем отступ из строки перед вставкой
  // и гарантируем, что baseIndent установлен правильно
  if (lineIndex >= 0 && lineIndex < lines.length) {
    const targetLine = lines[lineIndex];
    const targetIndentMatch = targetLine.match(/^(\s*)/);
    const targetIndent = targetIndentMatch ? targetIndentMatch[1] : '';
    
    // Принудительно используем отступ целевой строки для Python
    // Это предотвращает ошибки, когда LLM неправильно угадывает отступы
    if (targetIndent.length > 0) {
      baseIndent = targetIndent;
    }
  }
  
  // Проверяем, является ли целевая строка return statement или другим statement, после которого код недостижим
  // Если да, вставляем ПЕРЕД этой строкой
  if (trimmedCode.startsWith('return ') || trimmedCode.startsWith('raise ') || 
      trimmedCode.startsWith('break ') || trimmedCode.startsWith('continue ') ||
      trimmedCode === 'return' || trimmedCode === 'raise' || trimmedCode === 'break' || trimmedCode === 'continue') {
    // Вставляем перед return/raise/break/continue
    insertIndex = lineIndex;
    baseIndent = indentMatch ? indentMatch[1] : '';
    adjusted = true;
    adjustmentReason = 'Inserting before return/raise/break/continue statement';
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
      adjusted = true;
      adjustmentReason = 'Inserting before return/raise/break/continue in next line';
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
      adjusted = true;
      adjustmentReason = 'Avoiding unreachable code after return/raise/break/continue';
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
      adjusted = true;
      adjustmentReason = 'Avoiding unreachable code after return/raise/break/continue';
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
        adjusted = true;
        adjustmentReason = 'Inserting inside function body';
        break;
      }
      
      // Если следующая строка имеет меньший отступ, значит мы вышли из функции
      if (nextIndent.length <= defIndent.length && nextLine.trim() !== '') {
        // Вставляем после строки с def, используя стандартный отступ тела
        insertIndex = lineIndex + 1;
        baseIndent = bodyIndent;
        foundBodyLine = true;
        adjusted = true;
        adjustmentReason = 'Inserting after function definition (empty body)';
        break;
      }
    }
    
    // Если не нашли тело функции, вставляем после строки с def
    if (!foundBodyLine) {
      insertIndex = lineIndex + 1;
      baseIndent = bodyIndent;
      adjusted = true;
      adjustmentReason = 'Inserting after function definition (no body found)';
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
  
  return {
    insertIndex,
    baseIndent,
    adjusted,
    adjustmentReason
  };
}
