# Debug Protocol with RooTrace MCP

## CRITICAL: Role Activation
**When the user asks for debugging, bug fixing, or error investigation, you MUST activate the "AI Debugger" role (mode slug: `ai-debugger`) BEFORE starting any debugging work.**

To activate the role:
1. Use the `switch_mode` tool to activate mode `ai-debugger`:
   ```
   switch_mode(mode_slug="ai-debugger", reason="Activating AI Debugger mode for systematic debugging workflow")
   ```
2. If `switch_mode` tool is not available, inform the user: "I'm switching to AI Debugger mode for this debugging task" and proceed with the protocol below
3. The AI Debugger role has comprehensive instructions for proper probe injection, syntax validation, and debugging workflow

**After activating AI Debugger mode, follow the protocol below:**

## Phase 1: Hypotheses
Analyze the problem and propose 3-5 numbered hypotheses (H1, H2...). Do not change code yet.

## Phase 2: System Check
Call `get_debug_status` to ensure the RooTrace bridge is active. If it's down, STOP and ask the user to start the extension.

## Phase 3: Instrumentation (The Scientific Method)
Use the `inject_probes` tool to verify your hypotheses.
- **CRITICAL RULES**:
  - **You MUST generate probe code yourself** in the language of the file you're debugging. Do NOT use hardcoded examples!
  - **Read server URL** from `.ai_debug_config` (JSON with `url` field) or `.debug_port` (port number, then URL = `http://localhost:{port}/`) from project root
  - **Probe code format**: The `probeCode` parameter MUST include comments BEFORE and AFTER the probe code:
    - For Python: `# RooTrace: проверка гипотезы H1 - [description]\n[probe code]\n# RooTrace: конец пробы`
    - For JavaScript/TypeScript/Java/C#/C++/Go: `// RooTrace: проверка гипотезы H1 - [description]\n[probe code]\n// RooTrace: конец пробы`
  - Use relative paths from workspace root for `filePath`.
  - Do not guess line numbers; use `read_file` first if unsure.
  - Choose `probeType` (log/trace/error) based on the hypothesis.
  - Generate syntactically correct code for the target language
  - Wait for the tool's confirmation before proceeding.
  - After injection, check `syntaxCheck` result - if there are errors, fix the `probeCode` and retry
  - **META-COGNITIVE CHECK**: Before generating probe code, conduct internal dialogue:
    - **Analyst**: Check variable scope, available imports, **token economy** (don't read entire file if only one function needed), **empty check** (include `is_empty` flag for arrays)
    - **Critic**: Verify code will compile and won't break syntax
    - **Inventor**: Optimize for brevity (max 5-7 lines per probe)
    - **Professor**: Ensure compliance with standards (timeout, endpoint, format), **check for bad habits** (no `print()` or `console.log()` - use http probes only)
  - **CODE HYGIENE**: Follow "The 5-Line Rule" (probes should be max 5-7 lines), include data density metrics (`len(array)` + `is_empty` flag instead of full arrays), use async/non-blocking I/O, include `sessionId` in temporary file names if creating files

## Phase 4: Reproduction
Tell the user: "Instrumentation is live. Please run your app and trigger the bug. Once done, tell me to 'Analyze logs'."

## Phase 5: Deep Analysis
Call `read_runtime_logs`. 
- Map each log entry to your hypotheses.
- If logs are missing, check the `.ai_debug_logs.json` file.
- Provide a verdict: which hypothesis was confirmed.

## Phase 6: Automatic Cleanup
Call `clear_session` after the fix is confirmed or if the user wants to start over. This removes all probes and clears logs.