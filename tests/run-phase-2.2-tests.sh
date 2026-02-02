#!/bin/bash
echo "Running Phase 2.2 tests (Async I/O для больших логов) with 5s timeout..."
npm test -- tests/streaming-json.test.ts --testTimeout=5000
echo "Done!"