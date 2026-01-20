#!/usr/bin/env python3
"""
Тестовый скрипт для проверки работы кода пробы.

Этот скрипт содержит пример кода пробы, который должен быть вставлен в ваш код.
Запустите его, чтобы проверить, работает ли код пробы.
"""

# Пример кода пробы, который генерируется для Python
# Скопируйте этот код в ваш файл и запустите его

try:
    import urllib.request, json, os, traceback, sys
    log_file = os.path.expanduser('~/.roo_probe_debug.log')
    server_url = 'http://localhost:51234/'
    log_msg = f"Probe EXECUTING: H1 - Test probe code, URL: {server_url}\n"
    open(log_file, 'a').write(log_msg)
    sys.stderr.write(f"[RooTrace Probe] {log_msg}")
    req = urllib.request.Request(
        server_url,
        data=json.dumps({'hypothesisId': 'H1', 'message': 'Test probe code', 'state': {}}).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    resp = urllib.request.urlopen(req, timeout=5.0)
    success_msg = f"Probe SUCCESS: H1 - status={resp.getcode()}, URL={server_url}\n"
    open(log_file, 'a').write(success_msg)
    sys.stderr.write(f"[RooTrace Probe] {success_msg}")
    print(f"✅ Probe executed successfully! Status: {resp.getcode()}")
    print(f"📝 Check log file: {log_file}")
except Exception as e:
    log_file = os.path.expanduser('~/.roo_probe_debug.log')
    import traceback
    error_msg = f"Probe ERROR: H1 - {type(e).__name__}: {str(e)}\n{traceback.format_exc()}\n"
    open(log_file, 'a').write(error_msg)
    sys.stderr.write(f"[RooTrace Probe ERROR] {error_msg}")
    print(f"❌ Probe failed: {type(e).__name__}: {str(e)}")
    print(f"📝 Check log file: {log_file}")
    print(f"📋 Full traceback:\n{traceback.format_exc()}")
