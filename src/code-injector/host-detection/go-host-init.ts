/**
 * Генератор кода инициализации хоста для Go и утилиты для работы с импортами
 */

/**
 * Извлекает имя пакета из Go файла
 * @param fileContent - содержимое Go файла
 * @returns имя пакета или 'main' по умолчанию
 */
export function extractGoPackageName(fileContent: string): string {
  const packageMatch = fileContent.match(/^package\s+(\w+)/m);
  return packageMatch ? packageMatch[1] : 'main';
}

/**
 * Проверяет, какие импорты уже есть в Go файле
 * @param fileContent - содержимое Go файла
 * @returns объект с информацией о наличии импортов
 */
export function checkGoImports(fileContent: string): { 
  hasNet: boolean; 
  hasOs: boolean; 
  hasStrings: boolean; 
  hasHttp: boolean; 
  hasBytes: boolean; 
  hasTime: boolean 
} {
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
 * 
 * Fallback цепочка аналогична Python:
 * 1. ROO_TRACE_HOST env var (высший приоритет)
 * 2. Проверка Docker (/.dockerenv или /proc/self/cgroup)
 * 3. Пробуем резолвить host.docker.internal
 * 4. Определяем gateway IP через net.Dial
 * 5. localhost (fallback)
 * 
 * @param fileContent - содержимое Go файла (для проверки импортов)
 * @returns Код инициализации, который устанавливает rootraceHost
 */
export function generateGoHostInitCode(fileContent: string): string {
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
 * Пробы Go используют: http, bytes, time, strings (strings уже нужен для rootraceHost)
 * 
 * @param fileContent - содержимое Go файла
 * @returns обновленное содержимое с добавленными импортами
 */
export function ensureGoProbeImports(fileContent: string): string {
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
