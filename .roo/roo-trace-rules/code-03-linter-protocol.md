# LINTER CHECK PROTOCOL

**MANDATORY:** After EACH code change (probe insertion or fix), you MUST check for errors using diagnostics.

## PREFERRED METHOD: MCP Tool

- Use `get_problems()` for all workspace diagnostics
- Use `get_problems(filePath="path/to/file")` for specific file
- Returns errors and warnings with severity, message, range, source, and code
- This is MORE RELIABLE than manually running linter commands

## FALLBACK METHOD: @problems Mention

- Use `@problems` mention if MCP tool is unavailable
- @problems integrates with VSCode's Problems panel
- Shows all workspace errors and warnings
- Automatically captures diagnostics from language servers, linters, and other diagnostic providers

## MANDATORY WORKFLOW

1. **After EACH change:**
   - Insert probe OR make fix
   - **IMMEDIATELY** check diagnostics (do NOT proceed to next change)

2. **If diagnostics show errors:**
   - ❌ **FORBIDDEN:** Continue inserting next probes or proceed to next actions
   - ❌ **FORBIDDEN:** Ignore errors or postpone their fixing
   - ❌ **FORBIDDEN:** Make another change attempt without fixing current error
   - ❌ **FORBIDDEN:** Make multiple attempts in a row without linter check between them
   - ✅ **MANDATORY:** IMMEDIATELY stop and use SELECTIVE ROLLBACK:
     - Restore ONLY this file: `git checkout [file]` (if git) or `cp [file].bak [file]` (if no git)
     - Mark file as "Dirty" in internal state
     - Retry change ONLY for this file via `apply_diff`
   - ✅ **MANDATORY:** Re-check diagnostics after fixing
   - ✅ **MANDATORY:** Continue with next changes ONLY if current change passed diagnostics check without errors

3. **If diagnostics show no errors:**
   - ✅ Proceed to create .patch file
   - ✅ Proceed to next change (if any)

## OUTPUT

After each check: `LINT: passed` or `LINT: failed - [error description]`

## PENALTIES

- **PENALTY:** Continuing work after linter error or skipping check = +10 points (CRITICAL FAILURE)
- **PENALTY:** Multiple insertion attempts without linter check between them = +10 points (CRITICAL FAILURE)
- **PENALTY:** Making another change attempt without fixing current error = +10 points (CRITICAL FAILURE)

## DO NOT USE

- ❌ Manual linter commands (like `pylint`, `golint`, etc.) - use diagnostics instead
- ❌ Compilation commands as linter check - use diagnostics for real-time feedback
