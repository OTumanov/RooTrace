# ATOMIC ROLLBACK PROTOCOL (DIFF/PATCH MECHANISM)

**MANDATORY:** For EVERY file you modify, you must maintain atomic rollback capability via DIFF/Patch files.

## Why DIFF/Patch instead of global `clear_session`

- **Locality**: Error in `file_B.py` doesn't force rollback of perfectly working probes in `file_A.py`
- **Safety**: If agent crashes, you have `mesh_extractor.py.patch` file. You can review it or restore via `patch -R < mesh_extractor.py.patch`
- **Transparency**: Visual anchor for ADHD users - `.patch` files show which files are instrumented
- **Selective Rollback**: Rollback only problematic files, not entire project

## MANDATORY STEPS

1. **STORE DIFF AFTER EACH `apply_diff`:**
   - **IMMEDIATELY** after successful `apply_diff`, generate patch file:
     - **If git exists:** `git diff [file] > [file].patch` via `execute_command` (stores diff from last commit)
     - **If no git:** `diff -u [file].bak [file] > [file].patch` via `execute_command` (stores diff from .bak copy)
   - Patch file must be created NEXT TO original file (same directory)
   - **STATUS**: Output: `PATCH: Created [file].patch`

2. **PARTIAL ROLLBACK (Selective Rollback):**
   - **IF LINTER FAILS FOR ONE FILE:**
     - ❌ **FORBIDDEN:** Call `clear_session` (too destructive, affects all files)
     - ✅ **MANDATORY:** Restore ONLY this file:
       - **If git exists:** `git checkout [file]` via `execute_command`
       - **If no git:** `cp [file].bak [file]` via `execute_command`
     - Mark file as "Dirty" in internal state
     - Retry injection ONLY for this file
     - **STATUS**: Output: `ROLLBACK: [file] restored, retrying injection`

3. **LOG FAILED FILES:**
   - Keep track of failed files in internal state
   - Do NOT touch other functional probes unless they are logically linked to failed file
   - **STATUS**: Output: `STATUS: [N] files instrumented, [M] files failed, retrying [M] files`

## Visual Anchor (ADHD-friendly)

- `.patch` files serve as visual markers: "These files have probes"
- User can see at a glance which files are instrumented
- No need to remember or check logs

## Example workflow

```
1. apply_diff to file_A.py → SUCCESS → Create file_A.py.patch
2. apply_diff to file_B.py → SUCCESS → Create file_B.py.patch  
3. apply_diff to file_C.py → LINTER ERROR
   → ROLLBACK: cp file_C.py.bak file_C.py (selective rollback)
   → Retry file_C.py only
   → Do NOT touch file_A.py or file_B.py
```

## IF PATCH IS EMPTY

- This means backup was created AFTER injection (violation) OR files are identical
- **DO NOT:** Try to "fix" by doing `git checkout` or creating `.original` files
- **DO NOT:** Re-inject probes or manipulate files
- **DO:** Accept that backup was created incorrectly, but patch is still created (even if empty)
- **DO:** Continue with next injection (backup for next file will be correct)

**PENALTY:** Skipping patch creation after successful injection = +10 points (CRITICAL FAILURE)
**PENALTY:** Trying to "fix" empty patch by manipulating files = +5 points
