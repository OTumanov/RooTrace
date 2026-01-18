#!/bin/bash

# Скрипт для автоматической сборки VSCode расширения RooTrace
set -e

echo "=== Сборка VSCode расширения RooTrace ==="
echo "Версия: 0.0.1"
echo ""

# Функция для вывода сообщений об ошибках и завершения работы
error_exit() {
    echo "Ошибка: $1" >&2
    exit 1
}

# Проверяем наличие npm
if ! command -v npm &> /dev/null; then
    error_exit "npm не найден. Убедитесь, что Node.js установлен."
fi

echo "✓ npm найден"

# Проверяем наличие vsce (инструмента для пакетирования расширений VSCode)
if ! command -v vsce &> /dev/null; then
    echo "⚠ vsce не найден. Устанавливаем через npm..."
    npm install -g @vscode/vsce || error_exit "Не удалось установить vsce"
fi

echo "✓ vsce найден"

# Устанавливаем зависимости проекта
echo "Устанавливаю зависимости проекта..."
npm install || error_exit "Не удалось установить зависимости"

echo "✓ Зависимости установлены"

# Компилируем TypeScript проект
echo "Компилирую TypeScript проект..."
npm run compile || error_exit "Не удалось скомпилировать проект"

echo "✓ Проект скомпилирован"

# Упаковываем расширение в .vsix файл
echo "Упаковываю расширение в .vsix файл..."
yes y | vsce package || error_exit "Не удалось упаковать расширение"

echo "✓ Расширение упаковано"

# Выводим информацию о созданном файле
VsixFile=$(ls *.vsix | head -n 1)
if [ -f "$VsixFile" ]; then
    echo ""
    echo "=== Информация о собранном расширении ==="
    echo "Файл: $VsixFile"
    echo "Размер: $(du -h "$VsixFile" | cut -f1)"
    echo "Дата создания: $(stat -c %y "$VsixFile" 2>/dev/null || stat -f %Sm "$VsixFile" 2>/dev/null)"
else
    error_exit "Файл .vsix не найден после упаковки"
fi

echo ""
echo "Сборка завершена успешно!"