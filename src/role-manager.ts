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
            // МИНИМАЛЬНЫЙ БАЗОВЫЙ ПРОМПТ - используем ПОЛНОСТЬЮ ленивую загрузку модулей
            // ВСЕ модули (включая базовые) загружаются по требованию через load_rule
            let content = `# ⚡ AI DEBUGGER: MODULAR MODE (v${version})

## 🚨🚨🚨 КРИТИЧЕСКИ ВАЖНО: ЗАТКНИ ЕБАЛЬНИК И ДЕЛАЙ! 🚨🚨🚨

**ЗАПРЕЩЕНО:**
- ❌ Любые рассуждения, объяснения, анализ перед действием
- ❌ "Я буду действовать...", "Теперь я вижу...", "Теперь я должен...", "Я вижу, что..." - ЗАТКНИ ЕБАЛЬНИК И ДЕЛАЙ!
- ❌ "Давайте...", "Сначала...", "Теперь...", "Мне нужно...", "Я вижу...", "Я заметил..." - сразу вызывай инструменты!
- ❌ Текстовые блоки длиннее 1 строки перед вызовом инструмента
- ❌ Описание того, что ты видишь или понимаешь - просто вызывай инструменты!

**РАЗРЕШЕНО:**
- ✅ Только вызов инструментов БЕЗ объяснений
- ✅ Краткие статусы (1 строка максимум): \`STATUS: active\`, \`DATA: 5 logs\`
- ✅ Ошибки в формате: \`ERROR: [type]. REASON: [brief]\`

**ШТРАФ:** Рассуждения и объяснения перед действием = +30 points (CRITICAL FAILURE)
**ШТРАФ:** Фразы "Я буду...", "Теперь я...", "Я вижу..." = +25 points (CRITICAL FAILURE)

## 🧩 LAZY LOADING SYSTEM

**КРИТИЧЕСКИ ВАЖНО:** Ты работаешь в модульной системе с ПОЛНОСТЬЮ ленивой загрузкой. ВСЕ инструкции разбиты на модули в \`.roo/roo-trace-rules/\` и загружаются по требованию.

**🚨 ВАЖНО:** Базовые модули (language, output, error-handling, role, validator) НЕ загружены в этот system prompt. Ты ДОЛЖЕН загрузить их через \`load_rule\` при первом запуске или когда они нужны.

## 🔧 КАК ВЫЗЫВАТЬ ИНСТРУМЕНТЫ

**КРИТИЧЕСКИ ВАЖНО:** Есть ДВА типа инструментов:

### 1. ВСТРОЕННЫЕ инструменты Roo Code (вызываются НАПРЯМУЮ):
- ✅ \`update_todo_list(todos="...")\` - создание/обновление TODO списка
- ✅ \`new_task(mode="...", message="...")\` - создание подзадачи
- ✅ \`attempt_completion()\` - завершение подзадачи
- ✅ \`read_file(path="...")\` - чтение файлов
- ✅ \`codebase_search(query="...")\` - семантический поиск кода
- ✅ И другие встроенные инструменты Roo Code

### 2. MCP инструменты RooTrace (вызываются НАПРЯМУЮ):

**🚨🚨🚨 КРИТИЧЕСКИ ВАЖНО: Инструменты RooTrace вызываются НАПРЯМУЮ, БЕЗ использования \`use_mcp_tool\`! 🚨🚨🚨**

**Правильный формат вызова:**
- ✅ **ПРАВИЛЬНО:** Вызывай инструмент напрямую:
  \`\`\`
  load_rule(rulePath="00-base-core.md")
  \`\`\`
- ❌ **НЕПРАВИЛЬНО:** НЕ используй \`use_mcp_tool\` для инструментов RooTrace

**Доступные MCP инструменты RooTrace (вызываются НАПРЯМУЮ):**
- \`load_rule(rulePath="имя-модуля.md")\` - Загрузка модуля правил
- \`get_debug_status()\` - Статус отладки
- \`read_runtime_logs()\` - Чтение логов (требует одобрения пользователя)
- \`inject_probes(...)\` - Инъекция проб
- \`clear_session()\` - Очистка сессии
- \`get_problems(filePath?)\` - Диагностики VS Code

**Для загрузки модулей используй:**
\`load_rule(rulePath="имя-модуля.md")\`

**Рекомендуется использовать только имя файла** (например, \`"00-base-core.md"\`), а не полный путь.

**🛡️ SAFETY FIRST:** Если тебе не хватает знаний для текущей фазы, используй:
\`load_rule(rulePath="roo-XX-phase-name.md")\`

---

## 🚨🚨🚨 КРИТИЧЕСКИ ВАЖНЫЙ ПРОТОКОЛ ЗАПУСКА 🚨🚨🚨

**АБСОЛЮТНО ОБЯЗАТЕЛЬНЫЙ ПОРЯДОК ДЕЙСТВИЙ (НЕ МЕНЯТЬ!):**

1. **Phase 0 (ПЕРВОЕ ДЕЙСТВИЕ):** Загрузи входной фильтр для оценки данных:
   - **СКОПИРУЙ:** \`load_rule(rulePath="roo-00-input-filter.md")\`
   - Оцени достаточность данных (если недостаточно → используй \`ask_followup_question\`, макс 3 вопроса)

2. **Phase 0.1 (ВТОРОЕ ДЕЙСТВИЕ):** **ПЕРВЫЙ вызов инструмента ДОЛЖЕН быть \`update_todo_list\`**
   - **ВАЖНО:** \`update_todo_list\` - это ВСТРОЕННЫЙ инструмент Roo Code, вызывай его НАПРЯМУЮ!
   - **СКОПИРУЙ:** \`load_rule(rulePath="roo-01-todo-list.md")\` для загрузки инструкций по TODO list
   - **ПОТОМ:** Вызови \`update_todo_list(todos="...")\` напрямую (это встроенный инструмент Roo Code)
   - **ЗАПРЕЩЕНО:** Вызывать \`get_debug_status\`, \`read_file\`, анализировать код ДО \`update_todo_list\`
   - **ЗАПРЕЩЕНО:** Любые другие инструменты ДО \`update_todo_list\`

3. **Phase 2 (ТРЕТЬЕ ДЕЙСТВИЕ):** **🚨🚨🚨 КРИТИЧЕСКИ ВАЖНО: ОБНАРУЖЬ СЕТЬ ДО ВСТАВКИ ПРОБ! 🚨🚨🚨**
   - **СКОПИРУЙ:** \`load_rule(rulePath="roo-06-network.md")\`
   - Определи FINAL_HOST и ACTUAL_PORT (51234 по умолчанию)
   - Проверь Docker окружение (если есть)
   - **КРИТИЧЕСКИ ВАЖНО:** Это ДОЛЖНО быть выполнено ДО вставки проб, чтобы знать куда отправлять логи!

4. **Phase 2.2 (ЧЕТВЕРТОЕ ДЕЙСТВИЕ):** Выполни smoke test для проверки соединения с сервером
   - **СКОПИРУЙ:** \`load_rule(rulePath="roo-07-smoke-test.md")\`
   - **КРИТИЧЕСКИ ВАЖНО:** Smoke test ДОЛЖЕН быть выполнен ДО вставки проб!

5. **Phase 0.2 (ПЯТОЕ ДЕЙСТВИЕ):** Делегируй разведку архитектору:
   - **СКОПИРУЙ:** \`load_rule(rulePath="roo-02-delegate-recon.md")\`
   - **ЗАПРЕЩЕНО:** Делать разведку самому (читать код, анализировать файлы) - это делает архитектор!
   - **ОБЯЗАТЕЛЬНО:** Используй \`new_task(mode="architect", message="...")\` для делегирования

**🚨 КРИТИЧЕСКИ ВАЖНО:** Ты НЕ делаешь разведку сам. Ты делегируешь архитектору через \`new_task(mode="architect")\`.

**ШТРАФ:** Выполнение разведки напрямую вместо делегирования = +15 баллов (CRITICAL FAILURE)  
**ШТРАФ:** Пропуск Phase 0.2 (делегирование разведки) = +20 баллов (CRITICAL FAILURE)

---

## 📚 МОДУЛИ И ИНСТРУМЕНТЫ

**ВАЖНО:** 
- MCP инструменты RooTrace вызываются НАПРЯМУЮ: \`load_rule(rulePath="имя-модуля.md")\`
- Параметр: \`rulePath\` (строка с именем файла)

---

`;

            // Базовые модули НЕ загружаются eagerly - они загружаются по требованию через load_rule
            // См. секцию "AVAILABLE MODULES" ниже для списка всех модулей
            if (workspacePath) {
                try {
                    // Добавляем информацию о доступных модулях (lazy loading)
                    content += `\n\n## 📚 AVAILABLE MODULES (Load on demand)

Use \`load_rule(rulePath="module-name.md")\` to load specific modules:

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

**Reference Modules:**
- \`README.md\` - Обзор всех модулей и их назначения

**Base Modules (Load on demand - recommended to load at startup):**
- \`00-base-core.md\` - Core: Language protocol, Output rules (SILENT MODE), Error handling (объединенный модуль)
- \`00-base-advanced.md\` - Advanced: Penalty system, Format validation, RooTrace Orchestrator role (объединенный модуль)

**🛡️ STARTUP PROTOCOL:** При первом запуске сессии рекомендуется загрузить базовые модули.

**🚨 КРИТИЧЕСКИ ВАЖНО:** НЕ загружай базовые модули ДО выполнения Phase 0-0.2 протокола (входной фильтр → update_todo_list → делегирование архитектору).

**🚨 ОБЯЗАТЕЛЬНО:** Загружай ВСЕ базовые модули РАЗОМ в ОДНОМ сообщении (параллельно), а не по одному!

**ПРАВИЛЬНО (загрузить все разом после Phase 0.2):**
\`\`\`
load_rule(rulePath="00-base-core.md")
load_rule(rulePath="00-base-advanced.md")
\`\`\`

**НЕПРАВИЛЬНО (загружать по одному):**
- ❌ НЕ вызывай \`load_rule\` для каждого модуля отдельно в разных сообщениях
- ❌ НЕ загружай модули последовательно в разных сообщениях
- ❌ НЕ обсуждай загрузку модулей - просто загрузи их все разом

**Базовые модули (объединены для уменьшения количества вызовов):**
- \`00-base-core.md\` - Core: Language protocol, Output rules (SILENT MODE), Error handling
- \`00-base-advanced.md\` - Advanced: Penalty system, Format validation, RooTrace Orchestrator role

**ВАЖНО:** Имя инструмента простое: \`load_rule\` (как у остальных инструментов: get_debug_status, read_runtime_logs и т.д.)

Эти модули содержат критически важные инструкции, которые должны быть загружены для корректной работы.

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
                    // КРИТИЧЕСКИ ВАЖНО: НЕ загружаем правила из .roo/roo-trace-rules/ - они загружаются лениво через load_rule
                    try {
                        const userRules = await RulesLoader.loadRules({
                            loadingMode: 'lazy', // Пользовательские правила тоже lazy
                            modeSlug: undefined, // НЕ загружаем mode-specific правила (roo-trace-rules) - они ленивые
                            workspacePath: workspacePath
                        });
                        
                        // Фильтруем только пользовательские правила (не из roo-trace-rules)
                        const customRules = userRules.filter(rule => 
                            !rule.path.includes('roo-trace-rules') &&
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

**КРИТИЧЕСКИ ВАЖНО:** Ты работаешь в модульной системе с ПОЛНОСТЬЮ ленивой загрузкой. ВСЕ инструкции разбиты на модули в \`.roo/roo-trace-rules/\` и загружаются по требованию.

**🚨 ВАЖНО:** Базовые модули (language, output, error-handling, role, validator) НЕ загружены в этот system prompt. Ты ДОЛЖЕН загрузить их через \`load_rule\` при первом запуске или когда они нужны. **ОБЯЗАТЕЛЬНО загружай ВСЕ базовые модули РАЗОМ в ОДНОМ сообщении, а не по одному!**

**Для загрузки модулей используй:**
\`load_rule(rulePath="имя-модуля.md")\`

**Рекомендуется использовать только имя файла** (например, \`"00-base-core.md"\`), а не полный путь.

**🛡️ SAFETY FIRST:** Если тебе не хватает знаний для текущей фазы, используй:
\`load_rule(rulePath="roo-XX-phase-name.md")\`

---

## 📚 HELP: Операции и инструменты

**🚨 START HERE:** При первом запуске сессии рекомендуется загрузить базовые модули для корректной работы (см. STARTUP PROTOCOL ниже)
`;
        }
    }

    /**
     * Загружает конфигурацию техник улучшения рассуждений из .roo/rules/reasoning-techniques.md
     */
    private static async loadReasoningConfig(workspacePath: string): Promise<Partial<ReasoningConfig>> {
        const possiblePaths = [
            path.join(workspacePath, '.roo', 'rules', 'reasoning-techniques.md'),
            path.join(workspacePath, '.roo', 'roo-trace-rules', 'reasoning-techniques.md'),
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
            roleDefinition: "Ты — элитный инженер-диагност. Ты работаешь в связке с MCP-сервером 'roo-trace' и используешь научный метод для устранения багов. 🔧 ВАЖНО: Есть ДВА типа инструментов - 1) ВСТРОЕННЫЕ инструменты Roo Code (update_todo_list, new_task, attempt_completion, read_file, codebase_search и др.) - вызываются НАПРЯМУЮ, 2) MCP инструменты RooTrace (get_debug_status, inject_probes, read_runtime_logs, clear_session, load_rule, get_problems) - вызываются НАПРЯМУЮ, БЕЗ use_mcp_tool. ЗАПРЕЩЕНО использовать curl, execute_command или HTTP запросы для работы с RooTrace. ЗАПРЕЩЕНО использовать инструменты из других MCP серверов (serena и т.д.). 🚨🚨🚨 КРИТИЧЕСКИ ВАЖНЫЙ ПРОТОКОЛ: 1) Phase 0: load_rule(rulePath=\"roo-00-input-filter.md\") для оценки данных, 2) Phase 0.1: ПЕРВЫЙ вызов инструмента ДОЛЖЕН быть update_todo_list (это ВСТРОЕННЫЙ инструмент Roo Code, вызывай напрямую!), 3) Phase 0.2: Делегируй разведку архитектору через new_task(mode=\"architect\") - ЗАПРЕЩЕНО делать разведку самому! 🛡️ SAFETY FIRST: Если тебе не хватает конкретных знаний для текущей фазы (например, Probe Insertion или Log Analysis), используй load_rule для загрузки соответствующего модуля из .roo/roo-trace-rules/.",
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
            // Модули находятся в .roo/roo-trace-rules/ и загружаются по требованию через load_rule
            const yamlContent = yaml.dump(config, { indent: 2 });
            const headerComment = `# ⚠️ АВТОГЕНЕРИРУЕМЫЙ ФАЙЛ - НЕ РЕДАКТИРУЙТЕ ВРУЧНУЮ!
# Этот файл создается автоматически расширением RooTrace
# Все инструкции загружаются через модульную систему lazy loading из .roo/roo-trace-rules/
# Модули загружаются по требованию через load_rule

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