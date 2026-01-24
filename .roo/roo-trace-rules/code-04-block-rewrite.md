# Block Rewrite Method (ONLY ALLOWED METHOD)

**🛡️ CRITICAL:** Before using `apply_diff` (Block Rewrite) MANDATORY create backup: if git exists - `git add . && git commit -m "AI Debugger: Pre-instrumentation backup"`, if no git - `cp <file> <file>.bak`. This is a safety requirement for rollback capability.

## 🚨 CRITICAL BACKUP RULE

- **MANDATORY:** Backup MUST be created BEFORE first `apply_diff` to ANY file
- **FORBIDDEN:** Creating backup AFTER injecting probes (backup will contain probes, making patch useless)
- **FORBIDDEN:** Using `git checkout` to "fix" backup - if backup is wrong, you already violated protocol
- **FORBIDDEN:** Creating `.original` files or other backup variants - use ONLY `.bak` or git commit
- **CHECK:** Before first `apply_diff`, verify backup exists: `ls [file].bak` (if no git) or check git log
- **PENALTY:** Creating backup after injection = +10 points (CRITICAL FAILURE)

## METHOD: Complete Function/Block Replacement

For any file (especially Python) instrumentation is performed ONLY through complete replacement of target function/block:

1. **READ**: Read file via `read_file` and find function boundaries (start `def` and end of block).
2. **PREPARE**: Form NEW code of this function, injecting probes into it:
   - Each probe must be at correct indentation level.
   - Each probe MUST be in UUID markers:
     - JS/TS/Go/Java: `// RooTrace [id: <uuid>] Hx: <desc>` ... `// RooTrace [id: <uuid>]: end`
     - Python: `# RooTrace [id: <uuid>] Hx: <desc>` ... `# RooTrace [id: <uuid>]: end`
   - **CRITICAL:** DO NOT change business logic. Only add probes.
   - Preserve all indentation, comments, and function structure.
3. **APPLY**: Use `apply_diff` (SEARCH/REPLACE) to replace old function completely:
   - SEARCH block must contain ORIGINAL function (copy it from file).
   - REPLACE block — your new version with probes.
4. **🚨 CRITICAL: LINTER CHECK + CREATE PATCH AFTER EACH INSERTION**
   - **MANDATORY:** After EACH successful `apply_diff`, you MUST:
     1. Check diagnostics (see code-03-linter-protocol.md)
     2. If diagnostics passed → CREATE `.patch` file immediately (see code-10-rollback.md)
     3. **ЗАПРЕЩЕНО:** Обновлять TODO списки - это делает оркестратор, а не code mode!
5. **Endpoint**: Use discovered `FINAL_HOST` and `ACTUAL_PORT` from Phase 0.5. **FORBIDDEN** to hardcode `localhost:51234`.

## ⚖️ CLEAN REPLACEMENT RULE (SINGLE BLOCK RULE)

**CRITICAL:** Follow these rules WITHOUT EXCEPTIONS:

1. **ONE REPLACEMENT:** If you're instrumenting a function — you REPLACE it completely via `apply_diff`. DO NOT add probes on top of existing ones.
2. **NESTING PROHIBITION:** Inside function FORBIDDEN to create nested probes (probe inside probe). Each probe is a separate block at one level.
3. **WORKING CODE:** Inside probe MUST be working code for data sending (`http.client` or `requests.post` for Python, `http.NewRequest` for Go), NOT `pass` or empty `try/except`. Probe must actually send data to `http://<FINAL_HOST>:<ACTUAL_PORT>/` (values from Phase 2 discovery).
4. **REMOVING OLD MARKERS:** If code ALREADY has old markers `# RooTrace` or `// RooTrace` — REMOVE them before inserting new ones. File must not have duplicates or mixed markers.
5. **ONE UUID PER PROBE:** Each probe must have ONE unique UUID. DO NOT create short markers (`7nvg`) and long UUIDs (`123e456...`) simultaneously.
6. **THE 5-LINE RULE:** Probe must not exceed 5-7 lines. If you need to log a lot — use `state` with metrics (`len(array)` instead of entire array).
7. **QUANTITY METRICS:** If function processes lists/dictionaries — include their length in `state`: `'items_count': len(items)`.

## Advantages

- If `apply_diff` passed — syntax is guaranteed not to break.
- Your MCP `clear_session` easily finds markers and cleans them, preserving function structure.
- Excludes `IndentationError` (you see entire indentation hierarchy).
- Guarantees probe doesn't break syntactic constructs (e.g., f-strings or decorators).

## 🚨 BEFORE APPLYING `apply_diff`

Conduct meta-cognitive check (see code-12-meta-cognitive.md):
- Check variable scope (Analyst)
- Check imports (Critic)
- Check syntax (Critic)
- Optimize for brevity (Inventor)
- Check compliance with standards (Professor)

**PENALTY:** Skipping meta-cognitive check before `apply_diff` = +5 points
