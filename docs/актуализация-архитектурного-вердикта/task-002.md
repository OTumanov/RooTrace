# Задача 002: Проверить статус уязвимости шифрования

## Что нужно проверить

Проверить файл [`src/encryption-utils.ts`](../../src/encryption-utils.ts) на наличие исправления уязвимости шифрования.

**Конкретные проверки:**
1. Функция `generateWorkspaceSalt()` существует и генерирует уникальный salt для каждого workspace
2. Функция `getEncryptionKey()` требует явной установки переменной окружения `ROO_TRACE_ENCRYPTION_KEY`
3. Нет дефолтной секретной фразы `'roo-trace-default-secret'`
4. Выбрасывается ошибка если переменная окружения не установлена

## Как протестировать

### Тест 1: Проверка отсутствия дефолтной секретной фразы
```bash
# Запустить без переменной окружения
unset ROO_TRACE_ENCRYPTION_KEY
npm run test-encryption
```

### Тест 2: Проверка генерации уникального salt
```bash
# Запустить с установленной переменной
export ROO_TRACE_ENCRYPTION_KEY="test-key-123"
node -e "
const { generateWorkspaceSalt } = require('./src/encryption-utils.ts');
const salt1 = generateWorkspaceSalt('/path1');
const salt2 = generateWorkspaceSalt('/path2');
console.log('Salt1:', salt1);
console.log('Salt2:', salt2);
console.log('Unique:', salt1 !== salt2);
"
```

**Лимит:** Макс. 100 строк лога или 30 секунд выполнения

**Ожидаемый результат:** Ошибка при отсутствии переменной окружения, уникальные salt для разных workspace
