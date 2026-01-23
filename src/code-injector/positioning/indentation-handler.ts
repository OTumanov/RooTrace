/**
 * Обработка отступов для кода проб
 */

/**
 * Определяет, нужны ли отступы для указанного языка
 */
export function needsIndentation(language: string): boolean {
  return language === 'python' || language === 'py' || 
         language === 'javascript' || language === 'js' ||
         language === 'typescript' || language === 'ts' ||
         language === 'java' || language === 'csharp' || language === 'cs' ||
         language === 'scala' || language === 'sc' || language === 'kotlin' ||
         language === 'go' || language === 'ruby' || language === 'rb' ||
         language === 'swift' || language === 'rust' || language === 'rs' ||
         language === 'dart' || language === 'lua' || language === 'perl' ||
         language === 'r' || language === 'matlab';
}

/**
 * Применяет отступы к коду пробы
 * 
 * @param probeCode Код пробы (может быть многострочным)
 * @param baseIndent Базовый отступ для первой строки
 * @param language Язык программирования
 * @returns Массив строк с примененными отступами
 */
export function applyIndentation(
  probeCode: string,
  baseIndent: string,
  language: string
): string[] {
  const probeLines = probeCode.split('\n');
  const needsIndent = needsIndentation(language);
  
  return probeLines.map((line, index) => {
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
}
