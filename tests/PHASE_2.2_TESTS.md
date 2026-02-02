# Phase 2.2 Tests: Async I/O для больших логов (streams)

## Контекст
- Фаза 2.1 (MVCC версионирование) завершена и запушена
- Документация обновлена
- Проблема: JSON.stringify блокирует UI на 200-500ms при больших логах
- Цель: Использовать streams вместо синхронных операций

## Реализованные изменения

### 1. Новый модуль `src/streaming-json.ts`
- `parseJSONStream(filePath)` - чтение через fs.createReadStream
- `writeJSONStream(filePath, data)` - запись через fs.createWriteStream
- `streamJSONArray(filePath, onChunk)` - потоковая обработка больших JSON массивов
- `writeJSONArrayStream(filePath, items)` - потоковая запись массивов

### 2. Интеграция streams в `src/shared-log-storage.ts`
- Заменены вызовы `VersionedLogStore.readLatestVersion` с опцией `useStreaming: true`
- Заменены вызовы `VersionedLogStore.replaceLogs` с опцией `useStreaming: true`
- Заменены вызовы `VersionedLogStore.mergeLogs` с опцией `useStreaming: true`

### 3. Обновление `src/versioned-logs.ts`
- Добавлены опции `useStreaming` в интерфейсы `ReadOptions` и `WriteOptions`
- Модифицированы методы `readLatestVersion`, `replaceLogs`, `mergeLogs` для поддержки потокового чтения/записи
- Сохранена обратная совместимость (по умолчанию `useStreaming: false`)

## Как запустить тесты:

### 1. Простой запуск:
```bash
npm test -- tests/streaming-json.test.ts --testTimeout=5000
```

### 2. Используя скрипт:
```bash
./tests/run-phase-2.2-tests.sh
```

### 3. Запуск всех тестов Phase 2.2 (включая интеграционные):
```bash
npm test -- tests/streaming-json.test.ts --testTimeout=5000
```

## Что ожидать:
- 6 групп тестов (parseJSONStream, writeJSONStream, streamJSONArray, writeJSONArrayStream, интеграция)
- Каждый тест имеет timeout 5 секунд
- Тесты должны завершиться за < 60 секунд суммарно
- Все тесты должны проходить

## Если тесты проходят:
- Закоммитить изменения: `git add -A && git commit -m "feat: phase 2.2 async I/O with streams"`
- Запушить: `git push`

## Если тесты не проходят:
- Проверить сообщения об ошибках
- Убедиться, что файл `src/streaming-json.ts` корректно импортируется
- Проверить, что опция `useStreaming` правильно передается в `VersionedLogStore`
- Убедиться, что временные файлы создаются и удаляются корректно

## Критические требования (соблюдены):
- ✅ НЕ запускать тесты автоматически
- ✅ НЕ коммитить автоматически
- ✅ НЕ пушить автоматически
- ✅ Просто подготовить код и тесты для запуска пользователем

## Дополнительные заметки:
- Потоковое чтение/запись особенно важно для больших файлов логов (10k+ записей)
- Метод `calculateHash` в `versioned-logs.ts` все еще использует `JSON.stringify` - это может быть оптимизировано в будущих фазах
- Для очень больших массивов рекомендуется использовать `streamJSONArray` и `writeJSONArrayStream` для обработки по частям