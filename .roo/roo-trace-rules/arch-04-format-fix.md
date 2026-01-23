# Format: PROBLEM:SOLUTION:FILE:LINE:CHANGE:JUSTIFICATION (Fix Proposal)

**STRICT OUTPUT FORMAT for Phase 7.1 (Log Analysis & Fix Proposal)**

## REQUIRED FORMAT

Output EXACTLY:

```
PROBLEM: [root cause]
SOLUTION: [concrete fix]
FILE:path/to/file.py
LINE:number
CHANGE: [what exactly to change]
JUSTIFICATION: [why this will solve problem]
```

## FIELD REQUIREMENTS

1. **PROBLEM:** Root cause identified from logs
2. **SOLUTION:** Concrete fix proposal (different from BLACKLIST if provided)
3. **FILE:** Full path to file to modify
4. **LINE:** Line number where change should be made
5. **CHANGE:** Exact description of what to change
6. **JUSTIFICATION:** Why this fix will solve problem (include code citations if relevant)

## CRITICAL: SOLUTION UNIQUENESS

**If BLACKLIST provided:**
- **FORBIDDEN:** Proposing solutions identical to BLACKLIST
- **MANDATORY:** Propose ALTERNATIVE solution
- **MANDATORY:** Explain why this solution is different and will work

**Example CORRECT:**
```
PROBLEM: Function accesses array without bounds check, causing IndexError when index >= len(items)
SOLUTION: Add bounds check before array access: `if index >= len(items): return None`
FILE:src/mesh_extractor.py
LINE:120
CHANGE: Add `if index >= len(items): return None` before `return self.items[index]`
JUSTIFICATION: Logs show IndexError at line 120. Adding bounds check prevents out-of-range access. Previous solution (try/except) didn't address root cause - this prevents the error.
```

**PENALTY:** Solution identical to BLACKLIST = +15 points (CRITICAL FAILURE)
**PENALTY:** Format mismatch = +15 points (CRITICAL FAILURE)
