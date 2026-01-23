# План рефакторинга: code-injector.ts

## Текущее состояние
- **Размер**: ~1962 строки
- **Проблемы**: Монолитный файл с множественными ответственностями
- **Сложность**: Высокая - содержит логику для 15+ языков программирования

## Цели рефакторинга
1. Разделить на модули по функциональности
2. Улучшить тестируемость
3. Упростить добавление поддержки новых языков
4. Уменьшить когнитивную нагрузку

## Структура модулей после рефакторинга

### 1. `code-injector/core/` - Основная логика инъекции
**Файлы:**
- `probe-injector.ts` - Основная функция `injectProbe()`
- `probe-remover.ts` - Функции `removeProbe()`, `removeAllProbesFromFile()`
- `probe-registry.ts` - Управление реестром проб (`probeRegistry`, `getAllProbes()`)

**Ответственность:**
- Координация процесса инъекции/удаления
- Управление реестром проб
- Валидация входных параметров

### 2. `code-injector/generators/` - Генерация кода проб
**Файлы:**
- `probe-code-generator.ts` - Основная функция `generateProbeCode()`
- `language-detector.ts` - `getLanguageFromFileExtension()`
- `generators/` - Генераторы для конкретных языков:
  - `python-generator.ts`
  - `javascript-generator.ts`
  - `go-generator.ts`
  - `java-generator.ts`
  - `rust-generator.ts`
  - `cpp-generator.ts`
  - `php-generator.ts`
  - `ruby-generator.ts`
  - `csharp-generator.ts`
  - `swift-generator.ts`
  - `kotlin-generator.ts`
  - `fallback-generator.ts` - Для неизвестных языков

**Ответственность:**
- Генерация кода проб для каждого языка
- Регистрация генераторов через интерфейс `ProbeCodeGenerator`
- Fallback на JavaScript для неизвестных языков

**Интерфейс ProbeCodeGenerator:**
```typescript
export interface ProbeCodeGenerator {
  /**
   * Генерирует код пробы для указанного языка
   * @param language Язык программирования (например, 'python', 'javascript')
   * @param probeType Тип пробы: 'log', 'trace', или 'error'
   * @param message Сообщение для логирования (будет экранировано)
   * @param serverUrl URL сервера RooTrace
   * @param hypothesisId ID гипотезы (H1-H5), опционально
   * @returns Сгенерированный код пробы для вставки в файл, или null если язык не поддерживается
   */
  generate(
    language: string,
    probeType: 'log' | 'trace' | 'error',
    message: string,
    serverUrl: string,
    hypothesisId?: string
  ): string | null;
  
  /**
   * Поддерживаемые языки (массив расширений или названий языков)
   */
  readonly supportedLanguages: string[];
}
```

### 3. `code-injector/host-detection/` - Определение хоста для Docker
**Файлы:**
- `host-init-generator.ts` - Генерация кода инициализации хоста
- `python-host-init.ts` - `generatePythonHostInitCode()`
- `go-host-init.ts` - `generateGoHostInitCode()`, `ensureGoProbeImports()`

**Ответственность:**
- Генерация кода определения хоста для Docker окружений
- Управление импортами для Go
- Отслеживание файлов с инициализацией (`filesWithHostInit`)

### 4. `code-injector/validation/` - Валидация синтаксиса
**Файлы:**
- `syntax-validator.ts` - Основная функция `validateSyntax()`
- `validators/` - Валидаторы для конкретных языков:
  - `python-validator.ts`
  - `javascript-validator.ts`
  - `typescript-validator.ts`
  - `go-validator.ts`
  - `java-validator.ts`
  - `rust-validator.ts`
  - `cpp-validator.ts`
  - `php-validator.ts`
  - `ruby-validator.ts`
  - `csharp-validator.ts`
  - `swift-validator.ts`
  - `kotlin-validator.ts`

**Ответственность:**
- Проверка синтаксиса после инъекции
- Rollback при обнаружении ошибок
- Конфигурация таймаутов и включения/выключения валидации

