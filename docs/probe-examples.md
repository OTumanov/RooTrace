# Примеры проб (инъекций в код) для тестирования

⚠️ **ВАЖНО:** Эти примеры показывают, как выглядят пробы после генерации. Для Python файлов **ЗАПРЕЩЕНО** использовать `inject_probes` или `inject_multiple_probes`. Вместо этого используйте `apply_diff` (Block Rewrite) для замены функций/блоков целиком.

## Правила гигиены кода

Все пробы следуют строгим правилам гигиены кода:

1. **The 5-Line Rule**: Проба не должна превышать 5-7 строк
2. **Метрики количества**: Включайте `len(array)` и флаг `is_empty` для массивов/списков
3. **Оптимизация импортов**: Не дублируйте `json` если он уже импортирован в файле
4. **Асинхронность**: Не блокируйте основной поток (Go: `go func()`, Python: `timeout=5.0`)
5. **Zero-Dependency**: Используйте только стандартные библиотеки или то, что уже есть в файле
6. **Metadata Abstraction**: Метаданные в `state`, а не в `message`
7. **Session Binding**: Включайте `sessionId` в `state` и в имена временных файлов

## Поддержка Docker

RooTrace автоматически определяет Docker окружение и настраивает пробы для работы как внутри контейнеров, так и на обычных машинах.

### Автоматическое определение окружения

**Python файлы:**
- При первой инъекции пробы в начало файла добавляется переменная `_rootrace_host`
- Пробы автоматически заменяют `localhost` на `_rootrace_host` в URL

**Go файлы:**
- При первой инъекции пробы в начало файла добавляется переменная `rootraceHost`
- Пробы автоматически заменяют `localhost` на `rootraceHost` в URL

### Цепочка определения хоста

1. **Переменная окружения** `ROO_TRACE_HOST` (если установлена)
2. **Docker окружение**: Проверка `/.dockerenv` или `/proc/self/cgroup`
3. **host.docker.internal**: Если доступен (Docker Desktop для Mac/Windows, Docker 20.10+ для Linux)
4. **Gateway IP**: Определяется через UDP соединение к 8.8.8.8:80 (в Docker контейнерах)
5. **localhost**: По умолчанию (для обычных приложений)

### Переопределение хоста

Вы можете принудительно установить хост через переменную окружения:
```bash
export ROO_TRACE_HOST=172.17.0.1  # IP шлюза Docker
# или
export ROO_TRACE_HOST=host.docker.internal
```

### Логирование

Пробы автоматически логируют:
- В файл `~/.roo_probe_debug.log` (для Python)
- В консоль (stderr) с префиксом `[RooTrace Probe]`
- Включают информацию об используемом URL для диагностики

## Пример 1: http.client (рекомендуется для IFC/тяжелых операций)
```python
# RooTrace [id: 7a1b] H1: измерение общего времени извлечения мешей
try:
    import http.client, json, socket
    conn = http.client.HTTPConnection("localhost", 51234)
    conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0)
    conn.request("POST", "/", json.dumps({'hypothesisId': 'H1', 'message': 'extract_meshes start', 'state': {'ifc_path': str(ifc_path), 'parts_count': len(eligible_part_ids), 'stage_id': stage_id}}), {'Content-Type': 'application/json'})
    conn.getresponse()
    conn.close()
except:
    pass
# RooTrace [id: 7a1b]: end
```

## Пример 2: requests (если библиотека установлена)
```python
# RooTrace [id: 7a2c] H2: общее время извлечения мешей
try:
    import requests
    requests.post('http://localhost:51234/', json={'hypothesisId': 'H2', 'message': 'extract_meshes end', 'state': {'elapsed_seconds': elapsed, 'meshes_count': len(meshes), 'parts_count': len(eligible_part_ids)}}, timeout=5.0)
except:
    pass
# RooTrace [id: 7a2c]: end
```

## Пример 3: urllib.request (без внешних зависимостей)
```python
# RooTrace [id: 7a3d] H3: время обработки одного ifc_id
try:
    import urllib.request, json
    urllib.request.urlopen(urllib.request.Request('http://localhost:51234/', data=json.dumps({'hypothesisId': 'H3', 'message': 'ifc_id start', 'state': {'part_id': part_id, 'ifc_id': ifc_id}}).encode('utf-8'), headers={'Content-Type': 'application/json'}), timeout=5.0)
except:
    pass
# RooTrace [id: 7a3d]: end
```

