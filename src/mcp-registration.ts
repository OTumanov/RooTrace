import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

export async function registerMcpServer(context: any): Promise<void> {
  try {
    // Use .roo/mcp.json in the workspace root
    const workspaceRoot = vscode.workspace.rootPath || os.homedir();
    const configDirPath = path.join(workspaceRoot, '.roo');
    const configFilePath = path.join(configDirPath, 'mcp.json');

    // Создание директории, если она не существует
    if (!fs.existsSync(configDirPath)) {
      fs.mkdirSync(configDirPath, { recursive: true });
    }

    // Чтение существующего файла конфигурации или создание нового
    let config: any = {};
    if (fs.existsSync(configFilePath)) {
      const configFileContent = fs.readFileSync(configFilePath, 'utf-8');
      config = JSON.parse(configFileContent);
    }

    // Путь к mcp-server.js относительно директории расширения
    const mcpServerPath = path.join(context.extensionPath, 'out', 'mcp-server.js');

    // Проверяем, существует ли файл сервера
    if (!fs.existsSync(mcpServerPath)) {
      console.error(`Файл mcp-сервера не найден: ${mcpServerPath}`);
      return;
    }

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

    // Запись обновленной конфигурации в файл
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Ошибка при регистрации MCP-сервера:', error);
  }
}

export async function unregisterMcpServer(): Promise<void> {
  try {
    // Use .roo/mcp.json in the workspace root
    const workspaceRoot = vscode.workspace.rootPath || os.homedir();
    const configDirPath = path.join(workspaceRoot, '.roo');
    const configFilePath = path.join(configDirPath, 'mcp.json');

    if (fs.existsSync(configFilePath)) {
      const configFileContent = fs.readFileSync(configFilePath, 'utf-8');
      const config: any = JSON.parse(configFileContent);

      // Remove RooTrace server configuration
      if (config.servers) {
        config.servers = config.servers.filter((server: any) => server.name !== 'roo-trace');
        
        // Write updated configuration to file
        fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2));
      }
    }
  } catch (error) {
    console.error('Ошибка при удалении регистрации MCP-сервера:', error);
  }
}