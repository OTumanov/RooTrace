# Задача 002: Реализовать метод saveAIDebugConfig()

## Что нужно сделать

Метод `saveAIDebugConfig(config: AIDebugConfig): boolean` сохраняет объект конфигурации AI Debug в зашифрованном виде в файл.

**Функциональность:**
1. Принимает объект типа `AIDebugConfig` как параметр
2. Использует `getRootraceFilePath('ai_debug_config')` для получения пути к файлу
3. Получает ключ шифрования через `getEncryptionKey()`
4. Шифрует объект конфигурации с помощью `encryptObject()`
5. Записывает зашифрованные данные в файл с использованием `fs.writeFileSync()`
6. Возвращает `true` при успешном сохранении, `false` в случае ошибки

## Как протестировать

### Тест 1: Проверить успешное сохранение конфигурации
```bash
# Создать тестовый файл tests/ai-debug-config-save.test.ts
# Запустить тест
npm test -- tests/ai-debug-config-save.test.ts
```

### Тест 2: Проверить шифрование и запись в файл
```bash
# Запустить тест сохранения с конкретной конфигурацией
node -e "
const { ConfigManager } = require('./src/config/config-manager.ts');
const { getRootraceFilePath } = require('./src/rootrace-dir-utils.ts');
const fs = require('fs');

const manager = ConfigManager.getInstance();
const testConfig = {
  url: 'http://localhost:3000/',
  status: 'active',
  timestamp: Date.now()
};

const result = manager.saveAIDebugConfig(testConfig);
const configPath = getRootraceFilePath('ai_debug_config');
const fileExists = fs.existsSync(configPath);

console.log('Save result test:', result === true);
console.log('File exists test:', fileExists === true);

if(fileExists) {
  const content = fs.readFileSync(configPath, 'utf8');
  console.log('File content exists test:', content.length > 0);
}
"
```

**Лимит:** Макс. 100 строк лога или 30 секунд выполнения

**Ожидаемый результат:** Метод корректно сохраняет зашифрованную конфигурацию в файл и возвращает true при успехе