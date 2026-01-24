/**
 * Утилиты для проверки git commit перед редактированием файлов
 * 
 * Этот модуль обеспечивает безопасность, требуя создания резервной копии
 * (git commit или .bak файл) перед редактированием файлов.
 */

import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Результат проверки git commit перед редактированием
 */
export interface GitCommitCheckResult {
  allowed: boolean;
  error?: string;
}

/**
 * Проверяет, был ли сделан git commit или .bak копия перед редактированием файла
 * 
 * Согласно протоколу, коммит или .bak копия должны быть созданы ОДИН РАЗ перед первым изменением.
 * 
 * Логика проверки:
 * 1. Если файл уже был проверен в этой сессии (есть в committedFiles) - разрешаем
 * 2. Если нет git репозитория - проверяем наличие .bak файла
 * 3. Если есть git репозиторий - проверяем наличие незакоммиченных изменений
 * 4. Если есть изменения и нет .bak - требуем коммит или .bak
 * 5. Если файл чистый - разрешаем и помечаем как проверенный
 * 
 * @param filePath - Путь к файлу для проверки
 * @param committedFiles - Set файлов, которые уже были проверены в этой сессии (будет модифицирован)
 * @param findGitRoot - Функция для поиска корня git репозитория
 * @returns Результат проверки
 */
export async function checkGitCommitBeforeEdit(
  filePath: string,
  committedFiles: Set<string>,
  findGitRoot: (filePath: string) => Promise<string | null>
): Promise<GitCommitCheckResult> {
  // Если файл уже был закоммичен/скопирован в этой сессии, разрешаем
  if (committedFiles.has(filePath)) {
    return { allowed: true };
  }

  const gitRoot = await findGitRoot(filePath);
  const bakFilePath = `${filePath}.bak`;
  const bakExists = fs.existsSync(bakFilePath);

  // Если нет git репозитория - проверяем .bak копию
  if (!gitRoot) {
    if (bakExists) {
      // .bak копия существует - разрешаем
      committedFiles.add(filePath);
      return { allowed: true };
    } else {
      // Нет ни git, ни .bak - требуем создать .bak
      return {
        allowed: false,
        error: `File ${filePath} is not in a git repository and has no backup. According to protocol, you MUST create a backup copy before editing: cp "${filePath}" "${bakFilePath}". This is a safety requirement for rollback capability.`
      };
    }
  }

  // Есть git репозиторий - проверяем коммит
  try {
    // Проверяем, есть ли незакоммиченные изменения в файле
    const relativePath = path.relative(gitRoot, filePath);
    const { stdout } = await execAsync(`cd "${gitRoot}" && git status --porcelain "${relativePath}"`, { timeout: 5000 });
    
    if (stdout.trim()) {
      // Есть изменения - требуем коммит (или .bak как альтернатива)
      if (bakExists) {
        // .bak копия существует - разрешаем
        committedFiles.add(filePath);
        return { allowed: true };
      } else {
        // Нет коммита и нет .bak - требуем одно из двух
        return {
          allowed: false,
          error: `File ${relativePath} has uncommitted changes and no backup. According to protocol, you MUST either: (1) commit the file: git add . && git commit -m "AI Debugger: Pre-instrumentation backup", OR (2) create a backup copy: cp "${filePath}" "${bakFilePath}". This is a safety requirement.`
        };
      }
    }

    // Файл чистый - разрешаем и помечаем как закоммиченный
    committedFiles.add(filePath);
    return { allowed: true };
  } catch (error) {
    // If git command fails, check for .bak as fallback
    if (bakExists) {
      committedFiles.add(filePath);
      return { allowed: true };
    }
    // Если git команда не работает и нет .bak, разрешаем (но логируем)
    console.warn(`[RooTrace] Git check failed for ${filePath}:`, error);
    return { allowed: true };
  }
}
