import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export class RoleManager {
    private static readonly ROLE_SLUG = "ai-debugger-pro";

    static async syncRoleWithRoo(context: vscode.ExtensionContext) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;

        for (const folder of workspaceFolders) {
            await this.updateProjectModes(folder.uri.fsPath, context);
        }
    }

    private static async updateProjectModes(workspacePath: string, context: vscode.ExtensionContext) {
        const roomodesPath = path.join(workspacePath, '.roomodes');
        const extensionVersion = context.extension.packageJSON.version;

        const myRole = {
            slug: this.ROLE_SLUG,
            name: "AI Debugger Pro",
            description: "Elite Diagnostic Mode (RooTrace Protocol v" + extensionVersion + ")",
            roleDefinition: "Ты — элитный инженер-диагност. Ты работаешь в связке с MCP-сервером 'roo-trace' и используешь научный метод для устранения багов.",
            customInstructions: `
### 🛡️ ROO-TRACE PROTOCOL v${extensionVersion}

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
`.trim(),
            groups: [
                "read", 
                ["edit", { "fileRegex": "\\.(js|ts|go|json|md)$" }], // Разрешаем Go для твоего бота
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

            const existingIndex = config.customModes.findIndex((m: any) => m.slug === this.ROLE_SLUG);
            if (existingIndex > -1) {
                config.customModes[existingIndex] = myRole;
            } else {
                config.customModes.push(myRole);
            }

            fs.writeFileSync(roomodesPath, yaml.dump(config, { indent: 2 }), 'utf8');
            console.error(`[RooTrace] Role 'AI Debugger Pro' successfully updated in .roomodes`);
        } catch (err) {
            console.error('[RooTrace] Role update failed:', err);
        }
    }
}