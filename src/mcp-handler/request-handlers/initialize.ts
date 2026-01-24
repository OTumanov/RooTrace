/**
 * Обработчик Initialize Request для MCP протокола
 * 
 * Initialize Request - это обязательный запрос, который должен быть обработан
 * при подключении клиента к MCP серверу. Возвращает информацию о сервере
 * и его возможностях.
 */

import { logMCPRequest, logMCPResponse, logMCPError } from '../logging';

/**
 * Обрабатывает Initialize Request
 * 
 * @param request - MCP Initialize Request
 * @returns Initialize Response с информацией о сервере
 */
export async function handleInitialize(request: any) {
  const startTime = Date.now();
  logMCPRequest('initialize', request.params);
  
  try {
    const response = {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {}
      },
      serverInfo: {
        name: 'RooTrace',
        version: '1.0.0'
      }
    };
    
    const duration = Date.now() - startTime;
    logMCPResponse('initialize', response, duration);
    
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    logMCPError('initialize', error, duration);
    throw error;
  }
}
