/**
 * Менеджер конфигурации
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getRootraceFilePath } from '../rootrace-dir-utils';
import { getEncryptionKey, encryptObject, decryptObject } from '../encryption-utils';
import { AIDebugConfig } from '../services/storage-service';

/**
 * Менеджер конфигурации
 */
export class ConfigManager {
    private static instance: ConfigManager;
    
    private constructor() {}
    
    /**
     * Получить экземпляр менеджера (Singleton)
     */
    public static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }
    
    /**
     * Создать AI debug конфигурацию
     */
    public createAIDebugConfig(port: number): AIDebugConfig {
        return {
            url: `http://localhost:${port}/`,
            status: "active",
            timestamp: Date.now()
        };
    }
    
    /**
     * Сохранить AI debug конфигурацию
     */
    public saveAIDebugConfig(config: AIDebugConfig): boolean {
        try {
            const configPath = getRootraceFilePath('ai_debug_config');
            const encryptionKey = getEncryptionKey();
            const encryptedConfig = encryptObject(config, encryptionKey);
            fs.writeFileSync(configPath, encryptedConfig, 'utf8');
            return true;
        } catch (error) {
            console.error('[ConfigManager] Error saving AI debug config:', error);
            return false;
        }
    }
    
    /**
     * Загрузить AI debug конфигурацию
     */
    public loadAIDebugConfig(): AIDebugConfig | null {
        try {
            const configPath = getRootraceFilePath('ai_debug_config');
            
            if (!fs.existsSync(configPath)) {
                return null;
            }
            
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
                    console.error('[ConfigManager] Error decrypting .ai_debug_config:', decryptError);
                    return null;
                }
            }
            
            return config;
        } catch (error) {
            console.error('[ConfigManager] Error reading .ai_debug_config:', error);
            return null;
        }
    }
    
    /**
     * Удалить AI debug конфигурацию
     */
    public removeAIDebugConfig(): boolean {
        try {
            const configPath = getRootraceFilePath('ai_debug_config');
            if (fs.existsSync(configPath)) {
                fs.unlinkSync(configPath);
                return true;
            }
            return false;
        } catch (error) {
            console.error('[ConfigManager] Error removing AI debug config:', error);
            return false;
        }
    }
    
    /**
     * Получить путь к файлу логов
     */
    public getLogFilePath(): string {
        return getRootraceFilePath('ai_debug_logs.json');
    }
    
    /**
     * Получить путь к файлу разрешения чтения логов
     */
    public getReadLogsApprovalFilePath(): string {
        return getRootraceFilePath('allow-read-runtime-logs.json');
    }
    
    /**
     * Получить путь к файлу разрешения авто-отладки
     */
    public getAutoDebugApprovalFilePath(): string {
        return getRootraceFilePath('allow-auto-debug.json');
    }
}