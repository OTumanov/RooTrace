/**
 * Кэш для загруженных правил из .roo/rules/
 * Предотвращает повторное чтение файлов и позволяет управлять lazy loading
 */

export interface RuleMetadata {
    /** Путь к файлу правила */
    path: string;
    /** Содержимое файла (загружено или null для lazy loading) */
    content: string | null;
    /** Время последней загрузки */
    loadedAt: number | null;
    /** Критичное правило (загружается автоматически) */
    critical: boolean;
    /** Режим загрузки: 'eager' или 'lazy' */
    loadingMode: 'eager' | 'lazy';
}

export class RulesCache {
    private static instance: RulesCache;
    private cache: Map<string, RuleMetadata> = new Map();
    private loadingMode: 'eager' | 'lazy' = 'eager';

    private constructor() {}

    static getInstance(): RulesCache {
        if (!RulesCache.instance) {
            RulesCache.instance = new RulesCache();
        }
        return RulesCache.instance;
    }

    /**
     * Устанавливает режим загрузки (eager или lazy)
     */
    setLoadingMode(mode: 'eager' | 'lazy'): void {
        this.loadingMode = mode;
    }

    /**
     * Получает режим загрузки
     */
    getLoadingMode(): 'eager' | 'lazy' {
        return this.loadingMode;
    }

    /**
     * Добавляет правило в кэш
     */
    addRule(rulePath: string, content: string | null, critical: boolean = false): void {
        this.cache.set(rulePath, {
            path: rulePath,
            content: content,
            loadedAt: content ? Date.now() : null,
            critical: critical,
            loadingMode: this.loadingMode
        });
    }

    /**
     * Получает правило из кэша
     */
    getRule(rulePath: string): RuleMetadata | undefined {
        return this.cache.get(rulePath);
    }

    /**
     * Проверяет, загружено ли правило
     */
    isLoaded(rulePath: string): boolean {
        const rule = this.cache.get(rulePath);
        return rule !== undefined && rule.content !== null;
    }

    /**
     * Загружает содержимое правила (для lazy loading)
     */
    async loadRuleContent(rulePath: string, content: string): Promise<void> {
        const rule = this.cache.get(rulePath);
        if (rule) {
            rule.content = content;
            rule.loadedAt = Date.now();
        } else {
            this.addRule(rulePath, content, false);
        }
    }

    /**
     * Получает все правила (только метаданные)
     */
    getAllRules(): RuleMetadata[] {
        return Array.from(this.cache.values());
    }

    /**
     * Получает все загруженные правила (с содержимым)
     */
    getLoadedRules(): RuleMetadata[] {
        return Array.from(this.cache.values()).filter(rule => rule.content !== null);
    }

    /**
     * Получает все lazy правила (без содержимого)
     */
    getLazyRules(): RuleMetadata[] {
        return Array.from(this.cache.values()).filter(rule => rule.content === null);
    }

    /**
     * Очищает кэш
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Удаляет правило из кэша
     */
    removeRule(rulePath: string): void {
        this.cache.delete(rulePath);
    }
}
