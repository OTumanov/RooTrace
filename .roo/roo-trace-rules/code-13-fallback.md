# IF YOU "STUPID" (INSTRUCTION FOR ASSES)

**🚨 FIRST RULE BEFORE ALL:** If you haven't created todo list yet — STOP. Create todo list via `update_todo_list` RIGHT NOW. Without todo list you will ignore protocol.

**CRITICAL:** If you got syntax error or cannot insert probe, follow this algorithm WITHOUT DEVIATIONS:

## 🚨 RULE FOR PYLANCE/PYTHON ERRORS

- If Pylance or py_compile reports syntax error → problem is ALWAYS that **LINE BREAK needed**, NOT semicolons
- ❌ **DO NOT SAY:** "Need to fix Python syntax - use semicolons"
- ❌ **DO NOT SAY:** "Problem is that Pylance expects line break. Will simplify probes"
- ✅ **CORRECT:** Use Block Rewrite (complete function replacement) with probes on SEPARATE lines with correct indentation
- ✅ **SOLUTION:** Each probe operator on separate line, or ENTIRE probe on one line (if using semicolon)

## FALLBACK ALGORITHM

1. **STOP**: Stop trying to fix main project code! 
   - **FORBIDDEN:** Use `apply_diff` for point fixes during Phase 4.
   - **ALLOWED:** Use `apply_diff` ONLY for Block Rewrite (complete function/block replacement with probes) — this is MAIN injection method.

2. **CLEAN**: Use SELECTIVE CLEANUP — remove probes from specific files via `read_file` + `apply_diff` (remove probe blocks). Only use `clear_session` if ALL files need cleanup. This preserves files that weren't problematic.
   - **CRITICAL:** If file still has old markers `# RooTrace` or `// RooTrace` after `clear_session`, remove them manually via `read_file` + `apply_diff` before inserting new probes.

3. **READ**: Call `read_file` again. Your knowledge of line numbers is OUTDATED after previous attempts.
   - **CHECK:** Are there old markers or nested probes in file? If yes — remove them before inserting new ones.

4. **SAFETY CHECK**: If backup not yet created in this session, create it now:
   - `git add . && git commit -m "AI Debugger: Pre-instrumentation backup"` (if this is git repository)
   - Or `cp [file] [file].bak` (if no git)

5. **META-COGNITIVE CHECK BEFORE RETRY:** Before retry conduct internal dialogue:
   - **Analyst:** What variables available? What imports exist?
   - **Critic:** Why did previous attempt fail? Scope? Imports? Syntax?
   - **Inventor:** How to simplify probe to minimum?
   - **Professor:** Does probe comply with standards (5 lines, correct timeout)?

6. **SIMPLEST BLOCK REWRITE**: Try rewriting function/block in most primitive way:
   - Use ONLY **single quotes** inside probes: `data={'key': 'val'}`.
   - No f-strings in `probeCode`. Only clean `json.dumps()`.
   - Use Variant 3 (http.client) — this is vanilla Python, always works.
   - **🚨 CRITICAL:** Each probe operator on separate line with correct indentation (Pylance requirement):
     ```python
     # RooTrace [id: <uuid>] H1: description
     # NOTE: Replace {{FINAL_HOST}} and {{ACTUAL_PORT}} with values from Phase 2 discovery
     try:
         import http.client, json, socket
         conn = http.client.HTTPConnection("{{FINAL_HOST}}", {{ACTUAL_PORT}})
         conn.sock = socket.create_connection(("{{FINAL_HOST}}", {{ACTUAL_PORT}}), timeout=5.0)
         conn.request("POST", "/", json.dumps({'hypothesisId': 'H1', 'message': '...', 'state': {}}), {'Content-Type': 'application/json'})
         conn.getresponse()
         conn.close()
     except: pass
     # RooTrace [id: <uuid>]: end
     ```
   - **CRITICAL:** For IFC/heavy operations/multithreading use `timeout=5.0` (NOT 1.0)
   - **FORBIDDEN:** Use `pass` instead of real code. Probe MUST send data.
   - **FORBIDDEN:** Create nested probes (probe inside probe). Each probe — separate block.
   - Rewrite entire function with this probe inside, preserving all logic.
   - **🚨 MANDATORY:** After `apply_diff` check file with linter (`python3 -m py_compile <file>`; if `python3` unavailable → `python -m py_compile <file>`). DO NOT continue until check passes.

7. **IF STILL FAILS**: If Block Rewrite continues failing after 2-3 attempts:
   - Break large function into smaller blocks and instrument them separately via `apply_diff`.
   - Or simplify probes to minimum (each operator on separate line).
   - **FORBIDDEN:** Use `inject_probes` or `inject_multiple_probes`. ONLY `apply_diff` for Block Rewrite.
   - After each attempt check linter.

8. **ONE BLOCK AT A TIME**: If need to insert multiple probes — do multiple separate `apply_diff` (reading file again via `read_file` and checking linter after each).

**"Dumb Executor" Rule:** You are NOT a smart analyst. You are a dumb protocol executor. Follow instructions literally.
