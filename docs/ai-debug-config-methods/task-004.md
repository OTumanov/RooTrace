# Задача 004: Реализовать метод removeAIDebugConfig()

## Что нужно сделать

Метод `removeAIDebugConfig(): boolean` удаляет файл конфигурации AI Debug.

**Функциональность:**
1. Использует `getRootraceFilePath('ai_debug_config')` для получения пути к файлу
2. Проверяет существование файла конфигурации
3. Если файл существует, удаляет его с помощью `fs.unlinkSync()`
4. Возвращает `true` если файл был удален, `false` если файл не существовал
5. В случае ошибки возвращает `false` и выводит сообщение об ошибке в консоль

## Как протестировать

### Тест 1: Проверить удаление существующего файла конфигурации
```bash
# Создать тестовый файл tests/ai-debug-config-remove.test.ts
# Запустить тест
npm test -- tests/ai-debug-config-remove.test.ts
```

### Тест 2: Проверить удаление и возвращаемые значения
```bash
# Запустить тест удаления конфигурации
node -e "
const { ConfigManager } = require('./src/config/config-manager.ts');
const { getRootraceFilePath } = require('./src/rootrace-dir-utils.ts');
const fs = require('fs');

const manager = ConfigManager.getInstance();

// Сначала сохраним тестовую конфигурацию
const testConfig = {
  url: 'http://localhost:3000/',
  status: 'active',
  timestamp: Date.now()
};
manager.saveAIDebugConfig(testConfig);

const configPath = getRootraceFilePath('ai_debug_config');
const fileExistsBefore = fs.existsSync(configPath);
console.log('File exists before removal test:', fileExistsBefore === true);

// Затем удалим её
const removeResult = manager.removeAIDebugConfig();
const fileExistsAfter = fs.existsSync(configPath);

console.log('Remove result test:', removeResult === true);
console.log('File removed test:', fileExistsAfter === false);
"
```

**Лимит:** Макс. 100 строк лога или 30 секунд выполнения

**Ожидаемый результат:** Метод корректно удаляет файл конфигурации если он существует и возвращает true, или возвращает false если файл не существовал