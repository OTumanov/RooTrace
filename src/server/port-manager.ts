/**
 * Менеджер портов и конфигурационных файлов
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getRootraceFilePath, ensureRootraceInGitignore } from '../rootrace-dir-utils';

/**
 * Менеджер портов
 */
export class PortManager {
    private static instance: PortManager;
    
    private constructor() {}
    
    /**
     * Получить экземпляр менеджера (Singleton)
     */
    public static getInstance(): PortManager {
        if (!PortManager.instance) {
            PortManager.instance = new PortManager();
        }
        return PortManager.instance;
    }
    
    /**
     * Сохранить порт в файл
     */
    public savePortToFile(port: number): boolean {
        try {
            // Убедиться, что .rootrace существует и добавлен в .gitignore
            ensureRootraceInGitignore();
            
            // Сохранить порт в файл .rootrace/debug_port
            const portFilePath = getRootraceFilePath('debug_port');
            fs.writeFileSync(portFilePath, port.toString(), 'utf8');
            console.log(`[PortManager] Port ${port} saved to ${portFilePath}`);
            return true;
        } catch (error) {
            console.error(`[PortManager] Error saving port file: ${error}`);
            return false;
        }
    }
    
    /**
     * Удалить файл с портом
     */
    public removePortFile(): boolean {
        try {
            const portFilePath = getRootraceFilePath('debug_port');
            if (fs.existsSync(portFilePath)) {
                fs.unlinkSync(portFilePath);
                console.log(`[PortManager] Removed port file: ${portFilePath}`);
            }
            return true;
        } catch (error) {
            console.error(`[PortManager] Error removing port file: ${error}`);
            return false;
        }
    }
    
    /**
     * Загрузить порт из файла
     */
    public loadPortFromFile(): number | null {
        try {
            const portFilePath = getRootraceFilePath('debug_port');
            if (fs.existsSync(portFilePath)) {
                const portContent = fs.readFileSync(portFilePath, 'utf8').trim();
                const port = parseInt(portContent, 10);
                if (!isNaN(port) && port > 0 && port < 65536) {
                    console.log(`[PortManager] Loaded port ${port} from file`);
                    return port;
                }
            }
            console.log('[PortManager] No port file found or invalid content');
            return null;
        } catch (error) {
            console.error(`[PortManager] Error loading port from file: ${error}`);
            return null;
        }
    }
    
    /**
     * Получить доступный порт
     */
    public async getAvailablePort(preferredPort?: number): Promise<number> {
        const portToTry = preferredPort || 51234;
        
        // Проверить, свободен ли предпочитаемый порт
        if (!(await this.isPortInUse(portToTry))) {
            return portToTry;
        }
        
        // Найти следующий свободный порт
        let port = portToTry;
        while (port < 65535) {
            if (!(await this.isPortInUse(port))) {
                return port;
            }
            port++;
        }
        
        // Если не удалось найти свободный порт, использовать 0 (рандомный)
        return 0;
    }
    
    /**
     * Проверить, занят ли порт
     */
    public async isPortInUse(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const net = require('net');
            const server = net.createServer();
            
            server.once('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    resolve(true); // Порт занят
                } else {
                    resolve(false); // Произошла другая ошибка, считаем порт свободным
                }
            });
            
            server.once('listening', () => {
                // Порт свободен, закрываем сервер
                server.close(() => {
                    resolve(false); // Порт свободен
                });
            });
            
            // Пытаемся прослушивать указанный порт
            server.listen({ port, host: 'localhost' });
        });
    }
}