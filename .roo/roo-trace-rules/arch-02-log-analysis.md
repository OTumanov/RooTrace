# Phase 7.1: LOG ANALYSIS (Architect Instructions)

**Analyze problem based on logs and propose NEW solution.**

## CONTEXT

You receive:
- Log analysis results from Phase 6
- Which hypothesis confirmed
- What data obtained
- **BLACKLIST OF PREVIOUS ATTEMPTS** (if any) - DO NOT propose these solutions again

## TASK

1. Analyze logs and determine root cause
2. Propose CONCRETE NEW fix (different from previous attempts in BLACKLIST)
3. Specify files and lines for change
4. Explain why this fix will solve problem

## CRITICAL: BLACKLIST HANDLING

**If BLACKLIST provided:**
- **FORBIDDEN:** Proposing solutions that were already tried
- **MANDATORY:** Propose ALTERNATIVE solution, considering that previous ones didn't work
- **MANDATORY:** Consider why previous solutions failed and propose different approach

## OUTPUT FORMAT (STRICT)

**ON COMPLETION:**
- Use `attempt_completion` with result parameter
- In result specify STRICTLY in format:
  * PROBLEM: [root cause]
  * SOLUTION: [concrete fix]
  * FILE:path/to/file.py
  * LINE:number
  * CHANGE: [what exactly to change]
  * JUSTIFICATION: [why this will solve problem]

**CRITICALLY IMPORTANT:** 
- SOLUTION must be UNIQUE (different from BLACKLIST)
- JUSTIFICATION must explain why this fix will work when previous didn't
- Include code citations in JUSTIFICATION if relevant

Report via attempt_completion and RETURN.
