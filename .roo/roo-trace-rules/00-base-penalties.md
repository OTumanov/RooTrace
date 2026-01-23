# PENALTY SYSTEM (INTERNAL LOGIC)

For each protocol violation, penalty points (Internal Penalty Tokens) are accrued.
Exceeding the limit of 10 points leads to degradation of response weights.

## General Violations
- "Silent Mode" violation (excessive text, action explanations): +5 points. Examples: "Need to fix...", "Will fix probes...", "First updating...", "Reading file...", "Now adding probe...", "Finding function...", "Adding probe to measure...", "Problem is...", "Simplifying probes...", "I must use tool...", "Trying to use...", "Seems system requires...", ANY explanations before/after actions, ANY thinking aloud about tool choice
- Attempting manual analysis instead of injection: +5 points.
- Skipping cleanup phase (Phase 7): +4 points.
- Using third-party libraries (not from Spec list): +3 points.
- Proceeding to fix without log data: +5 points.

## Probe-Related Violations
- **Using `inject_multiple_probes`: +5 points (breaks file structure).**
- **Using `inject_probes` for Python: +5 points (creates IndentationError).**
- **Creating nested probes (probe inside probe): +5 points.**
- **Empty probe (`pass` instead of real code): +4 points.**
- **Duplicate markers (old + new simultaneously): +3 points.**
- **Creating probe in loop >100 iterations without sampling: +10 points (CRITICAL FAILURE - log spam risk).**

## CRITICAL FAILURES (+10 points or more)
- **🚨 CRITICAL FAILURE: Issuing verdict/analysis without reading logs from file (Phase 6): +10 points (CRITICAL FAILURE). This violates "Iron Bridge" - the only source of truth.**
- **🚨 CRITICAL FAILURE: Continuing debugging without checking `serverTestResult` or when `serverStatus === "error"`: +10 points (CRITICAL FAILURE). Server must pass write/read test before starting work.**
- **🚨 CRITICAL FAILURE: Starting work without creating todo list (Phase 0): +10 points (CRITICAL FAILURE). Todo list is mandatory to prevent protocol ignoring.**
- **🚨 CRITICAL FAILURE: Claiming "probes injected/removed", "code fixed", "after analyzing logs I see..." without tool confirmation: +10 points (CRITICAL FAILURE).**
  - Allowed to claim "changes made" ONLY if you actually did `apply_diff`/`edit_file`/`inject_probes` (for non-Python) in this session.
  - Allowed to claim "after analyzing logs" ONLY if you actually read logs from file (or MCP fallback) and cite DATA counter/key fields.
- **🚨 CRITICAL FAILURE: Proceeding to Phase 4 (WAIT) without compilation check or with compilation errors: +10 points (CRITICAL FAILURE).**
- **🚨 CRITICAL FAILURE: Proceeding to Phase 4 (WAIT) without injecting for all problems from task: +10 points (CRITICAL FAILURE).**
- **🚨 CRITICAL FAILURE: Continuing work after linter error or skipping linter check after probe insertion: +10 points (CRITICAL FAILURE).**
- **🚨 CRITICAL FAILURE: Multiple insertion attempts in a row without linter check between them: +10 points (CRITICAL FAILURE).**
- **🚨 CRITICAL FAILURE: Language switching in response (especially to English when user writes in Russian): +10 points (CRITICAL FAILURE).**
- **🚨 CRITICAL FAILURE: Explaining actions in English ("I need to...", "Let me...") when user writes in Russian: +10 points (CRITICAL FAILURE).**
- **🚨 CRITICAL FAILURE: Proposing global cache with `id(obj)` as key without cleanup mechanism (memory leak): +10 points (CRITICAL FAILURE).**
- **🚨 CRITICAL FAILURE: Probe calling expensive operations that are already cached in function (inefficiency): +5 points.**
- **🚨 CRITICAL FAILURE: Analyzing logs with timestamps BEFORE run request timestamp (analyzing stale data): +10 points (CRITICAL FAILURE).**
- **🚨 CRITICAL FAILURE: Ignoring timestamp field and analyzing all logs regardless of time (mixing old and new data): +10 points (CRITICAL FAILURE).**
- **🚨 CRITICAL FAILURE: Marking milestone task complete without justification: +10 points (CRITICAL FAILURE).**
- **🚨 CRITICAL FAILURE: Skipping input filter (Phase 0) and continue without data assessment: +10 points (CRITICAL FAILURE)**
- **🚨 CRITICAL FAILURE: Delegating Pre-Flight Check instead of doing it yourself: +15 points (CRITICAL FAILURE)**
- **🚨 CRITICAL FAILURE: Skipping Pre-Flight Check: +20 points (CRITICAL FAILURE)**
- **🚨 CRITICAL FAILURE: Skipping MCP tools check in Pre-Flight Check: +5 points**
- **🚨 CRITICAL FAILURE: Delegating log reading instead of reading yourself: +15 points (CRITICAL FAILURE)**
- **🚨 CRITICAL FAILURE: Using MCP read_runtime_logs when file is available: +5 points**
- **🚨 CRITICAL FAILURE: Skipping history transfer in Phase 7.1: +15 points (CRITICAL FAILURE)**
- **🚨 CRITICAL FAILURE: Continuing cycle without checking solution uniqueness from architect: +10 points (CRITICAL FAILURE)**
- **🚨 CRITICAL FAILURE: Interrupting debugging cycle without solving problem: +10 points**

## Phase 7 Milestone Violations
- **🚨 CRITICAL FAILURE: Skipping any mandatory milestone task name ([ARCHITECT], [QA], [SRE], [IMPLEMENT], [CRITIC]) in Phase 7 FIX: +20 points (CRITICAL FAILURE).**

## Strategy Violations
- **🚨 CRITICAL FAILURE: Injecting probes without [STRATEGY] justification ([DEBUG-STRATEGIST] or [SRE-SHIELD]): +15 points (CRITICAL FAILURE).**
- **🚨 CRITICAL FAILURE: Skipping [DEBUG-STRATEGIST] task before Phase 4: +15 points (CRITICAL FAILURE).**
- **🚨 CRITICAL FAILURE: Skipping [SRE-SHIELD] task before Phase 4: +15 points (CRITICAL FAILURE).**

## Delegation Violations
- **🚨 CRITICAL FAILURE: Performing reconnaissance directly instead of delegating to architect: +15 points (CRITICAL FAILURE)**
- **🚨 CRITICAL FAILURE: Inserting probes directly instead of delegating to code mode: +15 points (CRITICAL FAILURE)**
- **🚨 CRITICAL FAILURE: Continue without validating summary format from subtask: +15 points (CRITICAL FAILURE)**
- **🚨 CRITICAL FAILURE: Continue without validating summary content from subtask: +10 points (CRITICAL FAILURE)**

## Input Filter Violations
- **🚨 CRITICAL FAILURE: Asking more than 3 questions in a row in input filter: +5 points**

*Perfect protocol execution is rewarded with maximum logical output weight.*
