/**
 * Обработчик инструмента inject_probes
 * 
 * Инъекция проб в код для дополнительной отладочной информации.
 * ИЗМЕНЯЕТ ФАЙЛЫ - требует одобрения пользователя.
 * 
 * ⚠️ ЗАПРЕЩЕНО для Python файлов (.py) - используйте apply_diff (Block Rewrite) вместо этого.
 * 🛡️ ВАЖНО: Перед использованием apply_diff ОБЯЗАТЕЛЬНО создайте резервную копию.
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { HandlerContext } from './base-handler';
import { validateInjectProbeParams } from '../injection-utils';
import { isPythonFile } from '../file-utils';
import { checkGitCommitBeforeEdit } from '../security';
import { injectProbeWithRetry } from '../injection-utils';

/**
 * Обрабатывает вызов инструмента inject_probes
 * 
 * @param args - Аргументы инструмента
 * @param context - Контекст с зависимостями
 * @returns Результат выполнения инструмента
 */
export async function handleInjectProbes(
  args: any,
  context: HandlerContext
): Promise<CallToolResult> {
  const { filePath: rawFilePath, lineNumber, probeType, message, probeCode, hypothesisId } = args as any;
  
  // Нормализуем путь (удаляем @ в начале, если есть)
  const filePath = rawFilePath ? context.normalizeFilePath(rawFilePath) : rawFilePath;
  
  // Валидация параметров
  const validation = validateInjectProbeParams({
    filePath,
    lineNumber,
    probeType,
    message,
    probeCode,
    hypothesisId
  });
  
  if (!validation.valid && validation.error) {
    return validation.error;
  }
  
  // 🚫 КРИТИЧЕСКАЯ ПРОВЕРКА: ЗАПРЕТ inject_probes для Python файлов
  if (isPythonFile(filePath!)) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `FORBIDDEN: inject_probes is STRICTLY PROHIBITED for Python files (${filePath}). According to protocol, you MUST use Block Rewrite method (apply_diff) to replace entire function/block instead of point injection. This prevents IndentationError and maintains code structure.\n\n🛡️ CRITICAL: Before using apply_diff, you MUST create a backup: (1) If git repository: git add . && git commit -m "AI Debugger: Pre-instrumentation backup", OR (2) If no git: cp "${filePath}" "${filePath}.bak". This is a safety requirement to ensure rollback capability.`,
          errorCode: 'FORBIDDEN_FOR_PYTHON',
          filePath,
          requiredMethod: 'apply_diff (Block Rewrite)',
          requiredAction: 'git add . && git commit -m "AI Debugger: Pre-instrumentation backup" OR cp "${filePath}" "${filePath}.bak"'
        })
      }],
      isError: true
    };
  }

  // 🛡️ SAFETY CHECK: Проверка коммита перед редактированием
  const commitCheck = await checkGitCommitBeforeEdit(
    filePath!,
    context.committedFiles,
    context.findGitRoot
  );
  
  if (!commitCheck.allowed) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: commitCheck.error,
          errorCode: 'SAFETY_CHECK_FAILED',
          filePath,
          requiredAction: 'git add . && git commit -m "AI Debugger: Pre-instrumentation backup" OR cp "${filePath}" "${filePath}.bak"'
        })
      }],
      isError: true
    };
  }

  // Вызываем реальную функцию инъекции пробы с обработкой ошибок и retry механизмом
  try {
    // Нормализуем probeCode: если передан, но пустой, считаем как не переданный
    const normalizedProbeCode = (probeCode && typeof probeCode === 'string' && probeCode.trim().length > 0) ? probeCode : undefined;
    const normalizedHypothesisId = (hypothesisId && typeof hypothesisId === 'string' && hypothesisId.trim().length > 0) ? hypothesisId.trim() : undefined;
    const normalizedMessage = (message && typeof message === 'string') ? message : (normalizedProbeCode ? 'Custom probe code' : 'Debug probe');
    
    const injectResult = await injectProbeWithRetry(
      {
        filePath: filePath!,
        lineNumber: lineNumber!,
        probeType: probeType as 'log' | 'trace' | 'error',
        message: normalizedMessage,
        probeCode: normalizedProbeCode,
        hypothesisId: normalizedHypothesisId
      },
      context.injectProbe
    );
    
    // Формируем ответ с результатами проверки синтаксиса
    const response: any = {
      success: injectResult.success,
      filePath,
      lineNumber,
      probeType,
      message,
      confirmation: injectResult.message,
      insertedCode: injectResult.insertedCode
    };
    
    // Добавляем результаты проверки синтаксиса, если они есть
    if (injectResult.syntaxCheck) {
      response.syntaxCheck = injectResult.syntaxCheck;
      
      // Если есть синтаксические ошибки, помечаем как предупреждение
      if (!injectResult.syntaxCheck.passed) {
        response.warning = 'Syntax errors detected after probe injection. Please review the code.';
      }
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response)
      }]
    };
  } catch (injectError) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: injectError instanceof Error ? injectError.message : String(injectError),
          errorCode: 'INJECTION_FAILED',
          filePath,
          lineNumber,
          probeType
        })
      }],
      isError: true
    };
  }
}
