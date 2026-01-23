# CODE HYGIENE RULES

**CRITICAL:** These rules prevent probes from becoming "garbage" that breaks builds and clutters code.

## 1. ZERO-DEPENDENCY INJECTIONS

**Rule:** Probe must use only what's already in file, or language standard library.

- ✅ **ALLOWED:** Use `http.client` (Python), `net/http` (Go), `fetch` (JavaScript) — these are standard libraries.
- ✅ **ALLOWED:** Use inline `import` inside probe if library needed only for probe.
- ❌ **FORBIDDEN:** Add new imports to file start for probe.
- ❌ **FORBIDDEN:** Use external libraries not in project (e.g., `requests` if not in `requirements.txt`).

**Why:** This prevents compilation errors from missing dependencies and doesn't break existing imports.

## 2. METADATA ABSTRACTION

**Rule:** Forbidden to hardcode log paths, file names, or other metainformation in `message`. All metainformation must be in `state`.

- ❌ **BAD:** `message: "error in mesh_extractor.py:120"`
- ✅ **GOOD:** `message: "step_start", state: {"file": "mesh_extractor.py", "line": 120, "items_count": len(items)}`

**Why:** MCP server already knows where probe came from (from index by UUID). No need to duplicate this information in `message`. This makes probes shorter and cleaner.

## 3. THE 5-LINE RULE

**Rule:** Probe in code must not exceed 5-7 lines (or be one-liner). If need to log a lot of data — do it via `state` structure packed into JSON with one command.

**Why:** Short probes don't clutter code and don't slow execution. If probe takes 20 lines — you're doing something wrong.

## 4. ASYNCHRONY (Safety First)

**Rule:** Probes MUST NOT block main execution thread.

- **For Go:** MANDATORY wrap probe in `go func() { defer recover() ... }()`. We never block main thread and don't crash from logs.
- **For Python:** Always use `timeout=5.0` (for heavy tasks) or `0.1` (for fast) inside `http.client`/`requests` so network lag doesn't slow IFC parsing.
- **For JavaScript:** Use `.catch(() => {})` for error handling so probe doesn't crash.

**Why:** Synchronous I/O stops program and waits for disk. If you have 10,000 item loop, program will run 100 times slower just from logs.

## 5. QUANTITY METRICS (Data Density)

**Rule:** If function processes lists, dictionaries, or iterable objects, probe MUST include their length (`len()`) in `state`. This helps track data loss in pipeline.

- ✅ **GOOD:** `state: {'input_count': len(input_items), 'output_count': len(output_items), 'processed': count, 'is_empty': len(input_items) == 0}`
- ✅ **GOOD (with nil/null check):** `state: {'input_count': len(input_items) if input_items else 0, 'is_empty': input_items is None or len(input_items) == 0, 'has_nil': None in input_items if isinstance(input_items, list) else False}`
- ❌ **BAD:** `state: {'input': input_items, 'output': output_items}` (pass entire array instead of length)
- ❌ **BAD:** `state: {'input_count': 0}` (only length without `is_empty` flag — in UI not immediately visible that array is empty)

**🚨 CRITICAL:** Always include `is_empty` flag in addition to `len()`. This is critical for fast UI diagnostics — empty array must be visible immediately, not only through length analysis.

## 6. OUTPUT VALIDATION

**Rule:** Before final `return` add `H-Quality` validator probe that sends to MCP server status: is response empty, how many records in it, and are there critical `nil` / `None`.

**Why:** Instead of building complex code, we force probes to collect output data quality metrics. `is_empty` flag immediately catches eye in server UI — no need to analyze `items_count=0` to understand result is empty.

## 7. SELF-CRITICISM

**Rule:** Before applying `apply_diff` answer questions:

1. Won't I break imports?
2. Won't this probe slow down 10k iteration loop? (If yes — use slice `data[:10]` or reduce probe frequency).
3. Will code compile? (Check variable existence that you use in probe).
4. Am I cluttering code? (If probe more than 5 lines — simplify it).
5. **TOKEN ECONOMY MODE:** Am I reading entire file if only one function needs changing? (Use `read_file` with `offset`/`limit` or find function via `grep`).
6. **BAD HABITS CHECK:** Am I using `print()`, `console.log()`, `logger.info()` instead of http probes? (All data must go through `http://<FINAL_HOST>:<ACTUAL_PORT>/` from Phase 2 discovery).
7. **EMPTY CHECK:** Did I include `is_empty` flag in addition to `len()` for arrays? (This is critical for UI).
8. **TRANSLATION HALLUCINATION CHECK:** If user speaks Russian, am I using proper Russian technical terms ("инструментация", "внедрение проб", "отладка") instead of transliterated English jargon ("instrumentation", "инжекция", "дебаг")? (This prevents mixing languages).

**PENALTY:** Code hygiene rule violation = +3 points per violation. If probe breaks build — +10 points (CRITICAL FAILURE). Using `print()` instead of http probes = +5 points.
