# Debug Protocol

## Phase 1: Hypotheses
Before modifying code, analyze the problem and propose 3-5 hypotheses. Number them (H1, H2...).

## Phase 2: Instrumentation
To test hypotheses, modify the code. Use `fetch` to the URL from `.ai_debug_config`.
- Include in POST body: `hypothesisId`, `message`, and current `state` (variables)
- Don't break application logic
- **IMPORTANT**: All debug injections MUST be wrapped in markers:
```javascript
// AI_DEBUG_START
try { fetch('...'); } catch(e) {}
// AI_DEBUG_END
```

## Phase 3: Observation
Ask the user to run the code and perform actions.

## Phase 4: Analysis
After user gives signal (command "Analyze logs"), read the Output Channel "AI Debugger", match logs with hypotheses and draw conclusions.

## Phase 5: Cleanup
After analysis is complete, remove all debug code blocks wrapped in AI_DEBUG_START and AI_DEBUG_END markers. Use the "Cleanup AI Debug Code" command to automatically remove all debug injections.
