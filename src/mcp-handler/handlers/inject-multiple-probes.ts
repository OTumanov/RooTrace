/**
 * Обработчик инструмента inject_multiple_probes
 * 
 * Инъекция нескольких проб в код за один вызов.
 * ИЗМЕНЯЕТ ФАЙЛЫ - требует одобрения пользователя.
 * 
 * ⚠️ ЗАПРЕЩЕНО для Python файлов (.py) - используйте apply_diff (Block Rewrite) вместо этого.
 * 🛡️ ВАЖНО: Перед использованием apply_diff ОБЯЗАТЕЛЬНО создайте резервную копию.
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { HandlerContext } from './base-handler';
import { validateInjectMultipleProbesParams, validateInjectProbeParams } from '../injection-utils';
import { isPythonFile } from '../file-utils';
import { checkGitCommitBeforeEdit } from '../security';
import { injectProbeWithRetry } from '../injection-utils';

/**
 * Обрабатывает вызов инструмента inject_multiple_probes
 * 
 * @param args - Аргументы инструмента
 * @param context - Контекст с зависимостями
 * @returns Результат выполнения инструмента
 */
export async function handleInjectMultipleProbes(
  args: any,
  context: HandlerContext
): Promise<CallToolResult> {
  const { probes } = args as { probes: Array<{
    filePath: string;
    lineNumber: number;
    probeType: 'log' | 'trace' | 'error';
    message?: string;
    probeCode?: string;
    hypothesisId?: string;
  }> };
  
  // Валидация массива проб
  const validation = validateInjectMultipleProbesParams(probes);
  if (!validation.valid && validation.error) {
    return validation.error;
  }

  // Валидируем каждую пробу и проверяем на Python файлы
  for (let i = 0; i < probes.length; i++) {
    const probe = probes[i];
    
    // Нормализуем путь
    const normalizedPath = context.normalizeFilePath(probe.filePath);
    probe.filePath = normalizedPath;
    
    // 🚫 КРИТИЧЕСКАЯ ПРОВЕРКА: ЗАПРЕТ inject_multiple_probes для Python файлов
    if (isPythonFile(normalizedPath)) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `FORBIDDEN: inject_multiple_probes is STRICTLY PROHIBITED for Python files. Probe ${i + 1} targets Python file (${normalizedPath}). According to protocol, you MUST use Block Rewrite method (apply_diff) to replace entire function/block instead of multiple injections. This prevents IndentationError and maintains code structure.\n\n🛡️ CRITICAL: Before using apply_diff, you MUST create a backup: (1) If git repository: git add . && git commit -m "AI Debugger: Pre-instrumentation backup", OR (2) If no git: cp "${normalizedPath}" "${normalizedPath}.bak". This is a safety requirement to ensure rollback capability.`,
            errorCode: 'FORBIDDEN_FOR_PYTHON',
            probeIndex: i,
            filePath: normalizedPath,
            requiredMethod: 'apply_diff (Block Rewrite)',
            requiredAction: 'git add . && git commit -m "AI Debugger: Pre-instrumentation backup" OR cp "${normalizedPath}" "${normalizedPath}.bak"'
          })
        }],
        isError: true
      };
    }
    
    // Дополнительная валидация каждой пробы
    const probeValidation = validateInjectProbeParams(probe, i);
    if (!probeValidation.valid && probeValidation.error) {
      return probeValidation.error;
    }
  }

  // 🛡️ SAFETY CHECK: Проверка коммита перед редактированием для всех уникальных файлов
  const uniqueFiles = [...new Set(probes.map(p => p.filePath))];
  for (const filePath of uniqueFiles) {
    const commitCheck = await checkGitCommitBeforeEdit(
      filePath,
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
  }

  // Вставляем все пробы последовательно
  const injectionResults: any[] = [];
  let allSuccess = true;
  let hasSyntaxErrors = false;

  for (let i = 0; i < probes.length; i++) {
    const probe = probes[i];
    try {
      const normalizedProbeCode = (probe.probeCode && typeof probe.probeCode === 'string' && probe.probeCode.trim().length > 0) ? probe.probeCode : undefined;
      const normalizedHypothesisId = (probe.hypothesisId && typeof probe.hypothesisId === 'string' && probe.hypothesisId.trim().length > 0) ? probe.hypothesisId.trim() : undefined;
      const normalizedMessage = (probe.message && typeof probe.message === 'string') ? probe.message : (normalizedProbeCode ? 'Custom probe code' : 'Debug probe');
      
      const injectResult = await injectProbeWithRetry(
        {
          filePath: probe.filePath,
          lineNumber: probe.lineNumber,
          probeType: probe.probeType,
          message: normalizedMessage,
          probeCode: normalizedProbeCode,
          hypothesisId: normalizedHypothesisId
        },
        context.injectProbe
      );

      injectionResults.push({
        success: injectResult.success,
        filePath: probe.filePath,
        lineNumber: probe.lineNumber,
        probeType: probe.probeType,
        message: normalizedMessage,
        confirmation: injectResult.message,
        insertedCode: injectResult.insertedCode,
        syntaxCheck: injectResult.syntaxCheck
      });

      if (!injectResult.success) {
        allSuccess = false;
      }
      if (injectResult.syntaxCheck && !injectResult.syntaxCheck.passed) {
        hasSyntaxErrors = true;
      }
    } catch (injectError) {
      allSuccess = false;
      injectionResults.push({
        success: false,
        filePath: probe.filePath,
        lineNumber: probe.lineNumber,
        probeType: probe.probeType,
        error: injectError instanceof Error ? injectError.message : String(injectError)
      });
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: allSuccess,
        message: `Inserted ${injectionResults.filter(r => r.success).length} of ${probes.length} probes`,
        results: injectionResults,
        totalProbes: probes.length,
        successfulProbes: injectionResults.filter(r => r.success).length,
        failedProbes: injectionResults.filter(r => !r.success).length,
        hasSyntaxErrors: hasSyntaxErrors,
        warning: hasSyntaxErrors ? 'Some probes have syntax errors. Please review the code.' : undefined
      })
    }]
  };
}
