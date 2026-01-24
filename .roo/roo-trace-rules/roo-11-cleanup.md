# Phase 8: CLEANUP

- **🚨 CRITICAL: CLEANUP ALLOWED ONLY IF:**
  1. ✅ User EXPLICITLY says "FIXED", "problem solved", "issue resolved", or similar confirmation
  2. ✅ OR all hypotheses are [confirmed] or [rejected] with data (NO [missing] hypotheses)
  3. ✅ OR bug is fixed AND verified through Phase 5-6 cycle (logs show fix worked)
- **FORBIDDEN:** Calling `clear_session` if:
  - Any hypothesis shows `[missing]` without investigation
  - User didn't explicitly confirm fix
  - Fix not verified through logs
  - Missing logs not investigated (missing logs = bug to investigate, not completion signal)
- **CRITICAL:** Cleanup must be atomic and reversible. Use selective cleanup when possible.

## 🚨 ПОВЕДЕНИЕ ПРИ ЯВНОМ ЗАПРОСЕ ОЧИСТКИ

**ЕСЛИ пользователь явно просит очистку до выполнения условий:**

**ОБЯЗАТЕЛЬНЫЙ АЛГОРИТМ:**
1. ⚠️ **WARNING:** "Очистка запрошена до завершения отладки. Это может привести к потере данных."
2. ✅ **Проверь текущее состояние:**
   - Есть ли [missing] гипотезы?
   - Проверено ли исправление через логи?
   - Есть ли несохраненные изменения?
3. ✅ **Спроси подтверждение:** "Вы уверены, что хотите очистить пробы сейчас? (да/нет)"
   - Если "да" → выполнить очистку
   - Если "нет" → отменить запрос, продолжить отладку
4. ✅ **Если подтверждено:** Выполнить очистку согласно протоколу ниже

**ВАЖНО:**
- Уважай выбор пользователя, но предупреди о рисках
- Если есть [missing] гипотезы → предупреди, что они не были проверены
- Если исправление не проверено → предупреди, что результат неизвестен

## CLEANUP PROTOCOL

1. **SELECTIVE CLEANUP (Preferred):**
   - If only specific files need cleanup (e.g., probes in 2 files, but 5 files were modified):
     - Use `clear_session` ONLY if all instrumented files need cleanup
     - Otherwise, manually remove probes from specific files via `read_file` + `apply_diff` (remove probe blocks)
   - **STATUS**: Output: `CLEANUP: [N] files cleaned selectively`

2. **GLOBAL CLEANUP (Fallback):**
   - Tool: `clear_session` (ONLY after user confirmation and ONLY if all files need cleanup)
   - **STATUS**: Output: `CLEANUP: All probes removed via clear_session`

3. **REMOVE PATCH AND BACKUP FILES:**
   - **MANDATORY:** After successful cleanup, remove all `.patch` and `.bak` files created during session:
     - `rm [file].patch` via `execute_command` (for each patch file)
     - `rm [file].bak` via `execute_command` (for each backup file, ONLY if no git repository)
     - **If git repository:** Keep `.bak` files OR remove them (user preference)
   - **PENALTY:** Calling `clear_session` with missing hypothesis logs = +10 points (CRITICAL FAILURE - premature cleanup)
   - **STATUS**: Output: `CLEANUP: Removed [N] patch files, [M] backup files`

**Final Output:** `CLEANUP: Complete.`

**🚨 CRITICAL RULE:** Never remove probes before Phase 8 and user confirmation. Probes are needed for verification even after fix.

**PENALTY:** Calling `clear_session` with missing hypothesis logs = +10 points (CRITICAL FAILURE - premature cleanup)
