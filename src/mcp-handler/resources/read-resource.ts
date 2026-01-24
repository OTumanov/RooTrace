/**
 * Обработчик ReadResource Request для MCP протокола
 * 
 * ReadResource Request возвращает содержимое конкретного ресурса
 * по его URI (логи, статус, модули правил).
 */

import * as path from 'path';
import * as fs from 'fs';
import { SharedLogStorage } from '../../shared-log-storage';
import { getServerUrl } from '../../code-injector';
import { logMCPRequest, logMCPResponse, logMCPError } from '../logging';
import { logDebug } from '../../error-handler';
import type { Hypothesis } from '../../types';

/**
 * Обрабатывает ReadResource Request
 * 
 * Поддерживаемые URI:
 * - roo-trace://logs - возвращает runtime логи
 * - roo-trace://status - возвращает статус отладки
 * - roo-trace://rules - возвращает список модулей правил
 * - roo-trace://rule/{filename} - возвращает содержимое конкретного модуля правила
 * 
 * @param request - MCP ReadResource Request
 * @param sharedStorage - Экземпляр SharedLogStorage
 * @param getWorkspaceRoot - Функция для получения корня workspace
 * @param startTime - Время старта сервера (для uptime)
 * @returns ReadResource Response с содержимым ресурса
 */
export async function handleReadResource(
  request: any,
  sharedStorage: SharedLogStorage,
  getWorkspaceRoot: () => string,
  startTime: number
) {
  const startTimeRequest = Date.now();
  const { uri } = request.params;
  logMCPRequest('read_resource', { uri });
  
  try {
    const workspaceRoot = getWorkspaceRoot();
    
    if (uri === 'roo-trace://logs') {
      // Возвращаем логи
      const logs = await sharedStorage.getLogs();
      const response = {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(logs, null, 2)
        }]
      };
      const duration = Date.now() - startTimeRequest;
      logMCPResponse('read_resource', response, duration);
      return response;
    } else if (uri === 'roo-trace://status') {
      // Возвращаем статус отладки
      const logs = await sharedStorage.getLogs();
      const hypotheses = await sharedStorage.getHypotheses();
      const serverUrl = getServerUrl(workspaceRoot);
      
      // Подсчитываем количество логов для каждой гипотезы
      const hypothesisLogCounts = new Map<string, number>();
      for (const log of logs) {
        const count = hypothesisLogCounts.get(log.hypothesisId) || 0;
        hypothesisLogCounts.set(log.hypothesisId, count + 1);
      }
      
      const status = {
        serverUrl: serverUrl || null,
        serverActive: !!serverUrl,
        logsCount: logs.length,
        hypothesesCount: hypotheses.length,
        hypotheses: hypotheses.map((h: Hypothesis) => ({
          id: h.id,
          description: h.description,
          status: h.status,
          logsCount: hypothesisLogCounts.get(h.id) || 0
        })),
        uptime: Date.now() - startTime
      };
      const response = {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(status, null, 2)
        }]
      };
      const duration = Date.now() - startTimeRequest;
      logMCPResponse('read_resource', response, duration);
      return response;
    } else if (uri === 'roo-trace://rules') {
      // Возвращаем список доступных модулей правил
      const rulesList: string[] = [];
      if (workspaceRoot) {
        const rulesDir = path.join(workspaceRoot, '.roo', 'roo-trace-rules');
        if (fs.existsSync(rulesDir)) {
          try {
            const ruleFiles = fs.readdirSync(rulesDir)
              .filter(file => file.endsWith('.md'))
              .sort();
            rulesList.push(...ruleFiles);
          } catch (error) {
            logDebug(`[MCP] Failed to list rule files: ${error}`);
          }
        }
      }
      const response = {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ rules: rulesList }, null, 2)
        }]
      };
      const duration = Date.now() - startTimeRequest;
      logMCPResponse('read_resource', response, duration);
      return response;
    } else if (uri.startsWith('roo-trace://rule/')) {
      // Возвращаем содержимое конкретного модуля правила
      const ruleName = uri.replace('roo-trace://rule/', '');
      if (!workspaceRoot) {
        throw new Error('Workspace root not found');
      }
      const rulePath = path.join(workspaceRoot, '.roo', 'roo-trace-rules', ruleName);
      
      // Проверка безопасности: только файлы из .roo/roo-trace-rules/
      const normalizedPath = path.normalize(rulePath);
      const rulesDir = path.normalize(path.join(workspaceRoot, '.roo', 'roo-trace-rules'));
      if (!normalizedPath.startsWith(rulesDir)) {
        throw new Error(`Invalid rule path: ${ruleName}`);
      }
      
      if (!fs.existsSync(rulePath)) {
        throw new Error(`Rule not found: ${ruleName}`);
      }
      
      const content = fs.readFileSync(rulePath, 'utf8');
      const response = {
        contents: [{
          uri,
          mimeType: 'text/markdown',
          text: content
        }]
      };
      const duration = Date.now() - startTimeRequest;
      logMCPResponse('read_resource', response, duration);
      return response;
    } else {
      throw new Error(`Unknown resource URI: ${uri}`);
    }
  } catch (error) {
    const duration = Date.now() - startTimeRequest;
    logMCPError('read_resource', error, duration);
    throw error;
  }
}
