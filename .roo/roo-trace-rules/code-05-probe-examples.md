# Probe Code Examples by Language

**Reference examples for probe code generation.**

## Python

### Variant 1: If file has `import requests` (PREFERRED)
```python
# RooTrace [id: <uuid>] H1: description
# NOTE: Use FINAL_HOST and ACTUAL_PORT from Phase 2 (e.g., "host.docker.internal" and 51235)
try:
    import requests
    requests.post('http://{{FINAL_HOST}}:{{ACTUAL_PORT}}/', json={'hypothesisId': 'H1', 'message': '...', 'state': {}}, timeout=5.0)
except: pass
# RooTrace [id: <uuid>]: end
```
**🚨 CRITICAL:** Each operator on separate line with correct indentation. This is Pylance requirement.
**For IFC/heavy operations:** use `timeout=5.0` (NOT 0.1, NOT 1.0)

### Variant 2: Isolated variant (if requests not available, but urllib available)
```python
# RooTrace [id: <uuid>] H1: description
# NOTE: Use FINAL_HOST and ACTUAL_PORT from Phase 2 discovery
try:
    import urllib.request, json
    urllib.request.urlopen(urllib.request.Request('http://{{FINAL_HOST}}:{{ACTUAL_PORT}}/', data=json.dumps({'hypothesisId': 'H1', 'message': '...', 'state': {}}).encode('utf-8'), headers={'Content-Type': 'application/json'}), timeout=5.0)
except: pass
# RooTrace [id: <uuid>]: end
```

### Variant 3: Vanilla Python (PREFERRED if unsure about imports)
```python
# RooTrace [id: <uuid>] H1: description
# NOTE: Use FINAL_HOST and ACTUAL_PORT from Phase 2 discovery (replace {{FINAL_HOST}} and {{ACTUAL_PORT}} with actual values)
try:
    import http.client, json, socket
    conn = http.client.HTTPConnection("{{FINAL_HOST}}", {{ACTUAL_PORT}})
    conn.sock = socket.create_connection(("{{FINAL_HOST}}", {{ACTUAL_PORT}}), timeout=5.0)
    conn.request("POST", "/", json.dumps({'hypothesisId': 'H1', 'message': '...', 'state': {}}), {'Content-Type': 'application/json'})
    conn.getresponse()
    conn.close()
except: pass
# RooTrace [id: <uuid>]: end
```
**🚨 CRITICAL:** Each operator on separate line with correct indentation. This is Pylance requirement.
**CRITICAL:** For IFC parsing, multithreading, and CPU-intensive tasks use `timeout=5.0` (NOT 1.0, NOT 0.1)

### Variant 3a: Optimized (if `json` already imported in file)
```python
# If file start already has: import json
# RooTrace [id: <uuid>] H1: description
try:
    import http.client, socket
    conn = http.client.HTTPConnection("{{FINAL_HOST}}", {{ACTUAL_PORT}})
    conn.sock = socket.create_connection(("{{FINAL_HOST}}", {{ACTUAL_PORT}}), timeout=5.0)
    conn.request("POST", "/", json.dumps({'hypothesisId': 'H1', 'message': '...', 'state': {}}), {'Content-Type': 'application/json'})
    conn.getresponse()
    conn.close()
except: pass
# RooTrace [id: <uuid>]: end
```
**Why this is important:** If `json` already imported in file, no need to import it locally. This makes probe more concise (2-3 import lines instead of 5). Always check imports via `read_file` before generating probe.

### Variant 4: With quantity metrics, emptiness check, and sessionId (RECOMMENDED for diagnostics)
```python
# RooTrace [id: <uuid>] H2: list processing with metrics
try:
    import http.client, json, socket, os
    state_data = {
        'input_count': len(input_items) if input_items else 0,
        'output_count': len(output_items) if output_items else 0,
        'is_empty': input_items is None or len(input_items) == 0,
        'has_nil': None in input_items if isinstance(input_items, list) else False,
        'processed': count,
        'sessionId': os.environ.get('ROO_TRACE_SESSION_ID')
    }
    conn = http.client.HTTPConnection("{{FINAL_HOST}}", {{ACTUAL_PORT}})
    conn.sock = socket.create_connection(("{{FINAL_HOST}}", {{ACTUAL_PORT}}), timeout=5.0)
    conn.request("POST", "/", json.dumps({'hypothesisId': 'H2', 'message': 'processing', 'state': state_data}), {'Content-Type': 'application/json'})
    conn.getresponse()
    conn.close()
except: pass
# RooTrace [id: <uuid>]: end
```

## Go

```go
// RooTrace [id: <uuid>] H1: description
go func() {
    serverURL := fmt.Sprintf("http://%s:%d/", "{{FINAL_HOST}}", {{ACTUAL_PORT}})
    jsonData, _ := json.Marshal(map[string]interface{}{
        "hypothesisId": "H1",
        "message": "[function name] start",
        "state": map[string]interface{}{"key": value},
    })
    req, _ := http.NewRequest("POST", serverURL, bytes.NewBuffer(jsonData))
    req.Header.Set("Content-Type", "application/json")
    client := &http.Client{Timeout: 5 * time.Second}
    client.Do(req)
}()
// RooTrace [id: <uuid>]: end
```

## JavaScript/TypeScript

```javascript
// RooTrace [id: <uuid>] H1: description
// NOTE: Use FINAL_HOST and ACTUAL_PORT from Phase 2 discovery
try {
    fetch(`http://{{FINAL_HOST}}:{{ACTUAL_PORT}}/`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({hypothesisId: 'H1', message: '...', state: {key: value}})
    }).catch(() => {});
} catch(e) {}
// RooTrace [id: <uuid>]: end
```

## CRITICAL RULES

- **FORBIDDEN:** Use `pass` instead of real code. Probe MUST send data.
- **FORBIDDEN:** Create nested probes (probe inside probe). Each probe — separate block.
- **MANDATORY:** Use FINAL_HOST and ACTUAL_PORT (NOT hardcoded localhost:51234)
- **MANDATORY:** Each operator on separate line with correct indentation (Python)
- **MANDATORY:** Use timeout 5.0 for heavy operations (NOT 1.0, NOT 0.1)
