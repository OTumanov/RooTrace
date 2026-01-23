# PROBE SPEC (Generating probeCode)

## Generating `probeCode`

1. **MANDATORY:** Read file before insertion (`read_file`).
2. **MANDATORY (Python):** 
   - **🚨 CRITICAL FOR PYLANCE:** Probe MUST be on SEPARATE line with correct indentation, NOT on same line with other operators. Pylance requires line break between operators. Each probe operator must be on separate line.
   - Check import presence (`import requests`, `import urllib`, `import json`). 
   - **🚨 IMPORT OPTIMIZATION:** If file already has `import json` at file start, DO NOT import `json` locally inside probe. This makes probe more concise (2-3 lines instead of 5). Use already imported `json` directly.
   - If unsure about imports — use `http.client` (Variant 3) — this is vanilla Python, always available.
   - Use only what's already in file, or standard library.
   - **CRITICAL:** Copy indentation LITERALLY from line before which you insert probe. DO NOT guess indentation. See code-08-python-indent.md.
3. UUID markers mandatory for all probes. ONE UUID per probe, no duplicates.
4. **WORKING CODE MANDATORY:** Probe MUST contain real code for sending data to `http://<FINAL_HOST>:<ACTUAL_PORT>/` (values from Phase 2 discovery). FORBIDDEN to use `pass`, empty `try/except` or stubs. Probe must actually send HTTP POST request.
5. HTTP POST to `http://<FINAL_HOST>:<ACTUAL_PORT>/` (from Phase 2), NOT `print()` or `console.log()`.
   - **🚨 DOCKER SUPPORT:** For Python and Go files, probes automatically use host variables determined once at module/package load:
     - **Python**: variable `_rootrace_host` replaces `localhost` in URL
     - **Go**: variable `rootraceHost` replaces `localhost` in URL
     - System automatically replaces `localhost` with correct host (host.docker.internal in Docker containers, localhost in normal environment). This allows probes to work in both normal applications and Docker containers without manual setup.
6. Data format: `{"hypothesisId": "H1", "message": "...", "state": {"var": value}}`.
   - **🚨 SESSION BINDING:** If environment variable `ROO_TRACE_SESSION_ID` available, include it in `state`: `'sessionId': os.environ.get('ROO_TRACE_SESSION_ID')` (Python) or `os.Getenv("ROO_TRACE_SESSION_ID")` (Go). This prevents debug from different runs mixing.
   - **🚨 USING SESSION_ID IN FILE NAMES:** If agent creates temporary files (logs, dumps, results), it MUST include `ROO_TRACE_SESSION_ID` in file name: `debug_output_{session_id}.json` or `temp_{session_id}.log`. This prevents confusion during parallel tests.
7. **REMOVING OLD MARKERS:** Before inserting new probes, check file for old markers `# RooTrace` or `// RooTrace` and remove them via `clear_session` or manually.

## Python Rules (CRITICAL)

- **🚨 FIRST RULE FOR PYLANCE:** Probe MUST be on SEPARATE lines with correct indentation. Each operator (`import`, `conn =`, `conn.request()`, etc.) must be on separate line. DO NOT use semicolons to combine operators on one line. This is Pylance requirement for correct operation.
- **BEFORE generation:** MANDATORY check via `read_file` what imports exist in file:
  - If has `import requests` or `from requests import` → use Variant 1 (requests.post).
  - If requests NOT available, but has `import urllib` → use Variant 2 (urllib.request).
  - **PREFERRED (if unsure):** Use Variant 3 (http.client) — this is vanilla Python, standard library, requires no installation, works reliably.
  - **🚨 IMPORT OPTIMIZATION:** If file already has `import json` at file start, DO NOT import `json` locally inside probe. Use already imported `json` directly. This makes probe more concise (2-3 import lines instead of 5).
- **DO NOT reinvent wheel:** Use ONLY these three variants. Do not create your own HTTP sending methods.
- **FORBIDDEN to use f-strings in probeCode:** No `f"... {var} ..."` in probe code. Only `json.dumps()` for data formatting.
- **Quotes in JSON:** Use single quotes for keys in Python dictionary: `json.dumps({'hypothesisId': 'H1', 'message': '...', 'state': {}})` — this prevents conflicts with f-strings in surrounding code.
- **Indentation:** Copy indentation LITERALLY from line before which you insert probe. Each probe line must have correct indentation.
- DO NOT add new imports to file start — use inline `import` inside probe.
- **Import check:** If unsure what imports exist — read file again via `read_file`.
