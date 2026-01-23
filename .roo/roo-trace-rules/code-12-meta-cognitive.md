# META-COGNITIVE STEERING

**CRITICAL:** Before each code change (Phase 4) and before final verdict (Phase 6) you MUST conduct internal check via meta-cognitive techniques. This prevents "hallucinations" and compilation errors.

## INTERNAL MONOLOGUE (Chain of Thought)

**Before generating `probeCode` or applying `apply_diff`:**

1. **Scope Check (Variable Visibility):**
   - `<thought>` Checking which variables are available in this context...
   - If using variable in probe — ensure it's declared in this function/block.
   - **FORBIDDEN:** Use variables that don't exist in current scope (e.g., `logPath = os.Getenv(...)` without declaration in Go).
   - If found problem: `<thought> Oh, I messed up — variable `logPath` not declared. Will fix.</thought>`

2. **Import Check:**
   - `<thought>` Checking imports... File has `import requests`? If not — using `http.client`.</thought>`
   - **FORBIDDEN:** Add new imports to file start. Use inline `import` inside probe.
   - If unsure about imports — use Variant 3 (`http.client`) — this is vanilla Python.

3. **Syntax Check:**
   - `<thought>` Checking syntax... Probe doesn't break f-strings? Indentation correct?</thought>`
   - **FORBIDDEN:** Insert probes inside syntactic constructs (f-strings, ternary operators, call chains).
   - If found problem: `<thought> Stop, this probe will break f-string. Need to move it before line.</thought>`

## EXPERT PANEL (Multi-Agent Roleplay)

**Before final code conduct internal dialogue:**

1. **Analyst** (gives dry facts):
   - What data types are used in function?
   - What dependencies needed (requests, urllib, http.client)?
   - What variables available in scope?
   - **🚨 TOKEN ECONOMY MODE:** Is agent trying to read entire file via `read_file` if only one function needs changing? If yes — stop and suggest reading only needed function (use `read_file` with `offset` and `limit` or find function via `grep`).
   - **🚨 EMPTY CHECK:** If array/list processed in function, `state` must include not just `len(array)`, but also `is_empty: true/false` flag and nil/null check. This immediately catches eye in server UI.
   - **🚨 IMPORT OPTIMIZATION:** If file already has `json` library import (e.g., `import json` at file start), DO NOT try to import it locally inside probe. This makes probe more concise (2-3 lines instead of 5). Check imports via `read_file` before generating probe.

2. **Critic** (seeks where code will fail):
   - Checks: won't I break imports?
   - Checks: won't this probe slow down 10k iteration loop? (If yes — use slice `data[:10]` or reduce probe frequency).
   - Checks: will code compile? (Check variable existence that you use in probe).
   - Checks: won't probe break syntactic construct?
   - **🚨 PROBE EFFICIENCY CHECK:** If probe calls expensive operations (e.g., `model.by_type()`, database queries, file I/O) that are already cached or computed elsewhere in function — DO NOT call them again in probe! Use already computed values from function scope. Example: If function builds cache `children_by_parent`, probe should use `len(children_by_parent)` NOT `len(model.by_type("IfcRelAggregates"))`.

3. **Inventor** (optimizes for brevity):
   - Can probe be shorter (one line for fast operations)?
   - Can use lighter variant (http.client instead of requests)?
   - Can reduce `state` size (pass only `len(array)` instead of entire array)?

4. **Professor** (checks compliance with standards):
   - Does probe comply with "The 5-Line Rule" (max 5-7 lines)?
   - Does probe use correct timeout (5.0 for heavy operations, 0.1 for fast)?
   - Does probe send data to correct endpoint (`http://<FINAL_HOST>:<ACTUAL_PORT>/` from Phase 2, or `_rootrace_host` for Docker)?
   - **🚨 BAD HABITS CHECK:** Is agent trying to use `print()`, `console.log()`, `logger.info()` or other standard logs instead of http probes? If yes — stop and remind: all data must go through `http://<FINAL_HOST>:<ACTUAL_PORT>/` (discovered in Phase 2) to preserve log cleanliness and centralized collection.
   - **🚨 TRANSLATION HALLUCINATION CHECK:** When speaking Russian, agent MUST use standard Russian technical terms, NOT transliterated English jargon. Examples: "инструментация" not "instrumentation", "внедрение проб" not "инжекция проб", "отладка" not "дебаг". If agent mixes English terms into Russian sentences (e.g., "Я выполнил instrumentation функции"), stop and correct: use proper Russian terminology.

5. **Architect** (checks architectural decisions - CRITICAL for Phase 7 FIX):
   - **🚨 GLOBAL STATE CHECK:** If proposing global variables, dictionaries, or caches (e.g., `_cache = {}`, `_assembly_graph_cache = {}`):
     - **FORBIDDEN:** Using `id(obj)` as dictionary key without cleanup mechanism (memory leak risk)
     - **FORBIDDEN:** Global caches without TTL (Time-To-Live) or cleanup mechanism
     - **FORBIDDEN:** Global caches without size limits (will grow unbounded)
     - **MANDATORY:** If cache needed, use `weakref.WeakKeyDictionary` (Python) or implement cleanup mechanism (e.g., `cache.clear()` after model unload, LRU cache with maxsize, or context manager)
     - **MANDATORY:** If using `id(obj)` as key, explain collision avoidance strategy (e.g., model ID + version, or explicit cleanup on model close)
     - **MANDATORY:** Consider thread safety if code runs in parallel (use `threading.Lock` or `queue.Queue`)
   - **🚨 MEMORY LEAK CHECK:** If adding caching or global state:
     - Will this grow unbounded? (e.g., cache for every model without cleanup)
     - Will old models stay in memory forever? (need `weakref` or explicit cleanup)
     - Will this cause OOM (Out of Memory) after 100+ operations?
   - **🚨 EFFICIENCY CHECK:** If proposing optimization (e.g., cache):
     - Does probe itself use cached data or calls expensive operations again? (e.g., cache `model.by_type()` but probe calls `model.by_type()` again)
     - If cache exists, probe MUST use cached values, NOT recompute them
   - **🚨 ALTERNATIVE CHECK:** Before proposing global cache, consider:
     - Can this be passed as function parameter instead of global?
     - Can this use `functools.lru_cache` with proper maxsize?
     - Can this use context manager or dependency injection?
     - Is this premature optimization? (measure first, optimize second)

6. **Skeptic** (checks hypotheses based on data):
   - **ONLY after Phase 5 (DATA):** Wait, we see 5 second delay, but are you sure this is `create_shape`, not ThreadPool lock wait?
   - Aren't you stuck on one (incorrect) hypothesis?
   - Are there alternative explanations for log data?

**PENALTY:** Skipping meta-cognitive check before `apply_diff` = +5 points. This is critical for preventing compilation errors.