**Интерфейс SyntaxValidator:**
```typescript
export interface SyntaxValidator {
  /**
   * Проверяет синтаксис файла после инъекции пробы
   * @param filePath Путь к файлу для проверки
   * @param timeout Таймаут проверки в миллисекундах
   * @returns Результат проверки синтаксиса
   */
  validate(
    filePath: string,
    timeout: number
  ): Promise<SyntaxValidationResult>;
  
  /**
   * Поддерживаемые языки
   */
  readonly supportedLanguages: string[];
}

export interface SyntaxValidationResult {
  passed: boolean;
  errors?: string[];
  warnings?: string[];
}
```

### 5. `code-injector/positioning/` - Определение позиции вставки
**Файлы:**
- `insertion-position.ts` - Логика определения позиции вставки
- `python-positioning.ts` - Специфичная для Python логика (отступы, функции, return statements)
- `indentation-handler.ts` - Обработка отступов для разных языков

**Ответственность:**
- Определение правильной позиции для вставки пробы
- Обработка отступов
- Специальная логика для Python (внутри функций, избегание недостижимого кода)

### 6. `code-injector/config/` - Конфигурация
**Файлы:**
- `server-url.ts` - `getServerUrl()`, `findWorkspaceRoot()` (поиск workspace root от файла)

**Ответственность:**
- Чтение конфигурации сервера
- Поиск workspace root от конкретного файла

**Примечание:** 
- ⚠️ **НЕ дублировать утилиты!** Использовать общие утилиты из `src/utils/`:
  - `sanitizeFilePath()` → `utils/file-path-utils.ts`
  - `getProjectRoot()` → `utils/workspace-utils.ts` (`getWorkspaceRoot()`)
  - `parseConfigOrDecrypt()` → `utils/config-parser.ts`

### 7. `code-injector/types.ts` - Типы и интерфейсы
**Файлы:**
- `types.ts` - Все интерфейсы и типы

**Ответственность:**
- Определение типов для всех модулей

**Основные интерфейсы:**
```typescript
export interface InjectionResult {
  success: boolean;
  message: string;
  insertedCode?: string;
  syntaxCheck?: SyntaxValidationResult;
  rollback?: boolean; // Флаг, указывающий что файл был откачен
  error?: string;
}

export interface ProbeInfo {
  id: string;
  filePath: string;
  lineNumber: number;
  originalCode: string;
  injectedCode: string;
  probeType: string;
  message: string;
  actualLineNumber?: number;
  probeLinesCount?: number;
}
```

## Этапы рефакторинга

### Этап 1: Подготовка (1-2 дня)
1. Создать структуру директорий
2. Определить интерфейсы между модулями
3. Написать план миграции

### Этап 2: Извлечение типов (0.5 дня)
1. Создать `types.ts` с всеми интерфейсами
2. Обновить импорты в основном файле

### Этап 3: Извлечение конфигурации (0.5 дня)
1. Вынести `server-url.ts` (используя `utils/workspace-utils.ts` и `utils/config-parser.ts`)
2. Вынести `config-reader.ts` (чтение конфигурации VS Code)
3. Протестировать изолированно

**Примечание:** `file-path-utils.ts` уже в `src/utils/` - использовать оттуда!

### Этап 4: Извлечение генераторов (2-3 дня)
1. Создать интерфейс `ProbeCodeGenerator`
2. Вынести генераторы для каждого языка
3. Создать фабрику генераторов
4. Обновить `generateProbeCode()` для использования фабрики
5. Протестировать каждый генератор

### Этап 5: Извлечение валидаторов (2-3 дня)
1. Создать интерфейс `SyntaxValidator`
2. Вынести валидаторы для каждого языка
3. Создать фабрику валидаторов
4. Обновить `validateSyntax()` для использования фабрики
5. Протестировать каждый валидатор

### Этап 6: Извлечение host detection (1 день)
1. Вынести `python-host-init.ts`
2. Вынести `go-host-init.ts`
3. Создать общий интерфейс
4. Протестировать

