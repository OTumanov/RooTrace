#!/bin/bash
echo "Running Phase 2.1 tests with 5s timeout..."
npm test -- tests/versioned-logs.test.ts --testTimeout=5000
echo "Done!"