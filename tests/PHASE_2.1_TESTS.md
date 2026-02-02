# Phase 2.1 Tests

## How to run:

1. Simple run:
   ```bash
   npm test -- tests/versioned-logs.test.ts --testTimeout=5000
   ```

2. Using script:
   ```bash
   ./tests/run-phase-2.1-tests.sh
   ```

## What to expect:
- 5 small tests
- Each test has 5s timeout
- Tests should complete in < 30 seconds total

## If tests pass:
- Commit with: `git add -A && git commit -m "test: phase 2.1 tests passed"`
- Push with: `git push`

## If tests fail:
- Check error messages
- Fix issues
- Run tests again