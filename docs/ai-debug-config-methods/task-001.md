# Задача 001: Реализовать метод createAIDebugConfig() [ГОТОВО]

## Что нужно сделать

Метод `createAIDebugConfig(port: number)` создает объект конфигурации AI Debug с заданным портом.

**Функциональность:**
1. Принимает номер порта как параметр
2. Создает объект типа `AIDebugConfig` с URL в формате `http://localhost:{port}/`
3. Устанавливает статус как "active"
4. Устанавливает timestamp как текущее время

**Пример результата:**
```typescript
{
  url: `http://localhost:${port}/`,
  status: "active",
  timestamp: Date.now()
}
```

## Как протестировать

### Тест 1: Проверить создание конфигурации с различными портами
```bash
# Создать тестовый файл tests/ai-debug-config-create.test.ts
# Запустить тест
npm test -- tests/ai-debug-config-create.test.ts
```

### Тест 2: Проверить корректность формата URL
```bash
# Запустить тест с конкретным портом
node -e "
const { ConfigManager } = require('./src/config/config-manager.ts');
const manager = ConfigManager.getInstance();
const config = manager.createAIDebugConfig(3000);
console.log('URL format test:', config.url === 'http://localhost:3000/');
console.log('Status test:', config.status === 'active');
console.log('Timestamp test:', typeof config.timestamp === 'number');
"
```

**Лимит:** Макс. 100 строк лога или 30 секунд выполнения

**Ожидаемый результат:** Метод корректно создает объект конфигурации с правильным форматом URL и установленными полями

## Результаты тестирования

**Статус:** [ГОТОВО]
- Test Suites: 1 passed, 1 total
- Tests: 5 passed, 5 total
- Время выполнения: 1.192 секунды
- Лимиты не превышены (100 строк / 30 сек)