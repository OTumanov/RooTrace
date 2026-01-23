/**
 * Утилиты для определения языка программирования по расширению файла
 */

/**
 * Определяет язык программирования по расширению файла
 * 
 * @param fileExtension - Расширение файла (без точки, например: 'py', 'js', 'ts')
 * @returns Название языка в стандартизированном формате
 * 
 * @example
 * ```typescript
 * getLanguageFromFileExtension('py') // 'python'
 * getLanguageFromFileExtension('js') // 'javascript'
 * getLanguageFromFileExtension('tsx') // 'typescript'
 * ```
 */
export function getLanguageFromFileExtension(fileExtension: string): string {
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
