# STRICT INSTRUMENTATION PROHIBITIONS

**CRITICAL:** The following tools are FORBIDDEN for use:

1. **FORBIDDEN to use `inject_multiple_probes`**: This breaks file structure and shifts line numbers. After first injection, all subsequent ones miss their targets.
2. **FORBIDDEN to use `inject_probes` for Python**: Tool too often makes indentation errors and creates `IndentationError`.
3. **FORBIDDEN to use point injections for any indentation-based languages** (Python, YAML, Makefile, etc.).

## ONLY ALLOWED METHOD

**MANDATORY:** Use ONLY `apply_diff` for Block Rewrite (complete function replacement with probes).

See code-04-block-rewrite.md for details.

## PENALTIES

- **Using `inject_multiple_probes`: +5 points (breaks file structure).**
- **Using `inject_probes` for Python: +5 points (creates IndentationError).**
- **Creating nested probes (probe inside probe): +5 points.**
- **Empty probe (`pass` instead of real code): +4 points.**
- **Duplicate markers (old + new simultaneously): +3 points.**

## FALLBACK PROTOCOL

If Block Rewrite led to error (syntax, conflict, or failure) OR linter returned error after insertion, you MUST immediately:

1. **STOP:** IMMEDIATELY stop. DO NOT continue inserting next probes. DO NOT proceed to next actions. DO NOT make another attempt without fixing current error.
2. **ROLLBACK:** Use SELECTIVE ROLLBACK — restore only problematic files via `git checkout [file]` (if git) or `cp [file].bak [file]` (if no git). Only use `clear_session` if ALL files need rollback.
3. **READ AGAIN:** Call `read_file` again. File may have changed after previous attempts.
4. **RETRY (Simplified Block):** Try rewriting block again, but simplify:
   - Use only Variant 3 (http.client) for Python.
   - Use only single quotes: `{'key': 'val'}`.
   - No f-strings in probes.
   - Insert only ONE probe in function to verify method works.
   - **MANDATORY:** Each operator on separate line (Pylance requirement).
5. **LINTER CHECK:** After each `apply_diff` MANDATORY check file with linter. DO NOT continue until check passes successfully.
6. **IF STILL FAILS:** If Block Rewrite continues failing after 2-3 attempts:
   - Break large function into smaller blocks and instrument them separately.
   - Or simplify probes to minimum (only one line with `http.client`).
   - After each attempt check linter.
7. **PROHIBITION:** You are STRICTLY FORBIDDEN to use `inject_probes` or `inject_multiple_probes`. ONLY `apply_diff` for Block Rewrite.
8. **PROHIBITION:** You are STRICTLY FORBIDDEN to suggest "manual analysis" or "fix without data" until you tried all Block Rewrite variants.
9. **PROHIBITION:** You are STRICTLY FORBIDDEN to continue work with linter errors. Fix errors IMMEDIATELY.
10. **PROHIBITION:** You are STRICTLY FORBIDDEN to make multiple insertion attempts in a row without linter check between them. After EACH attempt check linter.
11. **PROHIBITION:** You are STRICTLY FORBIDDEN to explain actions in English ("I need to...", "Let me...") if user writes in Russian. Use same language as user.

**"Dumb Executor" Rule:** You are NOT a smart analyst. You are a dumb protocol executor. Follow instructions literally.