### Этап 7: Извлечение positioning (1-2 дня)
1. Вынести `python-positioning.ts`
2. Вынести `indentation-handler.ts`
3. Создать общий интерфейс для позиционирования
4. Протестировать

### Этап 8: Извлечение core логики (2 дня)
1. Вынести `probe-registry.ts`
2. Вынести `probe-injector.ts`
3. Вынести `probe-remover.ts`
4. Обновить зависимости
5. Протестировать интеграцию

### Этап 9: Рефакторинг основного файла (1 день)
1. Оставить только экспорты и координацию
2. Удалить дублирующийся код
3. Обновить документацию

### Этап 10: Тестирование и оптимизация (3-4 дня)

#### Unit-тесты для каждого модуля:
- [ ] `probe-injector.test.ts` - тесты инъекции проб
- [ ] `probe-remover.test.ts` - тесты удаления проб
- [ ] `probe-registry.test.ts` - тесты реестра проб
- [ ] `python-generator.test.ts` - тесты генератора Python
- [ ] `javascript-generator.test.ts` - тесты генератора JS/TS
- [ ] `go-generator.test.ts` - тесты генератора Go
- [ ] `python-validator.test.ts` - тесты валидатора Python
- [ ] `javascript-validator.test.ts` - тесты валидатора JS/TS
- [ ] `go-validator.test.ts` - тесты валидатора Go
- [ ] `python-positioning.test.ts` - тесты позиционирования для Python
- [ ] `server-url.test.ts` - тесты чтения конфигурации

#### Интеграционные тесты:
- [ ] `code-injector.integration.test.ts` - полный цикл инъекции
  - Инъекция → валидация → rollback при ошибке
  - Инъекция → успешная валидация → сохранение
  - Удаление проб
  - Множественная инъекция

#### E2E тесты:
- [ ] `e2e-probe-injection.test.ts` - инъекция → выполнение кода → получение логов

#### Критерии покрытия:
- Unit-тесты: >80% покрытия для каждого модуля
- Интеграционные тесты: Все критичные пути покрыты
- E2E тесты: Все основные сценарии покрыты

#### Оптимизация:
1. Проверить производительность (бенчмарки до/после)
2. Оптимизировать критические пути
3. Обновить документацию

## Метрики успеха
- **Размер основного файла**: < 200 строк (сейчас ~1962)
- **Количество модулей**: ~25-30 файлов
- **Покрытие тестами**: > 80%
- **Время выполнения тестов**: без изменений или улучшение
- **Поддержка новых языков**: добавление 1 файла вместо изменения большого

## Риски и митигация
1. **Риск**: Нарушение существующей функциональности
   - **Митигация**: Пошаговая миграция с тестами на каждом этапе

2. **Риск**: Увеличение сложности из-за множества файлов
   - **Митигация**: Четкая структура директорий и документация

3. **Риск**: Проблемы с циклическими зависимостями
   - **Митигация**: Тщательное проектирование интерфейсов

## Приоритеты
1. **Высокий**: Извлечение генераторов (упростит добавление языков)
2. **Высокий**: Извлечение валидаторов (критично для безопасности)
3. **Средний**: Извлечение positioning (улучшит читаемость)
4. **Средний**: Извлечение host detection (изолирует Docker логику)
5. **Низкий**: Рефакторинг core (можно сделать последним)

## Оценка времени (обновлено с учетом тестирования и рисков)

**Базовые оценки:**
- Общее время: 12-18 рабочих дней

**С учетом рисков (×1.5-2):**
- **Общее время**: 18-25 рабочих дней
- **Минимальный MVP**: 12-15 дней (генераторы + валидаторы + core + базовое тестирование)
- **Полный рефакторинг**: 20-25 дней (включая полное тестирование и оптимизацию)

**Факторы увеличения:**
- Тестирование каждого модуля: +30%
- Отладка интеграций: +20%
- Код ревью и правки: +15%
- Непредвиденные проблемы: +20%
