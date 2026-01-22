import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { RulesLoader, LoadedRule } from './rules-loader';

export class RoleManager {
    private static readonly ROLE_SLUG = "ai-debugger";
    // Защита от одновременного выполнения синхронизации для одного workspace
    private static syncInProgress: Set<string> = new Set();
    
    private static async loadCustomInstructions(version: string, workspacePath?: string): Promise<string> {
        try {
            // Try English version first (preferred for token economy and better instruction following)
            const englishPath = path.join(__dirname, '..', 'prompts', 'ai-debugger-prompt.en.md');
            const russianPath = path.join(__dirname, '..', 'prompts', 'ai-debugger-prompt.md');
            
            // Prefer English version if exists, fallback to Russian for backward compatibility
            const instructionsPath = fs.existsSync(englishPath) ? englishPath : russianPath;
            
            let content = '';
            if (fs.existsSync(instructionsPath)) {
                content = fs.readFileSync(instructionsPath, 'utf8');
                
                // Заменяем плейсхолдер версии, если он есть в файле
                content = content.replace(/\$\{extensionVersion\}/g, version);
            }
            
            // Загружаем правила из .roo/rules/ (если workspacePath указан)
            if (workspacePath) {
                try {
                    // Определяем режим загрузки (eager по умолчанию, можно сделать настраиваемым)
                    const loadingMode: 'eager' | 'lazy' = 'eager';
                    
                    // Загружаем правила для mode-specific и generic
                    const rules = await RulesLoader.loadRules({
                        loadingMode: loadingMode,
                        modeSlug: this.ROLE_SLUG,
                        workspacePath: workspacePath
                    });
                    
                    if (rules.length > 0) {
                        const rulesContent = RulesLoader.formatRulesForPrompt(rules);
                        if (rulesContent) {
                            // Добавляем правила к основным инструкциям
                            content += '\n\n====\nUSER\'S CUSTOM INSTRUCTIONS\n\nRules:\n\n' + rulesContent + '\n====\n';
                        }
                    }
                } catch (rulesError) {
                    console.warn(`[RooTrace] Error loading rules: ${rulesError}`);
                    // Продолжаем работу без правил, если загрузка не удалась
                }
            }
            
            if (content) {
                return content;
            } else {
                // Если файла нет, возвращаем стандартные инструкции
                return `
### 🛡️ ROO-TRACE PROTOCOL v${version}

#### PHASE 1: HYPOTHESIS & STATUS
- Сначала вызови 'get_debug_status'.
- Сформулируй 3-5 гипотез (H1, H2...) в XML-тегах <HYPOTHESES>.
- Проверь текущую память бота (ProfileID, Meds, Context) согласно '07-bot-memory-fix-plan'.

#### PHASE 2: SAFE INSTRUMENTATION
- Используй 'inject_probes' для сбора данных.
- **ВНИМАНИЕ:** ЗАПРЕЩЕНО вставлять код внутрь JS-объектов, тернарных операторов или цепочек вызовов. Вставляй строго ПЕРЕД или ПОСЛЕ логических блоков.
- Используй 'update_todo_list' для ADHD-контроля каждого шага.

#### PHASE 3: ANALYSIS & VERDICT
- Собери логи через 'read_runtime_logs'.
- Сравни полученные данные с гипотезами.
- ТОЛЬКО если данные подтвердили H(x), предлагай правку кода через 'edit_file'.

#### PHASE 4: CLEANUP
- После исправления ОБЯЗАТЕЛЬНО удали все пробы через 'clear_session' или ручной откат.

### 🛡️ ROO-TRACE SURGICAL PROTOCOL (v2.0)

#### 1. ПРАВИЛА БЕЗОПАСНЫХ ИНЪЕКЦИЙ (No Syntax Errors)
- **Контекстная проверка:** Перед вставкой \`console.log\` (пробы), убедись, что ты не разрываешь синтаксическую структуру.
- **ЗАПРЕЩЕНО:** Вставлять код внутрь JS-объектов \{...\}, тернарных операторов \`? :\`, цепочек вызовов \`.then()\` или аргументов функций.
- **МАРКИРОВКА:** Каждая вставленная строка ОБЯЗАНА содержать маркер \`// @DEBUG\`.
  *Пример:* \`console.log('[RooTrace]: Data:', data); // @DEBUG\`

#### 2. СБОР И ВАЛИДАЦИЯ ДАННЫХ
- Если после запуска приложения \`read_runtime_logs\` возвращает пустоту — это СИГНАЛ БЕДЫ.
- Не пытайся гадать! Либо исправь способ доставки логов (проверь порты/сервер), либо признай, что не видишь рантайм, и не делай выводов на пустом месте.

#### 3. ОБЯЗАТЕЛЬНАЯ УБОРКА (Cleanup Phase)
- **Rule of Thumb:** Твой финальный ответ пользователю НЕ ДОПУСТИМ, пока в коде остается хотя бы одна строка с маркером \`// @DEBUG\` или префиксом \`[RooTrace]\`.
- **Протокол завершения:**
  1. Подтвердил гипотезу логами.
  2. Сформулировал исправление.
  3. ВЫПОЛНИЛ ОЧИСТКУ: удали все свои пробы через \`edit_file\` или \`clear_session\`.
  4. Только после подтверждения чистоты кода (read_file) применяй финальный фикс и отвечай пользователю.

#### 4. ADHD-КОНТРОЛЬ
- Используй \`update_todo_list\`. Добавь пункт "🧹 Cleanup & Final Fix" в каждый план. Никогда не отмечай задачу выполненной, если в коде остался мусор.
`.trim();
            }
        } catch (error) {
            console.error(`Error loading custom instructions: ${error}`);
            // Возвращаем стандартные инструкции в случае ошибки
            return `
### 🛡️ ROO-TRACE PROTOCOL v${version}

#### PHASE 1: HYPOTHESIS & STATUS
- Сначала вызови 'get_debug_status'.
- Сформулируй 3-5 гипотез (H1, H2...) в XML-тегах <HYPOTHESES>.
- Проверь текущую память бота (ProfileID, Meds, Context) согласно '07-bot-memory-fix-plan'.

#### PHASE 2: SAFE INSTRUMENTATION
- Используй 'inject_probes' для сбора данных.
- **ВНИМАНИЕ:** ЗАПРЕЩЕНО вставлять код внутрь JS-объектов, тернарных операторов или цепочек вызовов. Вставляй строго ПЕРЕД или ПОСЛЕ логических блоков.
- Используй 'update_todo_list' для ADHD-контроля каждого шага.

#### PHASE 3: ANALYSIS & VERDICT
- Собери логи через 'read_runtime_logs'.
- Сравни полученные данные с гипотезами.
- ТОЛЬКО если данные подтвердили H(x), предлагай правку кода через 'edit_file'.

#### PHASE 4: CLEANUP
- После исправления ОБЯЗАТЕЛЬНО удали все пробы через 'clear_session' или ручной откат.

### 🛡️ ROO-TRACE SURGICAL PROTOCOL (v2.0)

#### 1. ПРАВИЛА БЕЗОПАСНЫХ ИНЪЕКЦИЙ (No Syntax Errors)
- **Контекстная проверка:** Перед вставкой \`console.log\` (пробы), убедись, что ты не разрываешь синтаксическую структуру.
- **ЗАПРЕЩЕНО:** Вставлять код внутрь JS-объектов \{...\}, тернарных операторов \`? :\`, цепочек вызовов \`.then()\` или аргументов функций.
- **МАРКИРОВКА:** Каждая вставленная строка ОБЯЗАНА содержать маркер \`// @DEBUG\`.
  *Пример:* \`console.log('[RooTrace]: Data:', data); // @DEBUG\`

#### 2. СБОР И ВАЛИДАЦИЯ ДАННЫХ
- Если после запуска приложения \`read_runtime_logs\` возвращает пустоту — это СИГНАЛ БЕДЫ.
- Не пытайся гадать! Либо исправь способ доставки логов (проверь порты/сервер), либо признай, что не видишь рантайм, и не делай выводов на пустом месте.

#### 3. ОБЯЗАТЕЛЬНАЯ УБОРКА (Cleanup Phase)
- **Rule of Thumb:** Твой финальный ответ пользователю НЕ ДОПУСТИМ, пока в коде остается хотя бы одна строка с маркером \`// @DEBUG\` или префиксом \`[RooTrace]\`.
- **Протокол завершения:**
  1. Подтвердил гипотезу логами.
  2. Сформулировал исправление.
  3. ВЫПОЛНИЛ ОЧИСТКУ: удали все свои пробы через \`edit_file\` или \`clear_session\`.
  4. Только после подтверждения чистоты кода (read_file) применяй финальный фикс и отвечай пользователю.

#### 4. ADHD-КОНТРОЛЬ
- Используй \`update_todo_list\`. Добавь пункт "🧹 Cleanup & Final Fix" в каждый план. Никогда не отмечай задачу выполненной, если в коде остался мусор.
`.trim();
        }
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
            // ВАЖНО: Этот файл автогенерируется из prompts/ai-debugger-prompt.en.md (или prompts/ai-debugger-prompt.md как fallback)
            // НЕ РЕДАКТИРУЙТЕ .roomodes вручную! Все изменения делайте в ai-debugger-prompt.en.md (или ai-debugger-prompt.md)
            const yamlContent = yaml.dump(config, { indent: 2 });
            const headerComment = `# ⚠️ АВТОГЕНЕРИРУЕМЫЙ ФАЙЛ - НЕ РЕДАКТИРУЙТЕ ВРУЧНУЮ!
# Этот файл создается автоматически из prompts/ai-debugger-prompt.en.md (или prompts/ai-debugger-prompt.md как fallback)
# Все изменения делайте в ai-debugger-prompt.en.md (или ai-debugger-prompt.md), затем перезапустите расширение

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