#!/bin/bash
# Скрипт для запуска тестов saveAIDebugConfig с ограничениями

TEST_FILE="tests/ai-debug-config-save.test.ts"
MAX_OUTPUT_LINES=100
MAX_TIME_SECONDS=30

echo "Запуск тестов из $TEST_FILE..."
echo "Лимит вывода: $MAX_OUTPUT_LINES строк"
echo "Лимит времени: $MAX_TIME_SECONDS секунд"
echo "========================================"

# Запускаем тесты с ограничением вывода
npx jest "$TEST_FILE" --verbose=false 2>&1 | head -n "$MAX_OUTPUT_LINES"

# Проверяем статус выхода
EXIT_CODE=${PIPESTATUS[0]}

echo "========================================"
echo "Статус выхода: $EXIT_CODE"

if [ $EXIT_CODE -ne 0 ]; then
    echo "ОШИБКА: Тесты упали с кодом $EXIT_CODE"
    exit $EXIT_CODE
fi

echo "Успех: Все тесты прошли"
exit 0
