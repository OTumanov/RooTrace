import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { RulesLoader, LoadedRule } from './rules-loader';
import { ReasoningEnhancer, ReasoningConfig } from './reasoning-enhancer';

export class RoleManager {
    private static readonly ROLE_SLUG = "ai-debugger";
    // Защита от одновременного выполнения синхронизации для одного workspace
    private static syncInProgress: Set<string> = new Set();
    
    private static async loadCustomInstructions(version: string, workspacePath?: string): Promise<string> {
        try {
            // МИНИМАЛЬНЫЙ БАЗОВЫЙ ПРОМПТ - используем lazy loading модулей
            // Вместо большого промпта загружаем только базовые модули и ссылки на остальные
            let content = `# ⚡ AI DEBUGGER: MODULAR MODE (v${version})

## 🧩 LAZY LOADING SYSTEM

**КРИТИЧЕСКИ ВАЖНО:** Ты работаешь в модульной системе. Основные инструкции разбиты на модули в \`.roo/rules-ai-debugger/\`.

**Базовые модули загружены ниже. Для остальных используй \`mcp--roo-trace--load_rule\`:**

- **Phase 0 (Input Filter):** \`roo-00-input-filter.md\`
- **Phase 0.1 (TODO List):** \`roo-01-todo-list.md\`
- **Phase 0.2 (Delegation):** \`roo-02-delegate-recon.md\`
- **Phase 0.3 (Receive Architect):** \`roo-03-receive-architect.md\`
- **Phase 2 (Network Discovery):** \`roo-06-network.md\`
- **Phase 4 (Pre-Flight):** \`roo-04-preflight.md\`
- **Phase 5 (Hypotheses):** \`roo-05-hypotheses.md\`
- **Phase 6 (Read Logs):** \`roo-09-read-logs.md\`
- **Phase 7 (Cycle Management):** \`roo-10-cycle-manage.md\`
- **Phase 8 (Cleanup):** \`roo-11-cleanup.md\`

**Для кодера (при делегировании):** \`code-00-role.md\`, \`code-01-probe-insertion.md\`, и т.д.
**Для архитектора (при делегировании):** \`arch-00-role.md\`, \`arch-01-reconnaissance.md\`, и т.д.

**🛡️ SAFETY FIRST:** Если тебе не хватает знаний для текущей фазы, используй:
\`mcp--roo-trace--load_rule(rulePath="roo-XX-phase-name.md")\`

---

`;

            // Загружаем только базовые модули (eager loading)
            if (workspacePath) {
                try {
                    // Загружаем только критичные базовые модули
                    const baseModules = [
                        '00-base-language.md',
                        '00-base-output.md',
                        '00-base-error-handling.md',
                        'roo-00-role.md',
                        '00-formats-validator.md' // Валидация форматов
                    ];
                    
                    // Загружаем базовые модули напрямую из файлов
                    const rulesDir = path.join(workspacePath, '.roo', 'rules-ai-debugger');
                    for (const moduleName of baseModules) {
                        try {
                            const modulePath = path.join(rulesDir, moduleName);
                            if (fs.existsSync(modulePath)) {
                                const moduleContent = fs.readFileSync(modulePath, 'utf8');
                                if (moduleContent) {
                                    content += `\n\n## === # ${moduleName} ===\n${moduleContent}\n`;
                                }
                            }
                        } catch (moduleError) {
                            console.warn(`[RooTrace] Failed to load base module ${moduleName}: ${moduleError}`);
                        }
                    }
                    
                    // Добавляем информацию о доступных модулях (lazy loading)
                    content += `\n\n## 📚 AVAILABLE MODULES (Load on demand)

Use \`mcp--roo-trace--load_rule(rulePath="module-name.md")\` to load specific modules:

**RooTrace Modules:**
- \`roo-00-input-filter.md\` - Input validation
- \`roo-01-todo-list.md\` - TODO list management
- \`roo-02-delegate-recon.md\` - Delegation to Architect
- \`roo-03-receive-architect.md\` - Receiving Architect summary
- \`roo-04-preflight.md\` - Pre-flight checks
- \`roo-05-hypotheses.md\` - Hypothesis formulation
- \`roo-06-network.md\` - Network discovery (Docker, ports)
- \`roo-07-smoke-test.md\` - Smoke testing
- \`roo-08-wait.md\` - Wait protocols
- \`roo-09-read-logs.md\` - Log reading
- \`roo-10-cycle-manage.md\` - Cycle management
- \`roo-11-cleanup.md\` - Cleanup procedures
- \`roo-12-manual-prohibition.md\` - Manual operation prohibitions
- \`roo-13-constraints.md\` - System constraints

**Coder Modules (for delegation):**
- \`code-00-role.md\` - Coder role definition
- \`code-01-probe-insertion.md\` - Probe insertion rules
- \`code-02-code-fix.md\` - Code fixing rules
- \`code-03-linter-protocol.md\` - Linter integration
- \`code-04-block-rewrite.md\` - Block rewriting
- \`code-05-probe-examples.md\` - Probe examples
- \`code-06-probe-spec.md\` - Probe specifications
- \`code-07-code-hygiene.md\` - Code hygiene
- \`code-08-python-indent.md\` - Python indentation
- \`code-09-safety.md\` - Safety rules
- \`code-10-rollback.md\` - Rollback procedures
- \`code-11-prohibitions.md\` - Prohibitions
- \`code-12-meta-cognitive.md\` - Meta-cognitive checks
- \`code-13-fallback.md\` - Fallback behavior

**Architect Modules (for delegation):**
- \`arch-00-role.md\` - Architect role definition
- \`arch-01-reconnaissance.md\` - Reconnaissance protocol
- \`arch-02-log-analysis.md\` - Log analysis
- \`arch-03-format-recon.md\` - Format reconnaissance
- \`arch-04-format-fix.md\` - Format fixing

**Base Modules:**
- \`00-base-language.md\` - Language protocol (already loaded)
- \`00-base-output.md\` - Output rules (already loaded)
- \`00-base-error-handling.md\` - Error handling (already loaded)
- \`00-base-penalties.md\` - Penalty system
- \`00-formats-validator.md\` - Format validation (already loaded)

`;

                    // Загружаем техники улучшения рассуждений
                    try {
                        const reasoningConfig = await this.loadReasoningConfig(workspacePath);
                        const reasoningPrompt = ReasoningEnhancer.generateReasoningPrompt(reasoningConfig);
                        if (reasoningPrompt) {
                            content += `\n\n${reasoningPrompt}\n\n`;
                        }
                    } catch (reasoningError) {
                        console.warn(`[RooTrace] Error loading reasoning techniques: ${reasoningError}`);
                        // Используем дефолтную конфигурацию (только "Oh!" Hack)
                        const defaultReasoningPrompt = ReasoningEnhancer.generateReasoningPrompt({
                            enabled: true,
                            techniques: { ohHack: true, societyOfThought: false, conflictOfPerspectives: false, expertiseDiversity: false }
                        });
                        if (defaultReasoningPrompt) {
                            content += `\n\n${defaultReasoningPrompt}\n\n`;
                        }
                    }

                    // Загружаем пользовательские правила из .roo/rules/ (если есть)
                    try {
                        const userRules = await RulesLoader.loadRules({
                            loadingMode: 'lazy', // Пользовательские правила тоже lazy
                            modeSlug: this.ROLE_SLUG,
                            workspacePath: workspacePath
                        });
                        
                        // Фильтруем только пользовательские правила (не из rules-ai-debugger)
                        const customRules = userRules.filter(rule => 
                            !rule.path.includes('rules-ai-debugger') &&
                            !rule.path.includes('reasoning-techniques.md') // Исключаем reasoning-techniques.md, он уже обработан
                        );
                        
                        if (customRules.length > 0) {
                            const customRulesContent = RulesLoader.formatRulesForPrompt(customRules);
                            if (customRulesContent) {
                                content += `\n\n====\nUSER'S CUSTOM INSTRUCTIONS\n\nRules:\n\n${customRulesContent}\n====\n`;
                            }
                        }
                    } catch (customRulesError) {
                        console.warn(`[RooTrace] Error loading custom rules: ${customRulesError}`);
                    }
                } catch (rulesError) {
                    console.warn(`[RooTrace] Error loading rules: ${rulesError}`);
                    // Продолжаем работу без правил, если загрузка не удалась
                }
            }
            
            return content;
        } catch (error) {
            console.error(`Error loading custom instructions: ${error}`);
            // Возвращаем минимальный базовый промпт в случае ошибки
            return `# ⚡ AI DEBUGGER: MODULAR MODE (v${version})

## 🧩 LAZY LOADING SYSTEM

**КРИТИЧЕСКИ ВАЖНО:** Ты работаешь в модульной системе. Используй \`mcp--roo-trace--load_rule\` для загрузки модулей из \`.roo/rules-ai-debugger/\`.

**🛡️ SAFETY FIRST:** Если тебе не хватает знаний для текущей фазы, используй:
\`mcp--roo-trace--load_rule(rulePath="roo-XX-phase-name.md")\`
`;
        }
    }

