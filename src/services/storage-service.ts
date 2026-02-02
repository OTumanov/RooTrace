import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { encryptObject, decryptObject, getEncryptionKey } from '../encryption-utils';
import { getRootraceFilePath, ensureRootraceInGitignore } from '../rootrace-dir-utils';

export interface AIDebugConfig {
    url: string;
    status: string;
    timestamp: number;
}

export class StorageService {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Сохранить порт в файл
     */
    savePortToFile(port: number): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.outputChannel.appendLine('No workspace opened. Cannot save port file.');
            return;
        }
        
        // Убеждаемся, что .rootrace существует и добавлен в .gitignore
        ensureRootraceInGitignore();
        
        // Save port file to .rootrace directory
        const portFilePath = getRootraceFilePath('debug_port');
        try {
            fs.writeFileSync(portFilePath, port.toString(), 'utf8');
            this.outputChannel.appendLine(`Port ${port} saved to ${portFilePath}`);
        } catch (error) {
            this.outputChannel.appendLine(`Error saving port file: ${error}`);
        }
    }

    /**
     * Удалить файл порта
     */
    removePortFile(): void {
        const portFilePath = getRootraceFilePath('debug_port');
        if (fs.existsSync(portFilePath)) {
            try {
                fs.unlinkSync(portFilePath);
                this.outputChannel.appendLine(`Removed port file: ${portFilePath}`);
            } catch (error) {
                this.outputChannel.appendLine(`Error removing port file: ${error}`);
            }
        }
    }

    /**
     * Удалить конфигурационный файл AI Debug
     */
    removeAIDebugConfig(): void {
        const configPath = getRootraceFilePath('ai_debug_config');
        if (fs.existsSync(configPath)) {
            try {
                fs.unlinkSync(configPath);
                this.outputChannel.appendLine(`Removed config file: ${configPath}`);
            } catch (error) {
                this.outputChannel.appendLine(`Error removing config file: ${error}`);
            }
        }
    }

    /**
     * Создать конфигурационный файл AI Debug
     */
    async createAIDebugConfig(port: number | null): Promise<void> {
        if (!port) {
            this.outputChannel.appendLine('[SYSTEM] Port not assigned yet, skipping .ai_debug_config creation');
            return;
        }
        
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.outputChannel.appendLine('[SYSTEM] No workspace folders, skipping .ai_debug_config creation');
            return;
        }
        
        // Убеждаемся, что .rootrace существует и добавлен в .gitignore
        ensureRootraceInGitignore();
        
        // Create config for each workspace folder
        for (const folder of workspaceFolders) {
            const configPath = getRootraceFilePath('ai_debug_config');
            const config: AIDebugConfig = {
                url: `http://localhost:${port}/`,
                status: "active",
                timestamp: Date.now()
            };
            
            try {
                // Encrypt the config before writing to file
                const encryptionKey = getEncryptionKey();
                const encryptedConfig = encryptObject(config, encryptionKey);
                fs.writeFileSync(configPath, encryptedConfig, 'utf8');
                this.outputChannel.appendLine(`[SYSTEM] Created encrypted .ai_debug_config in ${folder.name}`);
            } catch (error) {
                this.outputChannel.appendLine(`[SYSTEM] Error creating .ai_debug_config in ${folder.name}: ${error}`);
            }
        }
    }

    /**
     * Загрузить конфигурационный файл AI Debug
     */
    loadAIDebugConfig(): AIDebugConfig | null {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.outputChannel.appendLine('[SYSTEM] No workspace opened. Cannot load .ai_debug_config.');
            return null;
        }
        
        // Try to load from first workspace folder
        const configPath = path.join(workspaceFolders[0].uri.fsPath, '.ai_debug_config');
        
        if (!fs.existsSync(configPath)) {
            this.outputChannel.appendLine('[SYSTEM] .ai_debug_config not found in workspace root.');
            return null;
        }
        
        try {
            const configContent = fs.readFileSync(configPath, 'utf8');
            
            // Try to parse as JSON first (for backwards compatibility with unencrypted configs)
            let config: AIDebugConfig;
            try {
                config = JSON.parse(configContent);
            } catch (parseError) {
                // If JSON parsing fails, try to decrypt the content
                try {
                    const encryptionKey = getEncryptionKey();
                    config = decryptObject(configContent, encryptionKey);
                } catch (decryptError) {
                    this.outputChannel.appendLine(`[SYSTEM] Error decrypting .ai_debug_config: ${decryptError}`);
                    return null;
                }
            }
            
            return config;
        } catch (error) {
            this.outputChannel.appendLine(`[SYSTEM] Error reading .ai_debug_config: ${error}`);
            return null;
        }
    }

    /**
     * Получить путь к файлу логов
     */
    getLogFilePath(): string {
        return getRootraceFilePath('ai_debug_logs.json');
    }

    /**
     * Получить путь к файлу разрешения чтения логов
     */
    getReadLogsApprovalFilePath(): string {
        return getRootraceFilePath('allow-read-runtime-logs.json');
    }

    /**
     * Получить путь к файлу разрешения авто-отладки
     */
    getAutoDebugApprovalFilePath(): string {
        return getRootraceFilePath('allow-auto-debug.json');
    }
}