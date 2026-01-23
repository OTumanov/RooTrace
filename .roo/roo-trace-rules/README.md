# Правила для режима AI Debugger

Эта директория содержит модули промпта для режима `ai-debugger`.

## Структура

Модули загружаются **лениво** (lazy loading) по требованию через MCP tool `load_rule`.

**ВАЖНО:** Базовые модули НЕ загружаются автоматически. Агент должен загрузить их при первом запуске или когда они нужны.

## Использование

Для загрузки модуля используйте:
```
load_rule(rulePath="имя-модуля.md")
```

Рекомендуется использовать только имя файла (например, `"00-base-core.md"`), а не полный путь.

## Модули (38 файлов)

### Базовые модули (2 объединенных файла)
- `00-base-core.md` - Core: Language protocol, Output rules (SILENT MODE), Error handling (объединенный)
- `00-base-advanced.md` - Advanced: Penalty system, Format validation, RooTrace Orchestrator role (объединенный)

**Примечание:** Старые модули (`00-base-language.md`, `00-base-output.md`, `00-base-error-handling.md`, `00-base-penalties.md`, `00-formats-validator.md`, `roo-00-role.md`) сохранены для обратной совместимости, но рекомендуется использовать объединенные модули.

### RooTrace модули (14 файлов)
- `roo-00-input-filter.md` - Фильтрация входных данных (Phase 0)
- `roo-00-role.md` - Роль RooTrace (общее описание)
- `roo-01-todo-list.md` - Phase 0.1: TODO list
- `roo-02-delegate-recon.md` - Phase 0.2: Делегирование разведки
- `roo-03-receive-architect.md` - Phase 0.3: Приемка summary от Архитектора
- `roo-04-preflight.md` - Phase 0.4: Pre-Flight Check
- `roo-05-hypotheses.md` - Phase 1: Формулирование гипотез
- `roo-06-network.md` - Phase 2: Обнаружение сети
- `roo-07-smoke-test.md` - Phase 2.2: Smoke Test
- `roo-08-wait.md` - Phase 5: Ожидание пользователя
- `roo-09-read-logs.md` - Phase 6: Чтение логов
- `roo-10-cycle-manage.md` - Phase 7: Управление циклами
- `roo-11-cleanup.md` - Phase 8: Очистка
- `roo-12-manual-prohibition.md` - Запрет ручного анализа
- `roo-13-constraints.md` - Критические ограничения

### Архитектор модули (5 файлов)
- `arch-00-role.md` - Роль Архитектора
- `arch-01-reconnaissance.md` - Phase 0.2: Разведка (формат вывода)
- `arch-02-log-analysis.md` - Phase 7.1: Анализ логов
- `arch-03-format-recon.md` - Формат вывода для разведки
- `arch-04-format-fix.md` - Формат вывода для исправления

### Кодер модули (14 файлов)
- `code-00-role.md` - Роль Кодера
- `code-01-probe-insertion.md` - Phase 2.1: Инъекция проб
- `code-02-code-fix.md` - Phase 7.3: Исправление кода
- `code-03-linter-protocol.md` - Протокол проверки линтера
- `code-04-block-rewrite.md` - Block Rewrite протокол (для Python)
- `code-05-probe-examples.md` - Примеры проб для различных языков
- `code-06-probe-spec.md` - Спецификация проб
- `code-07-code-hygiene.md` - Правила гигиены кода
- `code-08-python-indent.md` - Python индентация
- `code-09-safety.md` - Безопасность (git commit, backup)
- `code-10-rollback.md` - Откат изменений
- `code-11-prohibitions.md` - Запреты для кодера
- `code-12-meta-cognitive.md` - Мета-когнитивное управление
- `code-13-fallback.md` - Fallback стратегии

## Рекомендуемая последовательность загрузки

### При первом запуске (после Phase 0.2):
**ОБЯЗАТЕЛЬНО загрузить РАЗОМ в ОДНОМ сообщении:**
```
load_rule(rulePath="00-base-core.md")
load_rule(rulePath="00-base-advanced.md")
```

**НЕПРАВИЛЬНО:** Загружать модули по одному или в разных сообщениях.

### По мере необходимости:
- Загружайте специализированные модули для текущей фазы (например, `roo-04-preflight.md` для Phase 0.4)
- Загружайте модули кодера при работе с кодом (например, `code-01-probe-insertion.md`)
- Загружайте модули архитектора при анализе (например, `arch-02-log-analysis.md`)

## Примечания

- Все модули используют простые имена MCP инструментов: `load_rule`, `get_problems`, `get_debug_status`, `read_runtime_logs`, `inject_probes`, `clear_session`
- Модули не загружаются автоматически - используйте `load_rule` для загрузки по требованию
- Имена файлов соответствуют их назначению и фазе работы