    /**
     * Загружает конфигурацию техник улучшения рассуждений из .roo/rules/reasoning-techniques.md
     */
    private static async loadReasoningConfig(workspacePath: string): Promise<Partial<ReasoningConfig>> {
        const possiblePaths = [
            path.join(workspacePath, '.roo', 'rules', 'reasoning-techniques.md'),
            path.join(workspacePath, '.roo', 'rules-ai-debugger', 'reasoning-techniques.md'),
            path.join(os.homedir(), '.roo', 'rules', 'reasoning-techniques.md')
        ];

        for (const configPath of possiblePaths) {
            if (fs.existsSync(configPath)) {
                try {
                    const content = fs.readFileSync(configPath, 'utf8');
                    
                    // Парсим YAML frontmatter, если есть
                    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
                    if (yamlMatch) {
                        const yamlContent = yamlMatch[1];
                        const parsed = yaml.load(yamlContent) as any;
                        
                        if (parsed.reasoning) {
                            return {
                                enabled: parsed.reasoning.enabled !== false,
                                techniques: {
                                    ohHack: parsed.reasoning.techniques?.ohHack !== false,
                                    societyOfThought: parsed.reasoning.techniques?.societyOfThought === true,
                                    conflictOfPerspectives: parsed.reasoning.techniques?.conflictOfPerspectives === true,
                                    expertiseDiversity: parsed.reasoning.techniques?.expertiseDiversity === true
                                },
                                autoActivate: parsed.reasoning.autoActivate !== false,
                                complexityThreshold: parsed.reasoning.complexityThreshold || 70
                            };
                        }
                    }
                    
                    // Если нет YAML frontmatter, проверяем наличие техник в тексте
                    const config: Partial<ReasoningConfig> = {
                        enabled: true,
                        techniques: {
                            ohHack: true, // По умолчанию включена
                            societyOfThought: /societyOfThought.*true/i.test(content),
                            conflictOfPerspectives: /conflictOfPerspectives.*true/i.test(content),
                            expertiseDiversity: /expertiseDiversity.*true/i.test(content)
                        },
                        autoActivate: !/autoActivate.*false/i.test(content),
                        complexityThreshold: 70
                    };
                    
                    return config;
                } catch (error) {
                    console.warn(`[RooTrace] Error parsing reasoning config from ${configPath}: ${error}`);
                }
            }
        }

        // Дефолтная конфигурация (только "Oh!" Hack)
        return {
            enabled: true,
            techniques: {
                ohHack: true,
                societyOfThought: false,
                conflictOfPerspectives: false,
                expertiseDiversity: false
            },
            autoActivate: true,
            complexityThreshold: 70
        };
    }