## Пример 4: Минимальный вариант (одна строка) - для быстрых операций
```python
# RooTrace [id: 7a4e] H4: время извлечения цвета материала
try: import http.client, json, socket; conn = http.client.HTTPConnection("localhost", 51234); conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0); conn.request("POST", "/", json.dumps({'hypothesisId': 'H4', 'message': '_extract_material_color start', 'state': {'product_id': product.id()}}), {'Content-Type': 'application/json'}); conn.getresponse(); conn.close() except: pass
# RooTrace [id: 7a4e]: end
```

## Пример 5: С таймингом (начало и конец функции)
```python
# RooTrace [id: 7b1a] H2: время извлечения меша для детали
try:
    import http.client, json, socket, time
    start_part_time = time.time()
    conn = http.client.HTTPConnection("localhost", 51234)
    conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0)
    conn.request("POST", "/", json.dumps({'hypothesisId': 'H2', 'message': '_extract_mesh_for_part start', 'state': {'part_id': part_id, 'ifc_ids_count': len(ifc_ids)}}), {'Content-Type': 'application/json'})
    conn.getresponse()
    conn.close()
except:
    pass
# RooTrace [id: 7b1a]: end

# ... код функции ...

# RooTrace [id: 7b5e] H2: время извлечения меша для детали завершено
try:
    import http.client, json, socket, time
    elapsed_part = time.time() - start_part_time
    conn = http.client.HTTPConnection("localhost", 51234)
    conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0)
    conn.request("POST", "/", json.dumps({'hypothesisId': 'H2', 'message': '_extract_mesh_for_part end', 'state': {'part_id': part_id, 'elapsed_seconds': elapsed_part, 'ifc_ids_count': len(ifc_ids), 'positions_count': len(positions), 'material_colors_count': len(material_colors)}}), {'Content-Type': 'application/json'})
    conn.getresponse()
    conn.close()
except:
    pass
# RooTrace [id: 7b5e]: end
```

## Пример 6: В цикле (для каждой итерации)
```python
# Получение геометрии для каждого ifc_id
for ifc_id in ifc_ids:
    # RooTrace [id: 7b2b] H3: время обработки одного ifc_id
    try:
        import http.client, json, socket, time
        start_ifc_time = time.time()
        conn = http.client.HTTPConnection("localhost", 51234)
        conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0)
        conn.request("POST", "/", json.dumps({'hypothesisId': 'H3', 'message': 'ifc_id start', 'state': {'part_id': part_id, 'ifc_id': ifc_id}}), {'Content-Type': 'application/json'})
        conn.getresponse()
        conn.close()
    except:
        pass
    # RooTrace [id: 7b2b]: end
    
    try:
        product = model.by_id(ifc_id)
        # ... обработка ...
    except Exception as e:
        logger.warning(f"Failed to extract geometry for ifc_id {ifc_id}: {e}")
        continue
    
    # RooTrace [id: 7b3c] H3: время обработки одного ifc_id завершено
    try:
        import http.client, json, socket, time
        elapsed_ifc = time.time() - start_ifc_time
        conn = http.client.HTTPConnection("localhost", 51234)
        conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0)
        conn.request("POST", "/", json.dumps({'hypothesisId': 'H3', 'message': 'ifc_id end', 'state': {'part_id': part_id, 'ifc_id': ifc_id, 'elapsed_seconds': elapsed_ifc}}), {'Content-Type': 'application/json'})
        conn.getresponse()
        conn.close()
    except:
        pass
    # RooTrace [id: 7b3c]: end
```

## Пример 7: Условная проба (только при определенных условиях)
```python
if len(positions) == 0:
    # RooTrace [id: 7b4d] H2: деталь без геометрии
    try:
        import http.client, json, socket, time
        elapsed_part = time.time() - start_part_time
        conn = http.client.HTTPConnection("localhost", 51234)
        conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0)
        conn.request("POST", "/", json.dumps({'hypothesisId': 'H2', 'message': '_extract_mesh_for_part end (no geometry)', 'state': {'part_id': part_id, 'elapsed_seconds': elapsed_part, 'ifc_ids_count': len(ifc_ids), 'positions_count': 0}}), {'Content-Type': 'application/json'})
        conn.getresponse()
        conn.close()
    except:
        pass
    # RooTrace [id: 7b4d]: end
    return None
```

