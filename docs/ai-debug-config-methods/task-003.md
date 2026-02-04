# Задача 003: Реализовать метод loadAIDebugConfig()

## Что нужно сделать

Метод `loadAIDebugConfig(): AIDebugConfig | null` загружает и расшифровывает объект конфигурации AI Debug из файла.

**Функциональность:**
1. Использует `getRootraceFilePath('ai_debug_config')` для получения пути к файлу
2. Проверяет существование файла конфигурации
3. Если файл не существует, возвращает `null`
4. Читает содержимое файла с помощью `fs.readFileSync()`
5. Пробует распарсить как JSON (для обратной совместимости с незашифрованными конфигами)
6. Если JSON парсинг неудачен, пробует расшифровать содержимое с помощью `decryptObject()`
7. Возвращает расшифрованный/распарсенный объект конфигурации или `null` в случае ошибки

## Как протестировать

### Тест 1: Проверить загрузку существующей конфигурации
```bash
# Создать тестовый файл tests/ai-debug-config-load.test.ts
# Запустить тест
npm test -- tests/ai-debug-config-load.test.ts
```

### Тест 2: Проверить загрузку и расшифровку конфигурации
```bash
# Запустить тест загрузки конфигурации
node -e "
const { ConfigManager } = require('./src/config/config-manager.ts');
const manager = ConfigManager.getInstance();

// Сначала сохраним тестовую конфигурацию
const testConfig = {
  url: 'http://localhost:3000/',
  status: 'active',
  timestamp: Date.now()
};
manager.saveAIDebugConfig(testConfig);

// Затем попробуем загрузить её
const loadedConfig = manager.loadAIDebugConfig();
console.log('Load result test:', loadedConfig !== null);
console.log('URL match test:', loadedConfig?.url === testConfig.url);
console.log('Status match test:', loadedConfig?.status === testConfig.status);
console.log('Timestamp match test:', loadedConfig?.timestamp === testConfig.timestamp);
"
```

**Лимит:** Макс. 100 строк лога или 30 секунд выполнения

**Ожидаемый результат:** Метод корректно загружает и расшифровывает конфигурацию из файла, возвращая объект AIDebugConfig или null если файл не существует