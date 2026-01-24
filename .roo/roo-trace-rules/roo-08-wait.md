# Phase 5: WAIT (THE ONLY MESSAGE)

- **🚨 CRITICAL:** Proceeding to Phase 5 allowed ONLY if:
  1. ✅ Injections inserted for ALL problems from task (if task specifies 10 problems, injections inserted for all 10)
  2. ✅ Compilation/syntax checked and passed successfully (`BUILD: passed`)
  3. ✅ All files with injections compile without errors
  4. ✅ **Auto-debug check showed that `read_runtime_logs` is blocked (FORBIDDEN)** - user did NOT allow auto-debug
- ❌ **FORBIDDEN:** Proceed to Phase 5 if:
  - Injections not inserted for all problems
  - Compilation not checked or failed
  - Code contains syntax errors
  - **Auto-debug check showed that `read_runtime_logs` is available** - in this case **IMMEDIATELY SKIP Phase 5**, run code via `execute_command`, then proceed to Phase 6, calling `read_runtime_logs` to read logs
- **🚨 CRITICAL: TIMESTAMP FIXATION FOR LOG FILTERING:**
  - **ВАЖНО:** `_run_request_timestamp` должен быть установлен в Phase 1.2 (после вставки проб), а не здесь
  - **ЕСЛИ timestamp еще не установлен:** Установи `_run_request_timestamp = new Date().toISOString()` или `Date.now()`
  - **ЕСЛИ timestamp уже установлен:** Обнови его до текущего времени (если просишь пользователя запустить код снова)
  - **PURPOSE:** This timestamp will be used in Phase 6 (DATA) to filter out OLD logs that existed BEFORE user ran application
  - **FORMAT:** Store as ISO string (e.g., `"2026-01-21T12:30:45.123Z"`) or Unix timestamp (milliseconds)
- **CRITICAL:** This is TEXT ONLY, NO tools!
- ❌ **FORBIDDEN:** Use any tools (update_todo_list, ask_followup_question, show_user_instructions, etc.)
- ❌ **FORBIDDEN:** Use ask_followup_question - it shows countdown timer and buttons
- ❌ **FORBIDDEN:** Show timers, buttons, automatic approval, or any interactive elements
- ❌ **FORBIDDEN:** Read logs in WAIT. This is only triggered by user button (if auto-debug not allowed).
- ✅ **CORRECT:** Write exactly one message: `WAIT: Click "Read logs" when ready.` and stop.
- ❌ **FORBIDDEN:** Think aloud about which tool to use
- ❌ **FORBIDDEN:** Explain why you're waiting or what you're doing
- ✅ **CORRECT:** Just output ONLY this text line: **"Ready. Run the app and trigger the bug. Say 'Logs ready' when done."**
- STOP. Wait for input. DO NOT repeat instructions. DO NOT explain why you're waiting. DO NOT show timers.