    static async syncRoleWithRoo(context: vscode.ExtensionContext) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;

        for (const folder of workspaceFolders) {
            const workspacePath = folder.uri.fsPath;
            
            // Проверяем, не выполняется ли уже синхронизация для этого workspace
            if (this.syncInProgress.has(workspacePath)) {
                console.log(`[RooTrace] Role sync already in progress for ${workspacePath}, skipping`);
                return;
            }
            
            // Помечаем, что синхронизация началась
            this.syncInProgress.add(workspacePath);
            
            try {
                await this.updateProjectModes(workspacePath, context);
            } finally {
                // Удаляем флаг после завершения
                this.syncInProgress.delete(workspacePath);
            }
        }
    }

    private static async updateProjectModes(workspacePath: string, context: vscode.ExtensionContext) {
        // КРИТИЧЕСКИ ВАЖНО: .roomodes должен быть в корне проекта, а не в .rootrace!
        // Roo Code читает .roomodes из корня workspace
        const roomodesPath = path.join(workspacePath, '.roomodes');
        const extensionVersion = context.extension.packageJSON.version;
        
        // КРИТИЧЕСКИ ВАЖНО: Если .roomodes уже существует - УДАЛЯЕМ ЕГО!
        // Мы всегда создаем файл заново с нашей конфигурацией
        if (fs.existsSync(roomodesPath)) {
            console.log(`[RooTrace] .roomodes exists, deleting it before creating new one`);
            fs.unlinkSync(roomodesPath);
        }
        
        const myRole = {
            slug: this.ROLE_SLUG,
            name: "⚡ AI Debugger",
            description: "Elite Diagnostic Mode (RooTrace Protocol v" + extensionVersion + ")",
            roleDefinition: "Ты — элитный инженер-диагност. Ты работаешь в связке с MCP-сервером 'roo-trace' и используешь научный метод для устранения багов. КРИТИЧЕСКИ ВАЖНО: ВСЕГДА используй ТОЛЬКО MCP инструменты с префиксом 'mcp--roo-trace--' (mcp--roo-trace--get_debug_status, mcp--roo-trace--inject_probes, mcp--roo-trace--read_runtime_logs, mcp--roo-trace--clear_session, mcp--roo-trace--load_rule). ЗАПРЕЩЕНО использовать curl, execute_command или HTTP запросы для работы с RooTrace. ЗАПРЕЩЕНО использовать инструменты из других MCP серверов (serena и т.д.). 🛡️ SAFETY FIRST: Если ты чувствуешь, что тебе не хватает конкретных знаний для текущей фазы (например, Probe Insertion или Log Analysis), используй mcp--roo-trace--load_rule для загрузки соответствующего модуля из .roo/rules/.",
            customInstructions: await this.loadCustomInstructions(extensionVersion, workspacePath),
            groups: [
                "read",
                ["edit", { "fileRegex": "\\.(js|ts|py|java|css|html|go|json|md)$" }], // Разрешаем JS, TS, Python, Java, CSS, HTML, Go, JSON, MD
                "browser",
                "command",
                "mcp"
            ]
        };

        try {
            let config: any = { customModes: [] };
            if (fs.existsSync(roomodesPath)) {
                const content = fs.readFileSync(roomodesPath, 'utf8');
                config = yaml.load(content) || { customModes: [] };
            }

            // Убеждаемся, что customModes - это массив
            if (!Array.isArray(config.customModes)) {
                config.customModes = [];
            }

            // Удаляем ВСЕ существующие роли с таким же slug ИЛИ именем (защита от дубликатов)
            // Фильтруем по slug (точное совпадение) и по имени (с эмодзи и без, с разными пробелами)
            const beforeFilter = config.customModes.length;
            config.customModes = config.customModes.filter((m: any) => {
                if (!m || typeof m !== 'object') return true;
                const slug = m.slug;
                const name = m.name;
                
                // Удаляем если slug совпадает (основной критерий)
                if (slug === this.ROLE_SLUG) {
                    console.log(`[RooTrace] Removing duplicate role by slug: ${slug}, name: ${name}`);
                    return false;
                }
                
                // Удаляем если имя совпадает (с эмодзи или без, с разными пробелами)
                if (name && typeof name === 'string') {
                    // Нормализуем имя: убираем эмодзи, лишние пробелы, приводим к нижнему регистру для сравнения
                    const normalizedName = name
                        .replace(/⚡\s*/g, '') // убираем эмодзи молнии
                        .replace(/\s+/g, ' ') // заменяем множественные пробелы на один
                        .trim()
                        .toLowerCase();
                    const expectedNameNormalized = "ai debugger".toLowerCase();
                    
                    // Проверяем точное совпадение нормализованного имени
                    if (normalizedName === expectedNameNormalized) {
                        console.log(`[RooTrace] Removing duplicate role by normalized name: "${name}" (normalized: "${normalizedName}")`);
                        return false;
                    }
                }
                return true;
            });
            const afterFilter = config.customModes.length;
            if (beforeFilter !== afterFilter) {
                console.log(`[RooTrace] Removed ${beforeFilter - afterFilter} duplicate role(s)`);
            }

            // Дополнительная проверка: убеждаемся, что роли с таким slug точно нет
            const existingRoleIndex = config.customModes.findIndex((m: any) => 
                m && typeof m === 'object' && m.slug === this.ROLE_SLUG
            );
            
            if (existingRoleIndex !== -1) {
                console.log(`[RooTrace] Found existing role with slug ${this.ROLE_SLUG} at index ${existingRoleIndex}, replacing it`);
                config.customModes[existingRoleIndex] = myRole;
            } else {
                // Добавляем обновленную роль только если её нет
                console.log(`[RooTrace] No existing role found, adding new role with slug ${this.ROLE_SLUG}`);
                config.customModes.push(myRole);
            }
            
            // Финальная проверка: убеждаемся, что в итоге только одна роль с нашим slug
            const finalRolesWithSlug = config.customModes.filter((m: any) => 
                m && typeof m === 'object' && m.slug === this.ROLE_SLUG
            );
            if (finalRolesWithSlug.length > 1) {
                console.error(`[RooTrace] ERROR: Found ${finalRolesWithSlug.length} roles with slug ${this.ROLE_SLUG}! Removing duplicates...`);
                // Оставляем только последнюю (самую свежую)
                const lastIndex = config.customModes.map((m: any, i: number) => 
                    m && typeof m === 'object' && m.slug === this.ROLE_SLUG ? i : -1
                ).filter((i: number) => i !== -1).pop();
                if (lastIndex !== undefined) {
                    config.customModes = config.customModes.filter((m: any, i: number) => 
                        !(m && typeof m === 'object' && m.slug === this.ROLE_SLUG) || i === lastIndex
                    );
                    console.log(`[RooTrace] Kept only role at index ${lastIndex}, removed ${finalRolesWithSlug.length - 1} duplicate(s)`);
                }
            }

            // Записываем файл атомарно
            // ВАЖНО: Этот файл автогенерируется расширением RooTrace
            // НЕ РЕДАКТИРУЙТЕ .roomodes вручную! Все инструкции загружаются через модульную систему lazy loading
            // Модули находятся в .roo/rules-ai-debugger/ и загружаются по требованию через mcp--roo-trace--load_rule
            const yamlContent = yaml.dump(config, { indent: 2 });
            const headerComment = `# ⚠️ АВТОГЕНЕРИРУЕМЫЙ ФАЙЛ - НЕ РЕДАКТИРУЙТЕ ВРУЧНУЮ!
# Этот файл создается автоматически расширением RooTrace
# Все инструкции загружаются через модульную систему lazy loading из .roo/rules-ai-debugger/
# Модули загружаются по требованию через mcp--roo-trace--load_rule

`;
            fs.writeFileSync(roomodesPath, headerComment + yamlContent, 'utf8');
        const successMsg = `[RooTrace] Role 'AI Debugger' successfully updated in .roomodes`;
        console.log(successMsg);
    } catch (err) {
        const errorMsg = `[RooTrace] Role update failed: ${err}`;
        console.error(errorMsg);
        throw err; // Пробрасываем ошибку для обработки в activate
    }
    }
}