/**
 * Обработчик ListResources Request для MCP протокола
 * 
 * ListResources Request возвращает список всех доступных ресурсов,
 * включая логи, статус отладки и модули правил.
 */

import * as path from 'path';
import * as fs from 'fs';
import { logMCPRequest, logMCPResponse, logMCPError } from '../logging';
import { logDebug } from '../../error-handler';

/**
 * Обрабатывает ListResources Request
 * 
 * @param request - MCP ListResources Request
 * @param getWorkspaceRoot - Функция для получения корня workspace
 * @returns ListResources Response со списком ресурсов
 */
export async function handleListResources(
  request: any,
  getWorkspaceRoot: () => string
) {
  const startTime = Date.now();
  logMCPRequest('list_resources', request.params);
  
  try {
    const workspaceRoot = getWorkspaceRoot();
    const resources = [
      {
        uri: 'roo-trace://logs',
        name: 'Runtime Logs',
        description: 'Runtime logs from debugging session',
        mimeType: 'application/json'
      },
      {
        uri: 'roo-trace://status',
        name: 'Debug Status',
        description: 'Current debug status including server status and active hypotheses',
        mimeType: 'application/json'
      },
      {
        uri: 'roo-trace://rules',
        name: 'Rule Modules',
        description: 'List of available rule modules in .roo/roo-trace-rules/',
        mimeType: 'application/json'
      }
    ];

    // Добавляем ресурсы для конкретных модулей правил, если они существуют
    if (workspaceRoot) {
      const rulesDir = path.join(workspaceRoot, '.roo', 'roo-trace-rules');
      if (fs.existsSync(rulesDir)) {
        try {
          const ruleFiles = fs.readdirSync(rulesDir)
            .filter(file => file.endsWith('.md'))
            .slice(0, 50); // Ограничение на количество ресурсов
          
          for (const ruleFile of ruleFiles) {
            resources.push({
              uri: `roo-trace://rule/${ruleFile}`,
              name: `Rule: ${ruleFile}`,
              description: `Rule module: ${ruleFile}`,
              mimeType: 'text/markdown'
            });
          }
        } catch (error) {
          logDebug(`[MCP] Failed to list rule files: ${error}`);
        }
      }
    }

    const response = { resources };
    const duration = Date.now() - startTime;
    logMCPResponse('list_resources', response, duration);
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    logMCPError('list_resources', error, duration);
    throw error;
  }
}
