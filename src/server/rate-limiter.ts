/**
 * Rate limiting для защиты от злоупотреблений
 */

import * as http from 'http';

/**
 * Конфигурация rate limiting
 */
export interface RateLimitConfig {
    maxRequests: number;
    windowMs: number;
}

/**
 * Запись rate limit для IP адреса
 */
interface RateLimitRecord {
    count: number;
    resetTime: number;
}

/**
 * Rate limiter
 */
export class RateLimiter {
    private static instance: RateLimiter;
    private rateLimitMap: Map<string, RateLimitRecord> = new Map();
    private config: RateLimitConfig;
    
    private constructor(config?: Partial<RateLimitConfig>) {
        this.config = {
            maxRequests: config?.maxRequests || 100,
            windowMs: config?.windowMs || 60000 // 1 минута по умолчанию
        };
    }
    
    /**
     * Получить экземпляр rate limiter (Singleton)
     */
    public static getInstance(config?: Partial<RateLimitConfig>): RateLimiter {
        if (!RateLimiter.instance) {
            RateLimiter.instance = new RateLimiter(config);
        }
        return RateLimiter.instance;
    }
    
    /**
     * Проверить rate limit для указанного IP адреса
     */
    public checkRateLimit(ip: string): boolean {
        const now = Date.now();
        const limit = this.rateLimitMap.get(ip);
        
        if (!limit || now > limit.resetTime) {
            this.rateLimitMap.set(ip, { count: 1, resetTime: now + this.config.windowMs });
            return true;
        }
        
        if (limit.count >= this.config.maxRequests) {
            return false;
        }
        
        limit.count++;
        return true;
    }
    
    /**
     * Получить IP адрес клиента из HTTP запроса
     */
    public getClientIP(req: http.IncomingMessage): string {
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded === 'string') {
            return forwarded.split(',')[0].trim();
        }
        return req.socket.remoteAddress || 'unknown';
    }
    
    /**
     * Очистить старые записи rate limit
     */
    public cleanup(): void {
        const now = Date.now();
        const entriesToDelete: string[] = [];
        
        this.rateLimitMap.forEach((record, ip) => {
            if (now > record.resetTime) {
                entriesToDelete.push(ip);
            }
        });
        
        entriesToDelete.forEach(ip => this.rateLimitMap.delete(ip));
    }
    
    /**
     * Получить текущую конфигурацию
     */
    public getConfig(): RateLimitConfig {
        return { ...this.config };
    }
    
    /**
     * Обновить конфигурацию
     */
    public updateConfig(config: Partial<RateLimitConfig>): void {
        this.config = { ...this.config, ...config };
    }
    
    /**
     * Получить статистику rate limit
     */
    public getStats(): { totalIPs: number; config: RateLimitConfig } {
        return {
            totalIPs: this.rateLimitMap.size,
            config: this.getConfig()
        };
    }
}