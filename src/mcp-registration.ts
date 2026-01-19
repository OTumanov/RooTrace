import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

// Simple in‑memory lock to serialize file operations per file and avoid race conditions
const fileOperationLocks: Map<string, Promise<void>> = new Map();

export async function detectInstalledExtension(): Promise<'roo-code' | 'roo-cline' | null> {
  try {
    const extensions = vscode.extensions.all;
    
    // Проверяем наличие расширений Roo Code и Roo Cline
    const rooCodeExtension = extensions.find(ext => ext.id.toLowerCase().includes('roo-code'));
    const rooClineExtension = extensions.find(ext => ext.id.toLowerCase().includes('roo-cline'));
    
    if (rooClineExtension) {
      return 'roo-cline';
    } else if (rooCodeExtension) {
      return 'roo-code';
    }
    
    return null;
  } catch (error) {
    console.error('Ошибка при детектировании расширения:', error);
    return null;
  }
}

export async function registerMcpServer(context: any): Promise<void> {
  try {
    const installedExtension = await detectInstalledExtension();
    console.log(`[RooTrace] Обнаружено установленное расширение: ${installedExtension}`);
    console.error(`[RooTrace] Обнаружено установленное расширение: ${installedExtension}`);
    
    // Use .roo/mcp.json in the workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      const errorMsg = '[RooTrace] No workspace folders, cannot register MCP server';
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    // Register for each workspace folder
    for (const folder of workspaceFolders) {
      await registerMcpServerForWorkspace(context, folder.uri.fsPath, installedExtension);
    }
  } catch (error) {
    const errorMsg = `Ошибка при регистрации MCP-сервера: ${error}`;
    console.error(errorMsg);
    throw error; // Пробрасываем ошибку дальше для обработки в activate
  }
}

async function registerMcpServerForWorkspace(context: any, workspacePath: string, installedExtension: 'roo-code' | 'roo-cline' | null): Promise<void> {
  try {
    const configDirPath = path.join(workspacePath, '.roo');
    const configFilePath = path.join(configDirPath, 'mcp.json');

    // Создание директории, если она не существует
    try {
      await fs.promises.access(configDirPath, fs.constants.F_OK);
    } catch {
      await fs.promises.mkdir(configDirPath, { recursive: true });
    }

    // Чтение существующего файла конфигурации или создание нового
    let config: any = {};
    try {
      const configFileContent = await fs.promises.readFile(configFilePath, 'utf-8');
      config = JSON.parse(configFileContent);
    } catch (error) {
      // Файл не существует - это нормально для новой конфигурации
      if (error instanceof Error && !error.message.includes('ENOENT')) {
        throw error;
      }
    }

    // Абсолютный путь к mcp-server.js в директории расширения
    const mcpServerPath = path.resolve(context.extensionPath, 'out', 'mcp-server.js');

    // Проверяем, существует ли файл сервера
    if (!fs.existsSync(mcpServerPath)) {
      const errorMsg = `[RooTrace] Файл mcp-сервера не найден: ${mcpServerPath}`;
      console.error(errorMsg);
      console.error(`[RooTrace] Extension path: ${context.extensionPath}`);
      console.error(`[RooTrace] Проверьте, что проект скомпилирован: npm run compile`);
      throw new Error(`MCP server file not found: ${mcpServerPath}. Please compile the project first.`);
    }

    // Логирование информации о создании конфигурации
    const logMsg1 = `[RooTrace] Создание конфигурации MCP сервера в: ${configFilePath}`;
    const logMsg2 = `[RooTrace] Путь к MCP серверу: ${mcpServerPath}`;
    console.log(logMsg1);
    console.log(logMsg2);
    console.error(logMsg1);
    console.error(logMsg2);

    if (installedExtension === 'roo-cline') {
      // Формат для Roo Cline: {"mcpServers": {"roo-trace": {"command": "node", "args": [...]}}}
      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      config.mcpServers['roo-trace'] = {
        command: 'node',
        args: [mcpServerPath],
        alwaysAllow: [
          'read_runtime_logs',
          'get_debug_status',
          'clear_session',
          'inject_probes'
        ]
      };
    } else {
      // Формат для Roo Code: {"servers": [...]}
      // Конфигурация RooTrace в формате MCP
      const rooTraceServer = {
        name: 'roo-trace',
        description: 'RooTrace MCP Server for debugging and tracing',
        handler: {
          type: 'stdio',
          command: 'node',
          args: [mcpServerPath]
        },
        tools: [
          {
            name: 'read_runtime_logs',
            description: 'Получает логи отладочной сессии RooTrace',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'ID сессии для получения логов (если не указан, возвращаются логи текущей сессии)'
                }
              }
            }
          },
          {
            name: 'get_debug_status',
            description: 'Возвращает статус сервера (активен/не активен), список активных гипотез и текущую сессию',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'clear_session',
            description: 'Очищает сессию отладки RooTrace, сбрасывает все гипотезы и логи',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'ID сессии для очистки (если не указан, очищается текущая сессия)'
                }
              }
            }
          },
          {
            name: 'inject_probes',
            description: 'Инъекция проб в код для дополнительной отладочной информации',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Путь к файлу для инъекции проб'
                },
                lineNumber: {
                  type: 'number',
                  description: 'Номер строки для инъекции пробы'
                },
                probeType: {
                  type: 'string',
                  enum: ['log', 'trace', 'error'],
                  description: 'Тип пробы для инъекции'
                },
                message: {
                  type: 'string',
                  description: 'Сообщение для пробы'
                }
              },
              required: ['filePath', 'lineNumber', 'probeType']
            }
          }
        ]
      };

      // Проверяем, существует ли уже массив servers, если нет - создаем
      if (!config.servers) {
        config.servers = [];
      }

      // Удаляем старую конфигурацию RooTrace, если она существует
      config.servers = config.servers.filter((server: any) => server.name !== 'roo-trace');

      // Добавляем новую конфигурацию RooTrace
      config.servers.push(rooTraceServer);
    }
    
    // Запись обновленной конфигурации в файл
    // Acquire lock for the file to prevent concurrent modifications
    const previousLock = fileOperationLocks.get(configFilePath) || Promise.resolve();
    let releaseLock: () => void;
    const currentLock = new Promise<void>((res) => (releaseLock = res));
    fileOperationLocks.set(configFilePath, previousLock.then(() => currentLock));

    try {
      await fs.promises.writeFile(configFilePath, JSON.stringify(config, null, 2));
    } finally {
      // Release the lock
      releaseLock!();
    }

    const successMsg = `[RooTrace] Конфигурация MCP сервера успешно создана в: ${configFilePath}`;
    console.log(successMsg);
    console.error(successMsg);
    console.error(`[RooTrace] Конфигурация: ${JSON.stringify(config, null, 2)}`);
  } catch (error) {
    const errorMsg = `[RooTrace] Ошибка при регистрации MCP-сервера для ${workspacePath}: ${error}`;
    console.error(errorMsg);
    throw error; // Пробрасываем ошибку для обработки в activate
  }
}


