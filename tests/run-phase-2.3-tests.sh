#!/bin/bash
echo "Running Phase 2.3 tests with 5s timeout and open handles detection..."
echo "Testing new modules: log-service, storage-service, prompt-service, role-service"
echo "Also testing http-server, websocket, ui-bridge if tests exist"

# Запускаем тесты для новых сервисов с детектированием незакрытых хэндлов
npm test -- tests/log-service.test.ts --testTimeout=5000 --detectOpenHandles

# Если есть другие тесты, можно добавить их здесь
# npm test -- tests/storage-service.test.ts --testTimeout=5000 --detectOpenHandles
# npm test -- tests/prompt-service.test.ts --testTimeout=5000 --detectOpenHandles
# npm test -- tests/role-service.test.ts --testTimeout=5000 --detectOpenHandles

# Тесты для модулей, которые были вынесены
if [ -f "tests/http-server.test.ts" ]; then
    npm test -- tests/http-server.test.ts --testTimeout=5000 --detectOpenHandles
fi

if [ -f "tests/websocket.test.ts" ]; then
    npm test -- tests/websocket.test.ts --testTimeout=5000 --detectOpenHandles
fi

if [ -f "tests/ui-bridge.test.ts" ]; then
    npm test -- tests/ui-bridge.test.ts --testTimeout=5000 --detectOpenHandles
fi

# Отладочный тест для clearLogs (падающий тест)
if [ -f "tests/debug-clear-logs.test.ts" ]; then
    echo ""
    echo "=== Запуск отладочного теста clearLogs ==="
    npm test -- tests/debug-clear-logs.test.ts --testTimeout=5000 --detectOpenHandles
fi

echo "Phase 2.3 tests completed!"