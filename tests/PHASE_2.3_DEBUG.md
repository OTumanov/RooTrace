# Debug: clearLogs test

## Контекст
- **Фаза 2.3:** Расщепление extension.ts на модули
- **Дата:** 2026-02-02
- **Статус:** Тест падает, требуется отладка

## Проблема
Тест `clearLogs` падает: после `storage.clear()` в хранилище остаётся 1 лог.

**Ошибка:**
```
expect(received).toHaveLength(expected)

Expected length: 0
Received length: 1
Received array:  [{"context": "Context", "data": {}, "hypothesisId": "to-clear", "timestamp": "2026-02-02T13:59:11.654Z"}]
```

**Дополнительные наблюдения:**
- Jest обнаруживает незакрытый handle `STATWATCHER` (fs.watchFile)
- Возможный race condition между watcher'ом и методом clear()
- Watcher может перезагружать данные из файла после очистки

## Файлы для отладки
1. **Тест:** `tests/debug-clear-logs.test.ts` (изолированный тест)
2. **Реализация:** `src/shared-log-storage.ts` (метод `clear()` и watcher)
3. **Сервис:** `src/services/log-service.ts` (метод `clearLogs()`)

## Для ДЕБАГЕРА

### 1. Запустите только этот тест
```bash
npm test -- tests/debug-clear-logs.test.ts --testTimeout=5000 --detectOpenHandles
```

### 2. Добавьте отладочные логи в SharedLogStorage.clear()
Откройте `src/shared-log-storage.ts` и добавьте логирование в метод `clear()`:

```typescript
async clear(): Promise<void> {
    console.log('[DEBUG] clear() started, logs before:', this.logs.length);
    this.logs = [];
    // Очищаем индексы и кэш размера
    this.hypothesisIndex.clear();
    this.timestampIndex.clear();
    this.logsSizeCache = 0;
    // Сохраняем определения гипотез, но сбрасываем их состояние
    this.hypotheses.forEach((hypothesis, key) => {
        this.hypotheses.set(key, { ...hypothesis, status: 'pending' });
    });
    // БЕЗОТКАЗНОСТЬ: Обнуляем файл через блокировку с MVCC
    await this.saveToFileWithMvcc([]);
    console.log('[DEBUG] clear() finished, logs after:', this.logs.length);
}
```

### 3. Добавьте отладочные логи в watcher callback
В методе `startWatcher()` добавьте логирование:

```typescript
fs.watchFile(logFilePath, { interval: WATCHER_CONFIG.CHECK_INTERVAL_MS }, async (curr, prev) => {
    console.log('[DEBUG] watcher triggered, curr.mtime:', curr.mtime, 'prev.mtime:', prev.mtime);
    if (curr.mtime !== prev.mtime) {
        // Очищаем предыдущий таймер debounce
        if (this.watcherDebounceTimer) {
            clearTimeout(this.watcherDebounceTimer);
            this.watcherDebounceTimer = null;
        }
        
        this.watcherDebounceTimer = setTimeout(async () => {
            console.log('[DEBUG] watcher loading from file...');
            await this.loadFromFile();
            console.log('[DEBUG] watcher loaded, logs now:', this.logs.length);
        }, WATCHER_CONFIG.DEBOUNCE_MS);
    }
});
```

### 4. Проверьте последовательность событий
Запустите тест с логами и проанализируйте вывод:

1. Добавление лога
2. Вызов `clear()`
3. Сохранение пустого файла
4. Срабатывание watcher'а
5. Загрузка данных из файла (возможно, старых)

### 5. Возможные решения
См. анализ в `docs/PHASE_2.3_CLEAR_BUG_ANALYSIS.md`:

- **Решение 1:** Временно останавливать watcher во время clear()
- **Решение 2:** Добавить флаг `suppressWatcherReload`
- **Решение 3:** Атомарная очистка файла с блокировкой

### 6. Проверка открытых хэндлов
После каждого теста убедитесь, что watcher остановлен. Добавьте в `afterEach`:

```typescript
afterEach(async () => {
    if (storage) {
        (storage as any).stopWatcher();
        // Дополнительная проверка
        await new Promise(resolve => setTimeout(resolve, 200));
    }
});
```

## Ожидаемый результат
После исправления тест должен проходить, а handle `STATWATCHER` должен закрываться.

## Следующие шаги
1. Исправить метод `clear()` в `SharedLogStorage`
2. Убедиться, что watcher корректно останавливается в тестах
3. Запустить все тесты фазы 2.3: `./tests/run-phase-2.3-tests.sh`
4. Если все тесты проходят, закоммитить изменения

---
*Документ создан для помощи дебагеру в изолированной отладке падающего теста.*