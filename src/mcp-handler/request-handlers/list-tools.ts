/**
 * Обработчик ListTools Request для MCP протокола
 * 
 * ListTools Request возвращает список всех доступных инструментов (tools)
 * с их схемами для клиента MCP.
 */

import { MCP_TOOL_SCHEMAS } from '../tool-schemas';
import { logMCPRequest, logMCPResponse, logMCPError } from '../logging';

/**
 * Обрабатывает ListTools Request
 * 
 * @param request - MCP ListTools Request
 * @returns ListTools Response со списком инструментов
 */
export async function handleListTools(request: any) {
  const startTime = Date.now();
  logMCPRequest('list_tools', request.params);
  
  try {
    const response = { tools: MCP_TOOL_SCHEMAS };
    const duration = Date.now() - startTime;
    logMCPResponse('list_tools', response, duration);
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    logMCPError('list_tools', error, duration);
    throw error;
  }
}
