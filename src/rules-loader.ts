/**
 * Загрузчик правил из .roo/rules/ с поддержкой lazy loading
 * Реализует логику загрузки правил как в Roo Code
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RulesCache, RuleMetadata } from './rules-cache';
import { getWorkspaceRootOrNull } from './utils/workspace-utils';

export interface LoadedRule {
    /** Путь к файлу правила */
    path: string;
    /** Содержимое файла (или ссылка для lazy loading) */
    content: string;
    /** Заголовок для system prompt */
    header: string;
    /** Критичное правило (загружается автоматически) */
    critical: boolean;
}

export interface RulesLoadOptions {
    /** Режим загрузки: 'eager' или 'lazy' */
    loadingMode?: 'eager' | 'lazy';
    /** Режим (mode slug) для загрузки mode-specific правил */
    modeSlug?: string;
    /** Workspace path (если не указан, определяется автоматически) */
    workspacePath?: string;
}

export class RulesLoader {
    private static readonly SYSTEM_FILES = [
        '.DS_Store', '.swp', '.bak', '.cache', '.log', '.tmp', 'Thumbs.db',
        'desktop.ini', '.git', '.svn', '.hg'
    ];
    private static readonly MAX_SYMLINK_DEPTH = 5;
    private static readonly SUPPORTED_EXTENSIONS = ['.md', '.txt', '.markdown'];

    /**
     * Получает путь к workspace root
     * Использует общую утилиту из utils/workspace-utils
     */
    private static getWorkspaceRoot(): string | null {
        return getWorkspaceRootOrNull();
    }

    /**
     * Получает путь к глобальной директории правил
     */
    private static getGlobalRulesDir(): string {
        const homeDir = os.homedir();
        return path.join(homeDir, '.roo', 'rules');
    }

    /**
     * Проверяет, является ли файл системным (игнорируется)
     */
    private static isSystemFile(fileName: string): boolean {
        const lowerName = fileName.toLowerCase();
        return this.SYSTEM_FILES.some(sysFile => 
            lowerName === sysFile.toLowerCase() || 
            lowerName.endsWith(sysFile.toLowerCase())
        );
    }

