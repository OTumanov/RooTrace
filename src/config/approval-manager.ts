/**
 * Менеджер файлов разрешений
 */

import * as fs from 'fs';
import * as path from 'path';
import { getRootraceFilePath } from '../rootrace-dir-utils';

/**
 * Интерфейс разрешения
 */
export interface Approval {
    approvedAt: string;
    approvedAtMs: number;
    ttlMs?: number;
}

/**
 * Менеджер разрешений
 */
export class ApprovalManager {
    private static instance: ApprovalManager;
    
    private constructor() {}
    
    /**
     * Получить экземпляр менеджера (Singleton)
     */
    public static getInstance(): ApprovalManager {
        if (!ApprovalManager.instance) {
            ApprovalManager.instance = new ApprovalManager();
        }
        return ApprovalManager.instance;
    }
    
    /**
     * Создать разрешение на чтение логов
     */
    public createReadLogsApproval(): Approval {
        return {
            approvedAt: new Date().toISOString(),
            approvedAtMs: Date.now()
        };
    }
    
    /**
     * Создать разрешение на авто-отладку
     */
    public createAutoDebugApproval(ttlMinutes: number = 5): Approval {
        return {
            approvedAt: new Date().toISOString(),
            approvedAtMs: Date.now(),
            ttlMs: ttlMinutes * 60 * 1000
        };
    }
    
    /**
     * Сохранить разрешение в файл
     */
    public saveApproval(approval: Approval, filePath: string): boolean {
        try {
            fs.writeFileSync(filePath, JSON.stringify(approval, null, 2), 'utf8');
            return true;
        } catch (error) {
            console.error(`[ApprovalManager] Error saving approval to ${filePath}:`, error);
            return false;
        }
    }
    
    /**
     * Загрузить разрешение из файла
     */
    public loadApproval(filePath: string): Approval | null {
        try {
            if (!fs.existsSync(filePath)) {
                return null;
            }
            
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error(`[ApprovalManager] Error loading approval from ${filePath}:`, error);
            return null;
        }
    }
    
    /**
     * Удалить файл разрешения
     */
    public removeApproval(filePath: string): boolean {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`[ApprovalManager] Error removing approval file ${filePath}:`, error);
            return false;
        }
    }
    
    /**
     * Проверить, действительно ли разрешение
     */
    public isValidApproval(approval: Approval | null): boolean {
        if (!approval) {
            return false;
        }
        
        // Проверить TTL если указан
        if (approval.ttlMs) {
            const now = Date.now();
            const approvalTime = approval.approvedAtMs;
            return (now - approvalTime) < approval.ttlMs;
        }
        
        // Разрешение без TTL считается действительным
        return true;
    }
    
    /**
     * Проверить наличие действительного разрешения в файле
     */
    public hasValidApproval(filePath: string): boolean {
        const approval = this.loadApproval(filePath);
        return this.isValidApproval(approval);
    }
}