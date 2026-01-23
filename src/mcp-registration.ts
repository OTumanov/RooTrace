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
      // Если файл пустой или содержит только пробелы, считаем его пустым объектом
      const trimmedContent = configFileContent.trim();
      if (trimmedContent === '') {
        config = {};
      } else {
        config = JSON.parse(trimmedContent);
      }
    } catch (error) {
      // Файл не существует или содержит невалидный JSON - это нормально для новой конфигурации
      if (error instanceof Error && !error.message.includes('ENOENT') && !error.message.includes('Unexpected end of JSON input')) {
        throw error;
      }
      // Если файл пустой или невалидный, используем пустой объект
      config = {};
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
        env: {
          ROO_TRACE_WORKSPACE: workspacePath
        },
        alwaysAllow: [
          'read_runtime_logs',
          'get_debug_status',
          'clear_session',
          'inject_probes'
        ]
      };
    } else {
      // Формат для Roo Code: {"mcpServers": {"roo-trace": {"command": "node", "args": [...]}}}
      // Согласно документации Roo Code, используется тот же формат, что и для Roo Cline
      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      config.mcpServers['roo-trace'] = {
        command: 'node',
        args: [mcpServerPath],
        env: {
          ROO_TRACE_WORKSPACE: workspacePath
        },
        // Примечание: alwaysAllow включает инструменты для автоматического одобрения
        // - read_runtime_logs: требует явного одобрения через кнопку (проверка в коде)
        // - get_debug_status, clear_session: безопасные операции чтения/очистки состояния
        // - inject_probes: изменяет файлы, но имеет встроенные проверки безопасности (git commit/backup)
        // - mcp--roo-trace--load_rule, mcp--roo-trace--get_problems: безопасные операции чтения
        alwaysAllow: [
          'read_runtime_logs',
          'get_debug_status',
          'clear_session',
          'inject_probes',
          'mcp--roo-trace--load_rule',
          'mcp--roo-trace--get_problems'
        ]
      };
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
        // Удаляем из mcpServers (формат для Roo Code и Roo Cline)
        let configChanged = false;
        if (config.mcpServers && config.mcpServers['roo-trace']) {
          delete config.mcpServers['roo-trace'];
          configChanged = true;
        }
        
        // Также удаляем из старого формата servers (для обратной совместимости)
        if (config.servers) {
          const originalLength = config.servers.length;
          config.servers = config.servers.filter((server: any) => server.name !== 'roo-trace');
          if (config.servers.length !== originalLength) {
            configChanged = true;
          }
        }
        
        // Write updated configuration to file if changes were made
        if (configChanged) {
          // Acquire lock for the file to prevent concurrent modifications
          const previousLock = fileOperationLocks.get(configFilePath) || Promise.resolve();
          let releaseLock: () => void;
          const currentLock = new Promise<void>((res) => (releaseLock = res));
          fileOperationLocks.set(configFilePath, previousLock.then(() => currentLock));

          try {
            await fs.promises.writeFile(configFilePath, JSON.stringify(config, null, 2));
            console.log(`[RooTrace] Unregistered MCP server from ${folder.name}`);
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