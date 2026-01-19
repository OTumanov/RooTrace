# Примеры проб (инъекций в код) для тестирования

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

## Важные замечания:

1. **Timeout для тяжелых операций:** Для IFC-парсинга, многопоточности и CPU-intensive задач используйте `timeout=5.0` (НЕ 1.0, НЕ 0.1)

2. **Timeout для быстрых операций:** Для простых проверок можно использовать `timeout=0.1`

3. **Всегда оборачивайте в try-except:** Пробы не должны нарушать работу основного кода

4. **Используйте уникальные ID:** Каждая проба должна иметь уникальный `[id: ...]` для идентификации

5. **Маркеры начала и конца:** Всегда закрывайте пробы маркером `# RooTrace [id: ...]: end`

6. **Формат данных:** `state` должен быть сериализуемым JSON (dict, list, числа, строки)

7. **Гипотезы:** Используйте H1-H5 для разных типов измерений (H1 - общее, H2 - детали, H3 - элементы, H4 - цвета, H5 - прочее)