    /**
     * Проверяет, поддерживается ли расширение файла
     */
    private static isSupportedFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return this.SUPPORTED_EXTENSIONS.includes(ext);
    }

    /**
     * Рекурсивно читает все файлы правил из директории
     * Возвращает отсортированный список путей к файлам
     */
    private static readRulesDirectory(
        dirPath: string, 
        relativePath: string = '',
        symlinkDepth: number = 0
    ): string[] {
        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
            return [];
        }

        if (symlinkDepth > this.MAX_SYMLINK_DEPTH) {
            console.warn(`[RulesLoader] Max symlink depth reached for ${dirPath}`);
            return [];
        }

        const files: string[] = [];
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const relativeFilePath = path.join(relativePath, entry.name);

            // Пропускаем системные файлы
            if (this.isSystemFile(entry.name)) {
                continue;
            }

            if (entry.isSymbolicLink()) {
                // Обрабатываем символические ссылки
                try {
                    const realPath = fs.realpathSync(fullPath);
                    if (fs.statSync(realPath).isDirectory()) {
                        files.push(...this.readRulesDirectory(realPath, relativeFilePath, symlinkDepth + 1));
                    } else if (fs.statSync(realPath).isFile() && this.isSupportedFile(realPath)) {
                        files.push(realPath);
                    }
                } catch (e) {
                    console.warn(`[RulesLoader] Error resolving symlink ${fullPath}: ${e}`);
                }
            } else if (entry.isDirectory()) {
                // Рекурсивно читаем поддиректории
                files.push(...this.readRulesDirectory(fullPath, relativeFilePath, symlinkDepth));
            } else if (entry.isFile() && this.isSupportedFile(fullPath)) {
                files.push(fullPath);
            }
        }

        // Сортируем по имени файла (case-insensitive)
        return files.sort((a, b) => {
            const nameA = path.basename(a).toLowerCase();
            const nameB = path.basename(b).toLowerCase();
            return nameA.localeCompare(nameB);
        });
    }

    /**
     * Читает содержимое файла правила
     */
    private static readRuleFile(filePath: string): string | null {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            // Пропускаем пустые файлы
            if (!content.trim()) {
                return null;
            }
            return content;
        } catch (e) {
            console.warn(`[RulesLoader] Error reading rule file ${filePath}: ${e}`);
            return null;
        }
    }

    /**
     * Создает заголовок для system prompt
     */
    private static createHeader(filePath: string, isGlobal: boolean = false): string {
        const absolutePath = path.resolve(filePath);
        if (isGlobal) {
            return `# Rules from ${absolutePath}:`;
        }
        return `# Rules from ${absolutePath}:`;
    }

    /**
     * Проверяет, является ли правило критичным (по содержимому или имени файла)
     */
    private static isCriticalRule(filePath: string, content: string | null): boolean {
        const fileName = path.basename(filePath).toLowerCase();
        
        // КРИТИЧЕСКИ ВАЖНО: Базовые модули (00-base-*.md, roo-00-role.md) НЕ являются critical
        // Они должны загружаться лениво через load_rule
        if (fileName.startsWith('00-base-') || fileName === 'roo-00-role.md') {
            return false;
        }
        
        // Критичные правила: critical.md, required.md, mandatory.md
        if (fileName.includes('critical') || fileName.includes('required') || fileName.includes('mandatory')) {
            return true;
        }
        // Проверяем содержимое на наличие маркера (только для НЕ базовых модулей)
        if (content && (content.includes('critical: true') || content.includes('CRITICAL') || content.includes('MANDATORY'))) {
            return true;
        }
        return false;
    }

    /**
     * Загружает правила из директории
     */
    private static loadRulesFromDirectory(
        dirPath: string,
        isGlobal: boolean,
        loadingMode: 'eager' | 'lazy',
        cache: RulesCache
    ): LoadedRule[] {
        const rules: LoadedRule[] = [];
        const files = this.readRulesDirectory(dirPath);

        for (const filePath of files) {
            const critical = this.isCriticalRule(filePath, null);
            const header = this.createHeader(filePath, isGlobal);

            // Критичные правила всегда загружаются (даже в lazy mode)
            const shouldLoad = loadingMode === 'eager' || critical;

            if (shouldLoad) {
                const content = this.readRuleFile(filePath);
                if (content) {
                    cache.addRule(filePath, content, critical);
                    rules.push({
                        path: filePath,
                        content: content,
                        header: header,
                        critical: critical
                    });
                }
            } else {
                // Lazy loading: добавляем только ссылку
                const relativePath = path.relative(dirPath, filePath);
                const lazyContent = `See ${filePath} for ${path.basename(filePath, path.extname(filePath))} rules.`;
                cache.addRule(filePath, null, critical);
                rules.push({
                    path: filePath,
                    content: lazyContent,
                    header: header,
                    critical: false
                });
            }
        }

        return rules;
    }

    /**
     * Загружает правила из fallback файла (.roorules или .roorules-{mode})
     */
    private static loadRulesFromFallbackFile(
        filePath: string,
        isGlobal: boolean,
        loadingMode: 'eager' | 'lazy',
        cache: RulesCache
    ): LoadedRule | null {
        if (!fs.existsSync(filePath)) {
            return null;
        }

        const critical = this.isCriticalRule(filePath, null);
        const header = this.createHeader(filePath, isGlobal);
        const shouldLoad = loadingMode === 'eager' || critical;

        if (shouldLoad) {
            const content = this.readRuleFile(filePath);
            if (content) {
                cache.addRule(filePath, content, critical);
                return {
                    path: filePath,
                    content: content,
                    header: header,
                    critical: critical
                };
            }
        } else {
            // Lazy loading
            const lazyContent = `See ${filePath} for rules.`;
            cache.addRule(filePath, null, critical);
            return {
                path: filePath,
                content: lazyContent,
                header: header,
                critical: false
            };
        }

        return null;
    }

    /**
     * Загружает все правила согласно приоритету Roo Code
     */
    static async loadRules(options: RulesLoadOptions = {}): Promise<LoadedRule[]> {
        const {
            loadingMode = 'eager',
            modeSlug,
            workspacePath
        } = options;

        const cache = RulesCache.getInstance();
        cache.setLoadingMode(loadingMode);

        const rules: LoadedRule[] = [];
        const workspaceRoot = workspacePath || this.getWorkspaceRoot();
        const globalRulesDir = this.getGlobalRulesDir();

        if (!workspaceRoot) {
            console.warn('[RulesLoader] No workspace root found');
            return rules;
        }

        // 1. Mode-specific rules (workspace) - .roo/rules-{modeSlug}/
        if (modeSlug) {
            const workspaceModeDir = path.join(workspaceRoot, '.roo', `rules-${modeSlug}`);
            const workspaceModeFiles = this.readRulesDirectory(workspaceModeDir);
            
            if (workspaceModeFiles.length > 0) {
                // Директория существует и содержит файлы - используем её
                const modeRules = this.loadRulesFromDirectory(workspaceModeDir, false, loadingMode, cache);
                rules.push(...modeRules);
            } else {
                // Fallback: .roorules-{modeSlug} файл
                const fallbackFile = path.join(workspaceRoot, `.roorules-${modeSlug}`);
                const fallbackRule = this.loadRulesFromFallbackFile(fallbackFile, false, loadingMode, cache);
                if (fallbackRule) {
                    rules.push(fallbackRule);
                }
            }

            // Mode-specific rules (global) - ~/.roo/rules-{modeSlug}/
            const globalModeDir = path.join(globalRulesDir.replace('rules', `rules-${modeSlug}`));
            const globalModeRules = this.loadRulesFromDirectory(globalModeDir, true, loadingMode, cache);
            rules.push(...globalModeRules);
        }

        // 2. Generic rules (workspace) - .roo/rules/
        const workspaceRulesDir = path.join(workspaceRoot, '.roo', 'rules');
        const workspaceRulesFiles = this.readRulesDirectory(workspaceRulesDir);
        
        if (workspaceRulesFiles.length > 0) {
            // Директория существует и содержит файлы - используем её
            const genericRules = this.loadRulesFromDirectory(workspaceRulesDir, false, loadingMode, cache);
            rules.push(...genericRules);
        } else {
            // Fallback: .roorules файл
            const fallbackFile = path.join(workspaceRoot, '.roorules');
            const fallbackRule = this.loadRulesFromFallbackFile(fallbackFile, false, loadingMode, cache);
            if (fallbackRule) {
                rules.push(fallbackRule);
            }
        }

        // 3. Generic rules (global) - ~/.roo/rules/
        const globalGenericRules = this.loadRulesFromDirectory(globalRulesDir, true, loadingMode, cache);
        rules.push(...globalGenericRules);

        return rules;
    }

    /**
     * Форматирует правила для system prompt
     */
    static formatRulesForPrompt(rules: LoadedRule[]): string {
        if (rules.length === 0) {
            return '';
        }

        const sections: string[] = [];
        
        // Группируем по заголовкам
        for (const rule of rules) {
            sections.push(`${rule.header}\n${rule.content}`);
        }

        return sections.join('\n\n');
    }

    /**
     * Разрешает путь к правилу, поддерживая различные форматы:
     * - Абсолютный путь: используется как есть (если файл существует)
     * - Относительный путь от workspace root: `.roo/roo-trace-rules/module.md`
     * - Имя файла: `module.md` → ищется в `.roo/roo-trace-rules/`
     * - Путь с префиксом: `roo-trace-rules/module.md` → разрешается относительно workspace root
     * 
     * БЕЗОПАСНОСТЬ: Разрешает пути ТОЛЬКО внутри директорий .roo/roo-trace-rules/ для предотвращения чтения произвольных файлов workspace.
     * Произвольные относительные пути (например, "src/index.ts") будут отклонены.
     */
    private static resolveRulePath(rulePath: string): string | null {
        // Если путь абсолютный - используем как есть
        if (path.isAbsolute(rulePath)) {
            if (fs.existsSync(rulePath)) {
                return rulePath;
            }
            return null;
        }

        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) {
            return null;
        }

        // Нормализуем путь (убираем лишние слэши, точки)
        const normalizedPath = rulePath.replace(/^\.\//, '').replace(/\/+/g, '/');

        // Вариант 1: Путь уже содержит .roo/roo-trace-rules/
        if (normalizedPath.includes('.roo/roo-trace-rules/') || normalizedPath.includes('roo-trace-rules/')) {
            const fullPath = path.join(workspaceRoot, normalizedPath);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }

        // Вариант 2: Путь начинается с roo-trace-rules/ (без .roo/)
        if (normalizedPath.startsWith('roo-trace-rules/')) {
            const fullPath = path.join(workspaceRoot, '.roo', normalizedPath);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }

        // Вариант 3: Просто имя файла - ищем в .roo/roo-trace-rules/
        const rooTraceRulesPath = path.join(workspaceRoot, '.roo', 'roo-trace-rules', normalizedPath);
        if (fs.existsSync(rooTraceRulesPath)) {
            return rooTraceRulesPath;
        }

        // Вариант 4: Относительный путь от workspace root - ТОЛЬКО если начинается с .roo/roo-trace-rules
        // БЕЗОПАСНОСТЬ: Ограничиваем белым списком директорий .roo/roo-trace-rules для предотвращения чтения произвольных файлов
        if (normalizedPath.startsWith('.roo/roo-trace-rules') || normalizedPath.startsWith('roo-trace-rules/')) {
            const relativePath = path.join(workspaceRoot, normalizedPath);
            if (fs.existsSync(relativePath)) {
                return relativePath;
            }
        }

        // Если ничего не найдено - возвращаем null
        return null;
    }

    /**
     * Загружает конкретное правило по пути (для lazy loading)
     */
    static async loadSpecificRule(rulePath: string): Promise<string | null> {
        const cache = RulesCache.getInstance();
        
        // Разрешаем путь к файлу правила
        const resolvedPath = this.resolveRulePath(rulePath);
        if (!resolvedPath) {
            console.warn(`[RulesLoader] Cannot resolve rule path: ${rulePath}`);
            return null;
        }
        
        // Проверяем кэш по разрешенному пути
        const cached = cache.getRule(resolvedPath);
        if (cached && cached.content) {
            return cached.content;
        }

        // Загружаем из файла
        const content = this.readRuleFile(resolvedPath);
        if (content) {
            await cache.loadRuleContent(resolvedPath, content);
            return content;
        }

        return null;
    }
}