## Пример 8: Множественные ветки (разные сценарии)
```python
# RooTrace [id: 7c2g] H4: цвет найден через geometry.materials
try:
    import http.client, json, socket, time
    elapsed_color = time.time() - start_color_time
    conn = http.client.HTTPConnection("localhost", 51234)
    conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0)
    conn.request("POST", "/", json.dumps({'hypothesisId': 'H4', 'message': '_extract_material_color end (geometry.materials)', 'state': {'product_id': product.id(), 'elapsed_seconds': elapsed_color, 'method': 'geometry.materials'}}), {'Content-Type': 'application/json'})
    conn.getresponse()
    conn.close()
except:
    pass
# RooTrace [id: 7c2g]: end
return hex_color

# Или альтернативная ветка:
# RooTrace [id: 7c3h] H4: цвет не найден (нет Representation)
try:
    import http.client, json, socket, time
    elapsed_color = time.time() - start_color_time
    conn = http.client.HTTPConnection("localhost", 51234)
    conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0)
    conn.request("POST", "/", json.dumps({'hypothesisId': 'H4', 'message': '_extract_material_color end (no Representation)', 'state': {'product_id': product.id(), 'elapsed_seconds': elapsed_color, 'method': 'no Representation'}}), {'Content-Type': 'application/json'})
    conn.getresponse()
    conn.close()
except:
    pass
# RooTrace [id: 7c3h]: end
return None
```

## Пример 9: Для быстрых операций (timeout=0.1)
```python
# RooTrace [id: 7f1g] H5: быстрое измерение
try:
    import http.client, json, socket
    conn = http.client.HTTPConnection("localhost", 51234)
    conn.sock = socket.create_connection(("localhost", 51234), timeout=0.1)
    conn.request("POST", "/", json.dumps({'hypothesisId': 'H5', 'message': 'quick check', 'state': {'value': some_value}}), {'Content-Type': 'application/json'})
    conn.getresponse()
    conn.close()
except:
    pass
# RooTrace [id: 7f1g]: end
```

## Пример 10: С большим объемом данных (ограничение размера)
```python
# RooTrace [id: 7g1h] H1: передача больших данных
try:
    import http.client, json, socket
    # Ограничиваем размер данных для передачи
    state_data = {
        'large_list': large_list[:100],  # Первые 100 элементов
        'total_count': len(large_list),
        'is_empty': len(large_list) == 0,  # Флаг пустоты для UI
        'summary': {'min': min_value, 'max': max_value, 'avg': avg_value}
    }
    conn = http.client.HTTPConnection("localhost", 51234)
    conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0)
    conn.request("POST", "/", json.dumps({'hypothesisId': 'H1', 'message': 'large data', 'state': state_data}), {'Content-Type': 'application/json'})
    conn.getresponse()
    conn.close()
except:
    pass
# RooTrace [id: 7g1h]: end
```

## Пример 11: Оптимизированная проба (если `json` уже импортирован)
```python
# Если в начале файла уже есть: import json
# RooTrace [id: 8a1b] H1: оптимизированная проба
try:
    import http.client, socket  # json уже импортирован, не дублируем
    conn = http.client.HTTPConnection("localhost", 51234)
    conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0)
    conn.request("POST", "/", json.dumps({'hypothesisId': 'H1', 'message': 'optimized', 'state': {'items_count': len(items), 'is_empty': len(items) == 0}}), {'Content-Type': 'application/json'})
    conn.getresponse()
    conn.close()
except:
    pass
# RooTrace [id: 8a1b]: end
```
**Почему это важно:** Если `json` уже импортирован в файле, не нужно импортировать его локально. Это делает пробу лаконичнее (2-3 строки импортов вместо 5).

