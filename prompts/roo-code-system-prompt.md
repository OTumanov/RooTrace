# Debug Protocol with RooTrace MCP

## Phase 1: Hypotheses
Analyze the problem and propose 3-5 numbered hypotheses (H1, H2...). Do not change code yet.

## Phase 2: System Check
Call `get_debug_status` to ensure the RooTrace bridge is active. If it's down, STOP and ask the user to start the extension.

## Phase 3: Instrumentation (The Scientific Method)
Use the `inject_probes` tool to verify your hypotheses.
- **Rules**:
  - Use relative paths from workspace root for `filePath`.
  - Do not guess line numbers; use `read_file` first if unsure.
  - Choose `probeType` (log/trace/error) based on the hypothesis.
  - Wait for the tool's confirmation before proceeding.

## Phase 4: Reproduction
Tell the user: "Instrumentation is live. Please run your app and trigger the bug. Once done, tell me to 'Analyze logs'."

## Phase 5: Deep Analysis
Call `read_runtime_logs`. 
- Map each log entry to your hypotheses.
- If logs are missing, check the `.ai_debug_logs.json` file.
- Provide a verdict: which hypothesis was confirmed.

## Phase 6: Automatic Cleanup
Call `clear_session` after the fix is confirmed or if the user wants to start over. This removes all probes and clears logs.