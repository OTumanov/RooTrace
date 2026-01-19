# Примеры кода проб для тестирования

## Пример 1: http.client (как в вашем коде)
```python
try:
    import http.client, json, socket
    conn = http.client.HTTPConnection("localhost", 51234)
    conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0)
    conn.request("POST", "/", json.dumps({'hypothesisId': 'H1', 'message': 'test from http.client', 'state': {'test': True, 'method': 'http.client'}}), {'Content-Type': 'application/json'})
    conn.getresponse()
    conn.close()
except:
    pass
```

## Пример 2: requests (если установлен)
```python
try:
    import requests
    requests.post('http://localhost:51234/', json={'hypothesisId': 'H2', 'message': 'test from requests', 'state': {'test': True, 'method': 'requests', 'timeout': 5.0}}, timeout=5.0)
except:
    pass
```

## Пример 3: urllib.request
```python
try:
    import urllib.request, json
    urllib.request.urlopen(urllib.request.Request('http://localhost:51234/', data=json.dumps({'hypothesisId': 'H3', 'message': 'test from urllib', 'state': {'test': True, 'method': 'urllib'}}).encode('utf-8'), headers={'Content-Type': 'application/json'}), timeout=5.0)
except:
    pass
```

## Пример 4: http.client с дополнительными данными
```python
try:
    import http.client, json, socket, time
    start_time = time.time()
    conn = http.client.HTTPConnection("localhost", 51234)
    conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0)
    conn.request("POST", "/", json.dumps({'hypothesisId': 'H4', 'message': 'test with timing', 'state': {'test': True, 'method': 'http.client', 'start_time': start_time, 'elapsed': 0}}), {'Content-Type': 'application/json'})
    conn.getresponse()
    conn.close()
    elapsed = time.time() - start_time
except:
    pass
```

## Пример 5: Минимальный вариант (одна строка)
```python
try: import http.client, json, socket; conn = http.client.HTTPConnection("localhost", 51234); conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0); conn.request("POST", "/", json.dumps({'hypothesisId': 'H5', 'message': 'minimal test', 'state': {'test': True}}), {'Content-Type': 'application/json'}); conn.getresponse(); conn.close() except: pass
```

## Пример 6: С обработкой ошибок и логированием
```python
try:
    import http.client, json, socket
    conn = http.client.HTTPConnection("localhost", 51234)
    conn.sock = socket.create_connection(("localhost", 51234), timeout=5.0)
    payload = json.dumps({
        'hypothesisId': 'TEST',
        'message': 'test with error handling',
        'state': {
            'test': True,
            'method': 'http.client',
            'timestamp': __import__('datetime').datetime.now().isoformat()
        }
    })
    conn.request("POST", "/", payload, {'Content-Type': 'application/json'})
    response = conn.getresponse()
    response.read()  # Читаем ответ
    conn.close()
except Exception as e:
    # В реальной пробе здесь просто pass, но для теста можно залогировать
    pass
```
