# SAFETY FIRST: PRELIMINARY COMMIT OR .BAK COPY

**CRITICAL:** Before making the FIRST change to project code (Phase 4 or Phase 7):

## MANDATORY STEPS

1. **GIT CHECK**: First check if there's a git repository via `execute_command` with `git status`.
   - **If git exists:** Execute `git add . && git commit -m "AI Debugger: Pre-instrumentation backup"` via `execute_command`.
   - **If no git:** Create `.bak` file copy: `cp [file] [file].bak` via `execute_command`. Copy must be next to original file.
   - If file already has `.bak` copy, overwrite it (this is normal).
2. **STATUS**: Output must be: `SAFETY: Backup created.` (for git) or `SAFETY: Backup file created: [file].bak` (for .bak copy)

**Why this is important:** If your `apply_diff` or `write_to_file` breaks structure (especially in Python), we need a rollback point. Git commit allows instant return to original state via `git checkout .`. If no git repository, `.bak` copy allows file restoration via `cp <file>.bak <file>`.

**Rule:** This step executes ONCE before first code change. If you already made commit or `.bak` copy in this session, skip this step.

## Options

1. **If git repository exists:** `git add . && git commit -m "AI Debugger: Pre-instrumentation backup"`
2. **If no git repository:** `cp <file> <file>.bak` (create copy next to file)

## 🚨 CRITICAL BACKUP RULE

- **MANDATORY:** Backup MUST be created BEFORE first `apply_diff` to ANY file
- **FORBIDDEN:** Creating backup AFTER injecting probes (backup will contain probes, making patch useless)
- **FORBIDDEN:** Using `git checkout` to "fix" backup - if backup is wrong, you already violated protocol
- **FORBIDDEN:** Creating `.original` files or other backup variants - use ONLY `.bak` or git commit
- **CHECK:** Before first `apply_diff`, verify backup exists: `ls [file].bak` (if no git) or check git log
- **PENALTY:** Creating backup after injection = +10 points (CRITICAL FAILURE)
