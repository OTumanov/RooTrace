# Задача 010: Проверить статус Backpressure механизма

## Что нужно проверить

Проверить файл [`src/websocket/websocket-manager.ts`](../../src/websocket/websocket-manager.ts) на наличие исправления Backpressure механизма.

**Конкретные проверки:**
1. Метод `broadcast()` проверяет `client.bufferedAmount`
2. Реализован батчинг сообщений
3. Существует функция `broadcastLogWithBackpressure()`
4. Существует функция `flushLogs()`
5. Определены константы `MAX_BUFFER_SIZE` и `LOG_BATCH_SIZE`

## Как протестировать

### Тест 1: Проверка bufferedAmount
```bash
# Запустить тест
npm test -- tests/websocket-backpressure.test.ts
```

### Тест 2: Стресс-тест с множественными сообщениями
```bash
# Запустить тест с 10000 сообщений
node -e "
const { WebSocketManager } = require('./src/websocket/websocket-manager.ts');
// Отправить 10000 сообщений
// Проверить что bufferedAmount не превышает MAX_BUFFER_SIZE
"
```

**Лимит:** Макс. 100 строк лога или 30 секунд выполнения

**Ожидаемый результат:** Backpressure работает, bufferedAmount контролируется