export async function unregisterMcpServer(): Promise<void> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      console.error('[RooTrace] No workspace folders, cannot unregister MCP server');
      return;
    }
    
    // Unregister for each workspace folder
    for (const folder of workspaceFolders) {
      const configDirPath = path.join(folder.uri.fsPath, '.roo');
      const configFilePath = path.join(configDirPath, 'mcp.json');

      try {
        // Асинхронно проверяем, существует ли файл
        await fs.promises.access(configFilePath, fs.constants.F_OK);
        
        const configFileContent = await fs.promises.readFile(configFilePath, 'utf-8');
        const config: any = JSON.parse(configFileContent);

        // Remove RooTrace server configuration
        if (config.servers) {
          config.servers = config.servers.filter((server: any) => server.name !== 'roo-trace');
          
          // Write updated configuration to file
          // Acquire lock for the file to prevent concurrent modifications
          const previousLock = fileOperationLocks.get(configFilePath) || Promise.resolve();
          let releaseLock: () => void;
          const currentLock = new Promise<void>((res) => (releaseLock = res));
          fileOperationLocks.set(configFilePath, previousLock.then(() => currentLock));

          try {
            await fs.promises.writeFile(configFilePath, JSON.stringify(config, null, 2));
          } finally {
            // Release the lock
            releaseLock!();
          }
          console.log(`[RooTrace] Unregistered MCP server from ${folder.name}`);
        }
        
        // Also remove from mcpServers (Roo Cline format)
        if (config.mcpServers && config.mcpServers['roo-trace']) {
          delete config.mcpServers['roo-trace'];
          
          // Acquire lock for the file to prevent concurrent modifications
          const previousLock = fileOperationLocks.get(configFilePath) || Promise.resolve();
          let releaseLock: () => void;
          const currentLock = new Promise<void>((res) => (releaseLock = res));
          fileOperationLocks.set(configFilePath, previousLock.then(() => currentLock));

          try {
            await fs.promises.writeFile(configFilePath, JSON.stringify(config, null, 2));
          } finally {
            // Release the lock
            releaseLock!();
          }
        }
      } catch (error) {
        console.error(`Ошибка при удалении регистрации MCP-сервера из ${folder.name}:`, error);
      }
    }
  } catch (error) {
    console.error('Ошибка при удалении регистрации MCP-сервера:', error);
  }
}