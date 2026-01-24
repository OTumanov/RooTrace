# Phase 7.3: CODE FIX (Coder Instructions)

**Fix code according to architect solution.**

## CONTEXT

You receive:
- Problem: [PROBLEM from architect summary]
- Solution: [SOLUTION from architect summary]
- File: [FILE from architect summary]
- Line: [LINE from architect summary]
- Change: [CHANGE from architect summary]

## TASK

1. Read file
2. Make fix at specified location
3. **MANDATORY:** Check diagnostics after fix:
   - **PREFERRED:** Use `get_problems(filePath="path/to/file")` to check for errors in fixed file
   - **FALLBACK:** Use `@problems` mention if MCP tool unavailable
   - If errors found → fix them immediately, then check again
   - Only proceed when diagnostics show no errors
4. Create .patch file
5. **CRITICAL:** Do NOT remove existing probes (they're still needed for verification)

## MANDATORY STEPS

1. **Read file** via `read_file` to see current state
2. **Make fix** using `apply_diff` at specified location
3. **Check diagnostics** - see code-03-linter-protocol.md
4. **Create .patch file** - see code-10-rollback.md
5. **Verify probes still present** - do NOT remove them

## 🚨 CRITICAL: PROBE PRESERVATION

- **FORBIDDEN:** Removing probes during fix
- **FORBIDDEN:** Removing probes before Phase 8 and user confirmation
- **MANDATORY:** Probes are needed for verification even after fix
- **MANDATORY:** Only remove probes in Phase 8 (cleanup) after user confirmation

## 🚨 ПОВЕДЕНИЕ ПРИ КОНФЛИКТЕ ПРОБ И ИСПРАВЛЕНИЯ

**ЕСЛИ проба находится на строке, которую нужно изменить:**

**ОБЯЗАТЕЛЬНЫЙ АЛГОРИТМ:**
1. ✅ **Временно удали пробу** (сохрани ее код в переменной)
2. ✅ **Внеси исправление** в код
3. ✅ **Вставь пробу обратно** (или новую, если старая не подходит после исправления)
4. ✅ **Проверь диагностику** после всех изменений
5. ✅ **Создай .patch файл** только после успешной проверки

**ВАЖНО:**
- Пробы должны остаться в файле после исправления (если не указано иное)
- Если проба больше не релевантна после исправления → можно вставить новую пробу для проверки исправления
- НЕ удаляй пробы без явного указания пользователя

**ПРИМЕР:**
```python
# Было:
def process_data(data):
    # RooTrace [id: UUID] H1: проверяем data
    if data is None:
        return None
    # RooTrace [id: UUID]: end
    return data.process()

# Нужно исправить: добавить валидацию
# Алгоритм:
# 1. Сохрани код пробы
# 2. Удали пробу временно
# 3. Внеси исправление
# 4. Вставь пробу обратно (или новую)
```

## ON COMPLETION

- Use attempt_completion with result parameter
- In result specify:
  * FILE: [path]
  * CHANGED: [what changed]
  * DIAGNOSTICS: [check result - OK/ERRORS/WARNINGS with count]
  * PATCH: [path to .patch file]

Report via attempt_completion and RETURN.
