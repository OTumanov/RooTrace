/**
 * Обработчик инструмента clear_session
 * 
 * Очищает сессию отладки RooTrace, сбрасывает все гипотезы и логи.
 * Удаляет все пробы из файлов и очищает внутреннее состояние отладки.
 */

import * as fs from 'fs';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { HandlerContext } from './base-handler';
import { logDebug } from '../../error-handler';
import type { RuntimeLog } from '../../types';

/**
 * Обрабатывает вызов инструмента clear_session
 * 
 * @param args - Аргументы инструмента
 * @param context - Контекст с зависимостями
 * @returns Результат выполнения инструмента
 */
export async function handleClearSession(
  args: any,
  context: HandlerContext
): Promise<CallToolResult> {
  const { sessionId } = args as { sessionId?: string };
  const actualSessionId = sessionId || 'default';
  
  // Сбрасываем мониторинг контекста для этой сессии
  context.contextMonitor.resetSession(actualSessionId);
  
  try {
    // БЕЗОТКАЗНАЯ ОЧИСТКА: Собираем список файлов из всех источников
    const affectedFiles = new Set<string>();
    
    // 1. Получаем файлы из реестра проб (самый надежный источник)
    const allProbes = context.getAllProbes();
    for (const probe of allProbes) {
      if (probe.filePath && fs.existsSync(probe.filePath)) {
        affectedFiles.add(probe.filePath);
      }
    }
    
    // 2. Получаем файлы из логов (может содержать пути)
    const logs = await context.sharedStorage.getLogs();
    logs.forEach((log: RuntimeLog) => {
      if (log.context) {
        // Пытаемся извлечь путь из context (формат может быть "file:line" или просто путь)
        const contextStr = String(log.context);
        if (contextStr.includes(':')) {
          const filePath = contextStr.split(':')[0].trim();
          if (filePath && fs.existsSync(filePath)) {
            affectedFiles.add(filePath);
          }
        } else if (fs.existsSync(contextStr)) {
          // Может быть просто путь
          affectedFiles.add(contextStr);
        }
      }
      // Также проверяем data на наличие filePath
      if (log.data && typeof log.data === 'object' && 'filePath' in log.data) {
        const filePath = String(log.data.filePath);
        if (filePath && fs.existsSync(filePath)) {
          affectedFiles.add(filePath);
        }
      }
    });
    
    // 3. Сканируем workspace на наличие файлов с маркерами RooTrace (если доступен)
    // Это опционально и может быть медленным, поэтому делаем только если нет других источников
    if (affectedFiles.size === 0) {
      // Пытаемся найти файлы с маркерами через рекурсивный поиск
      // Но только если у нас есть доступ к workspace
      try {
        const workspaceRoot = context.getWorkspaceRoot();
        if (workspaceRoot && fs.existsSync(workspaceRoot)) {
          const filesWithProbes = await context.findFilesWithProbes(workspaceRoot);
          for (const file of filesWithProbes) {
            affectedFiles.add(file);
          }
        }
      } catch (scanError) {
        // Игнорируем ошибки сканирования - это опциональная функция
        logDebug(`Workspace scan failed: ${scanError}`, 'RooTraceMCPHandler.clear_session');
      }
    }
    
    // Удаляем все пробы из каждого файла
    const removalResults: Array<{ file: string; success: boolean; message: string }> = [];
    for (const filePath of affectedFiles) {
      try {
        // Проверяем, что файл существует и содержит маркеры перед попыткой удаления
        if (!fs.existsSync(filePath)) {
          removalResults.push({
            file: filePath,
            success: false,
            message: `File not found: ${filePath}`
          });
          continue;
        }
        
        // Быстрая проверка на наличие маркеров
        const content = await fs.promises.readFile(filePath, 'utf8');
        if (!content.includes('RooTrace [id:') && !content.includes('RooTrace[id:')) {
          // Файл не содержит проб - пропускаем
          continue;
        }
        
        const removalResult = await context.removeAllProbesFromFile(filePath);
        removalResults.push({
          file: filePath,
          success: removalResult.success,
          message: removalResult.message
        });
      } catch (error) {
        removalResults.push({
          file: filePath,
          success: false,
          message: `Error removing probes from ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }
    
    // ОЧИСТКА ДАННЫХ: Обнуляем JSON-файл логов через блокировку
    await context.sharedStorage.clear();
    
    const successCount = removalResults.filter(r => r.success).length;
    const totalCount = removalResults.length;
    const filesWithProbes = removalResults.filter(r => r.success || r.message.includes('probe')).length;
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: totalCount > 0 
            ? `Проект очищен. Обработано ${totalCount} файлов, удалены пробы из ${successCount} файлов. Логи сброшены.`
            : `Сессия очищена. Логи сброшены. Файлы с пробами не найдены (возможно, пробы уже удалены или были вставлены через apply_diff без регистрации).`,
          sessionId: sessionId || 'current',
          clearedAt: new Date().toISOString(),
          probesRemoved: allProbes.length,
          filesProcessed: totalCount,
          filesWithProbesRemoved: successCount,
          removalResults: removalResults
        })
      }]
    };
  } catch (error) {
    // Если что-то пошло не так, все равно очищаем логи
    try {
      await context.sharedStorage.clear();
    } catch (clearError) {
      // Игнорируем ошибки очистки логов
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `Error during clear_session: ${error instanceof Error ? error.message : String(error)}`,
          errorCode: 'CLEAR_SESSION_FAILED',
          sessionId: sessionId || 'current',
          note: 'Logs were cleared, but probe removal may have failed. Check removalResults for details.'
        })
      }],
      isError: true
    };
  }
}