## Пример 12: С метриками количества и проверкой на пустоту (РЕКОМЕНДУЕТСЯ)
```python
# RooTrace [id: 9c2d] H2: обработка списка с полными метриками
try:
    import http.client, json, socket, os
    state_data = {
        'input_count': len(input_items) if input_items else 0,
        'output_count': len(output_items) if output_items else 0,
        'is_empty': input_items is None or len(input_items) == 0,  # Флаг пустоты для UI
        'has_nil': None in input_items if isinstance(input_items, list) else False,  # Проверка на nil
        'processed': count,
        'sessionId': os.environ.get('ROO_TRACE_SESSION_ID')  # Привязка к сессии
    }
    conn = http.client.HTTPConnection("localhost", 51234)
    conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0)
    conn.request("POST", "/", json.dumps({'hypothesisId': 'H2', 'message': 'processing', 'state': state_data}), {'Content-Type': 'application/json'})
    conn.getresponse()
    conn.close()
except:
    pass
# RooTrace [id: 9c2d]: end
```
**Почему это важно:** Метрики количества (`len()`) помогают отследить потерю данных. Флаг `is_empty` сразу бросается в глаза в UI сервера. Проверка `has_nil` помогает найти проблемы с `None/null`. `sessionId` позволяет разделить логи разных запусков.

---

## Примеры для Go

### Пример 13: Базовая проба для Go
```go
// RooTrace [id: g1a2] H1: проверка значения переменной
go func() {
    defer func() { recover() }()
    serverURL := "http://localhost:51234/"
    if rootraceHost != "" && strings.Contains(serverURL, "localhost") {
        serverURL = strings.Replace(serverURL, "localhost", rootraceHost, 1)
    }
    jsonData := []byte(`{"hypothesisId":"H1","message":"checking variable value","state":{}}`)
    req, _ := http.NewRequest("POST", serverURL, bytes.NewBuffer(jsonData))
    req.Header.Set("Content-Type", "application/json")
    client := &http.Client{Timeout: 100 * time.Millisecond}
    client.Do(req)
}()
// RooTrace [id: g1a2]: end
```

### Пример 14: Проба с данными состояния
```go
// RooTrace [id: g2b3] H2: передача данных состояния
go func() {
    defer func() { recover() }()
    serverURL := "http://localhost:51234/"
    if rootraceHost != "" && strings.Contains(serverURL, "localhost") {
        serverURL = strings.Replace(serverURL, "localhost", rootraceHost, 1)
    }
    stateJSON, _ := json.Marshal(map[string]interface{}{
        "user_id": userID,
        "request_count": requestCount,
        "status": status,
    })
    jsonData := []byte(fmt.Sprintf(`{"hypothesisId":"H2","message":"processing request","state":%s}`, stateJSON))
    req, _ := http.NewRequest("POST", serverURL, bytes.NewBuffer(jsonData))
    req.Header.Set("Content-Type", "application/json")
    client := &http.Client{Timeout: 100 * time.Millisecond}
    client.Do(req)
}()
// RooTrace [id: g2b3]: end
```

### Пример 15: Проба в начале и конце функции
```go
func processUser(userID string) {
    // RooTrace [id: g3c4] H3: начало обработки пользователя
    go func() {
        defer func() { recover() }()
        serverURL := "http://localhost:51234/"
        if rootraceHost != "" && strings.Contains(serverURL, "localhost") {
            serverURL = strings.Replace(serverURL, "localhost", rootraceHost, 1)
        }
        jsonData := []byte(fmt.Sprintf(`{"hypothesisId":"H3","message":"processUser start","state":{"user_id":"%s"}}`, userID))
        req, _ := http.NewRequest("POST", serverURL, bytes.NewBuffer(jsonData))
        req.Header.Set("Content-Type", "application/json")
        client := &http.Client{Timeout: 100 * time.Millisecond}
        client.Do(req)
    }()
    // RooTrace [id: g3c4]: end
    
    // ... код функции ...
    
    // RooTrace [id: g4d5] H3: конец обработки пользователя
    go func() {
        defer func() { recover() }()
        serverURL := "http://localhost:51234/"
        if rootraceHost != "" && strings.Contains(serverURL, "localhost") {
            serverURL = strings.Replace(serverURL, "localhost", rootraceHost, 1)
        }
        jsonData := []byte(fmt.Sprintf(`{"hypothesisId":"H3","message":"processUser end","state":{"user_id":"%s","processed":true}}`, userID))
        req, _ := http.NewRequest("POST", serverURL, bytes.NewBuffer(jsonData))
        req.Header.Set("Content-Type", "application/json")
        client := &http.Client{Timeout: 100 * time.Millisecond}
        client.Do(req)
    }()
    // RooTrace [id: g4d5]: end
}
```

### Важно для Go

