#!/usr/bin/env python3
"""
Тестовый скрипт для проверки подключения проб к серверу.
Показывает реальные ошибки подключения.
"""

import http.client
import json
import socket
import sys
from pathlib import Path

def test_probe_connection(port=51234, timeout=5.0):
    """Тестирует подключение пробы к серверу."""
    print(f"Testing connection to localhost:{port} with timeout={timeout}...")
    
    try:
        print("1. Creating HTTPConnection...")
        conn = http.client.HTTPConnection("localhost", port, timeout=timeout)
        
        print("2. Creating socket connection...")
        conn.sock = socket.create_connection(("localhost", port), timeout=timeout)
        
        print("3. Preparing request data...")
        data = {
            'hypothesisId': 'TEST',
            'message': 'test connection from script',
            'state': {'test': True, 'timeout': timeout}
        }
        json_data = json.dumps(data)
        headers = {'Content-Type': 'application/json'}
        
        print(f"4. Sending POST request (body size: {len(json_data)} bytes)...")
        conn.request("POST", "/", json_data, headers)
        
        print("5. Getting response...")
        response = conn.getresponse()
        response_body = response.read()
        
        print(f"6. Response status: {response.status}")
        print(f"7. Response body: {response_body.decode('utf-8')}")
        
        conn.close()
        print("✅ SUCCESS: Request sent and received!")
        return True
        
    except socket.timeout:
        print(f"❌ ERROR: Connection timeout after {timeout} seconds")
        print("   The server might not be running or port might be wrong")
        return False
    except ConnectionRefusedError:
        print(f"❌ ERROR: Connection refused")
        print(f"   Server is not running on port {port}")
        print("   Check if VS Code extension is active")
        return False
    except OSError as e:
        print(f"❌ ERROR: OS Error: {e}")
        if e.errno == 61:  # Connection refused
            print(f"   Server is not running on port {port}")
        return False
    except Exception as e:
        print(f"❌ ERROR: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False

def check_port_file(workspace_path=None):
    """Проверяет файл .debug_port для определения реального порта."""
    if workspace_path:
        port_file = Path(workspace_path) / '.debug_port'
    else:
        # Пробуем найти в текущей директории
        port_file = Path('.debug_port')
    
    if port_file.exists():
        try:
            port = int(port_file.read_text().strip())
            print(f"Found .debug_port file: port {port}")
            return port
        except Exception as e:
            print(f"Error reading .debug_port: {e}")
    
    return None

if __name__ == '__main__':
    port = 51234
    timeout = 5.0
    
    # Пробуем прочитать порт из файла
    if len(sys.argv) > 1:
        workspace_path = sys.argv[1]
        found_port = check_port_file(workspace_path)
        if found_port:
            port = found_port
    
    print(f"=" * 60)
    print(f"Probe Connection Test")
    print(f"=" * 60)
    print(f"Target: http://localhost:{port}/")
    print(f"Timeout: {timeout}s")
    print(f"=" * 60)
    print()
    
    success = test_probe_connection(port, timeout)
    
    print()
    print(f"=" * 60)
    if success:
        print("✅ Test PASSED - probes should work!")
    else:
        print("❌ Test FAILED - probes won't work!")
        print()
        print("Possible solutions:")
        print("1. Make sure VS Code extension is active")
        print("2. Check Output channel 'AI Debugger' for server status")
        print("3. Verify server is listening on the correct port")
        print("4. Try increasing timeout if operations are heavy")
    print(f"=" * 60)
