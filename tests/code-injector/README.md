# Тесты для code-injector модулей

## Структура тестов

После рефакторинга `code-injector.ts` на модульную структуру, тесты разделены на:

### Unit-тесты

- **`probe-registry.test.ts`** - Тесты для реестра проб
  - Регистрация проб
  - Получение проб
  - Удаление проб
  - Очистка реестра

- **`generator-factory.test.ts`** - Тесты для фабрики генераторов
  - Получение генераторов для разных языков
  - Генерация кода проб
  - Fallback генератор

- **`validator-factory.test.ts`** - Тесты для фабрики валидаторов
  - Получение валидаторов для разных языков
  - Валидация синтаксиса
  - Обработка ошибок

- **`positioning.test.ts`** - Тесты для модулей позиционирования
  - Определение позиции вставки
  - Python-специфичная логика
  - Применение отступов

### Интеграционные тесты

- **`integration.test.ts`** - Интеграционные тесты взаимодействия модулей
  - Полный цикл инъекции и удаления
  - Взаимодействие генераторов и валидаторов
  - Взаимодействие positioning и indentation
  - Множественные пробы в одном файле
  - Краевые случаи

## Запуск тестов

```bash
# Все тесты code-injector
npm test -- tests/code-injector/

# Конкретный файл
npm test -- tests/code-injector/probe-registry.test.ts

# С покрытием
npm test -- tests/code-injector/ --coverage
```

## Покрытие

Цель: > 80% покрытия для всех модулей code-injector

### Модули, требующие покрытия:

- ✅ `core/probe-registry.ts` - покрыт
- ✅ `generators/generator-factory.ts` - покрыт
- ✅ `validation/validator-factory.ts` - покрыт
- ✅ `positioning/` - покрыт
- ⚠️ `core/probe-injector.ts` - частично покрыт (через integration тесты)
- ⚠️ `core/probe-remover.ts` - частично покрыт (через integration тесты)

## Совместимость

Все существующие тесты (`code-injector.test.ts`, `e2e-comprehensive.test.ts`) продолжают работать через реэкспорты из `src/code-injector.ts`.