- **Автоматические импорты**: Система автоматически добавляет необходимые импорты (`net/http`, `bytes`, `time`, `strings`, `encoding/json`, `fmt`) если их нет в файле
- **Инициализация хоста**: Переменная `rootraceHost` автоматически добавляется в начало файла при первой инъекции пробы
- **Асинхронное выполнение**: Пробы выполняются в отдельных goroutine через `go func()`, не блокируя основной код
- **Обработка ошибок**: Используется `defer func() { recover() }()` для защиты от паники
- **Docker поддержка**: Пробы автоматически используют `rootraceHost` вместо `localhost` в Docker окружении

## Важные замечания:

1. **Timeout для тяжелых операций:** Для IFC-парсинга, многопоточности и CPU-intensive задач используйте `timeout=5.0` (НЕ 1.0, НЕ 0.1)

2. **Timeout для быстрых операций:** Для простых проверок можно использовать `timeout=0.1`

3. **Всегда оборачивайте в try-except:** Пробы не должны нарушать работу основного кода

4. **Используйте уникальные ID:** Каждая проба должна иметь уникальный `[id: ...]` для идентификации (генерируется автоматически)

5. **Маркеры начала и конца:** Всегда закрывайте пробы маркером `# RooTrace [id: ...]: end` (добавляется автоматически)

6. **Формат данных:** `state` должен быть сериализуемым JSON (dict, list, числа, строки)

7. **Гипотезы:** Используйте H1-H5 для разных типов измерений (H1 - общее, H2 - детали, H3 - элементы, H4 - цвета, H5 - прочее)

8. **Логирование:** Пробы автоматически логируют выполнение в файл `~/.roo_probe_debug.log` и в консоль (stderr) для диагностики

9. **Docker поддержка:** Код проб автоматически определяет Docker окружение и использует правильный хост:
   - **Python**: Использует переменную `_rootrace_host`, которая определяется при загрузке модуля
   - **Go**: Использует переменную `rootraceHost`, которая определяется при загрузке пакета
   - Автоматическая замена `localhost` на правильный хост (host.docker.internal в Docker, localhost вне Docker)

10. **Python файлы:** ⚠️ Для Python файлов эти примеры показывают только формат проб. Используйте `apply_diff` (Block Rewrite) вместо `inject_probes` для вставки проб в Python код.

11. **Go файлы:** Для Go файлов пробы могут быть вставлены через `inject_probes`. Система автоматически:
    - Добавляет необходимые импорты (`net/http`, `bytes`, `time`, `strings`)
    - Вставляет инициализацию `rootraceHost` в начало файла при первой инъекции
    - Использует `rootraceHost` в пробах для правильного определения хоста

12. **The 5-Line Rule:** Пробы не должны превышать 5-7 строк. Если нужно логировать много данных — используйте `state` с метриками (`len(array)` вместо всего массива)

13. **Метрики количества:** Всегда включайте `len(array)` и флаг `is_empty` для массивов/списков. Это критично для быстрой диагностики в UI

14. **Оптимизация импортов:** Если `json` уже импортирован в файле, не импортируйте его локально в пробе. Это делает пробу лаконичнее (2-3 строки вместо 5)

15. **Session Binding:** Включайте `sessionId` в `state` и в имена временных файлов для разделения логов разных запусков

16. **Проверка на пустоту:** Всегда включайте флаг `is_empty` в дополнение к `len()`. Это критично для быстрой диагностики в UI — пустой массив должен быть виден сразу

## Генерация проб

Пробы генерируются автоматически функцией `generateProbeCode()` в `code-injector.ts`.

### Python

Для Python используется `urllib.request` с поддержкой Docker и улучшенным логированием:
- Автоматическое определение Docker окружения через `_rootrace_host`
- Логирование в файл `~/.roo_probe_debug.log` и в консоль (stderr)
- Обработку ошибок с полным traceback
- Поддержку переменной окружения `ROO_TRACE_HOST` для переопределения хоста

### Go

Для Go используется стандартная библиотека `net/http`:
- Автоматическое определение Docker окружения через `rootraceHost`
- Асинхронное выполнение через `go func()`
- Поддержку переменной окружения `ROO_TRACE_HOST` для переопределения хоста
- Автоматическое добавление необходимых импортов

### Другие языки

Поддерживаются также JavaScript, TypeScript, Java, Rust, C++, PHP, Ruby, C#, Swift, Kotlin и другие языки. Для каждого языка используется соответствующий HTTP клиент.
