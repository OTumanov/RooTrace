#!/usr/bin/env python3
"""
Скрипт для отладки подключения проб к серверу RooTrace.

Этот скрипт:
1. Ищет конфигурацию сервера (.ai_debug_config или .debug_port)
2. Читает URL сервера
3. Отправляет тестовый POST запрос
4. Проверяет ответ сервера
5. Логирует все шаги для диагностики
"""

import os
import sys
import json
import urllib.request
import urllib.parse
import urllib.error
import socket
import datetime
from pathlib import Path
from typing import Optional, Tuple


def log(message: str, level: str = "INFO"):
    """Логирует сообщение с временной меткой"""
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] [{level}] {message}", file=sys.stderr)


def find_workspace_root(start_path: Optional[str] = None) -> Optional[Path]:
    """Находит корень рабочей области, ища маркерные файлы"""
    if start_path is None:
        start_path = os.getcwd()
    
    current = Path(start_path).resolve()
    root = Path(current.anchor)  # Корень файловой системы
    
    log(f"Поиск корня рабочей области, начиная с: {current}")
    
    while current != root:
        # Проверяем наличие маркерных файлов
        markers = [
            current / '.ai_debug_config',
            current / '.debug_port',
            current / '.git',
            current / '.roo'
        ]
        
        for marker in markers:
            if marker.exists():
                log(f"Найден маркер: {marker}")
                return current
        
        # Поднимаемся на уровень выше
        parent = current.parent
        if parent == current:
            break
        current = parent
    
    log("Корень рабочей области не найден", "WARNING")
    return None


def read_debug_port(workspace_root: Path) -> Optional[int]:
    """Читает порт из .debug_port файла"""
    port_file = workspace_root / '.debug_port'
    
    if not port_file.exists():
        log(f"Файл .debug_port не найден: {port_file}")
        return None
    
    try:
        content = port_file.read_text(encoding='utf-8').strip()
        port = int(content)
        log(f"Прочитан порт из .debug_port: {port}")
        return port
    except (ValueError, IOError) as e:
        log(f"Ошибка чтения .debug_port: {e}", "ERROR")
        return None


def read_ai_debug_config(workspace_root: Path) -> Optional[str]:
    """Читает URL из .ai_debug_config файла (пробует как JSON, если не получается - возвращает None)"""
    config_file = workspace_root / '.ai_debug_config'
    
    if not config_file.exists():
        log(f"Файл .ai_debug_config не найден: {config_file}")
        return None
    
    try:
        content = config_file.read_text(encoding='utf-8').strip()
        log(f"Прочитан .ai_debug_config, размер: {len(content)} байт")
        
        # Пробуем распарсить как JSON (для незашифрованных конфигов)
        try:
            config = json.loads(content)
            if isinstance(config, dict) and 'url' in config:
                url = config['url']
                log(f"Прочитан URL из JSON конфига: {url}")
                return url
        except json.JSONDecodeError:
            log("Конфиг не является JSON (возможно, зашифрован). Пропускаем расшифровку.", "WARNING")
            # Для зашифрованных конфигов нужен ключ шифрования, который мы не можем получить из Python
            # Поэтому возвращаем None и будем использовать .debug_port
            return None
    except IOError as e:
        log(f"Ошибка чтения .ai_debug_config: {e}", "ERROR")
        return None
    
    return None


def get_server_url(workspace_root: Optional[Path] = None) -> Optional[str]:
    """Получает URL сервера из конфигурации"""
    if workspace_root is None:
        workspace_root = find_workspace_root()
        if workspace_root is None:
            log("Не удалось найти корень рабочей области", "ERROR")
            return None
    
    log(f"Поиск конфигурации сервера в: {workspace_root}")
    
    # Сначала пробуем .ai_debug_config
    url = read_ai_debug_config(workspace_root)
    if url:
        return url
    
    # Если не получилось, пробуем .debug_port
    port = read_debug_port(workspace_root)
    if port:
        url = f"http://localhost:{port}/"
        log(f"Сформирован URL из порта: {url}")
        return url
    
    # Fallback на стандартный порт
    default_port = 51234
    url = f"http://localhost:{default_port}/"
    log(f"Используется стандартный порт: {url}", "WARNING")
    return url


def test_server_connection(url: str) -> Tuple[bool, str]:
    """Тестирует подключение к серверу"""
    log(f"Тестирование подключения к серверу: {url}")
    
    # Парсим URL
    try:
        parsed = urllib.parse.urlparse(url)
        hostname = parsed.hostname or 'localhost'
        port = parsed.port or (80 if parsed.scheme == 'http' else 443)
        path = parsed.path or '/'
        
        log(f"Парсинг URL: hostname={hostname}, port={port}, path={path}")
    except Exception as e:
        return False, f"Ошибка парсинга URL: {e}"
    
    # Проверяем доступность хоста
    log(f"Проверка доступности хоста {hostname}:{port}")
    try:
        sock = socket.create_connection((hostname, port), timeout=5.0)
        sock.close()
        log("Хост доступен")
    except socket.timeout:
        return False, f"Таймаут подключения к {hostname}:{port}"
    except socket.error as e:
        return False, f"Ошибка подключения к {hostname}:{port}: {e}"
    
    # Отправляем тестовый POST запрос
    test_data = {
        'hypothesisId': 'H1',
        'message': 'Test probe connection from Python script',
        'state': {
            'test': True,
            'source': 'test-probe-connection.py',
            'timestamp': datetime.datetime.now().isoformat()
        }
    }
    
    json_data = json.dumps(test_data).encode('utf-8')
    log(f"Отправка POST запроса, размер данных: {len(json_data)} байт")
    log(f"Данные: {json.dumps(test_data, indent=2)}")
    
    try:
        req = urllib.request.Request(
            url,
            data=json_data,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        
        log("Выполнение HTTP запроса...")
        with urllib.request.urlopen(req, timeout=10.0) as response:
            status_code = response.getcode()
            response_data = response.read().decode('utf-8')
            
            log(f"Получен ответ: статус {status_code}")
            log(f"Тело ответа: {response_data}")
            
            if status_code == 200:
                try:
                    response_json = json.loads(response_data)
                    log(f"Ответ в формате JSON: {json.dumps(response_json, indent=2)}")
                except json.JSONDecodeError:
                    log("Ответ не является JSON", "WARNING")
                
                return True, f"Успешно! Статус: {status_code}, ответ: {response_data}"
            else:
                return False, f"Сервер вернул статус {status_code}: {response_data}"
                
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8') if hasattr(e, 'read') else str(e)
        log(f"HTTP ошибка: {e.code} - {error_body}", "ERROR")
        return False, f"HTTP ошибка {e.code}: {error_body}"
    except urllib.error.URLError as e:
        log(f"URL ошибка: {e}", "ERROR")
        return False, f"URL ошибка: {e}"
    except socket.timeout:
        log("Таймаут HTTP запроса", "ERROR")
        return False, "Таймаут HTTP запроса"
    except Exception as e:
        log(f"Неожиданная ошибка: {type(e).__name__}: {e}", "ERROR")
        import traceback
        log(traceback.format_exc(), "ERROR")
        return False, f"Неожиданная ошибка: {type(e).__name__}: {e}"


def check_probe_logs() -> Optional[str]:
    """Проверяет файл логов проб, если он существует"""
    log_file = Path.home() / '.roo_probe_debug.log'
    
    if not log_file.exists():
        log(f"Файл логов проб не найден: {log_file}")
        return None
    
    try:
        content = log_file.read_text(encoding='utf-8')
        lines = content.strip().split('\n')
        log(f"Найден файл логов проб: {log_file}, строк: {len(lines)}")
        
        if lines:
            log("Последние 10 строк из логов проб:")
            for line in lines[-10:]:
                log(f"  {line}")
            
            return content
        else:
            log("Файл логов проб пуст")
            return None
    except Exception as e:
        log(f"Ошибка чтения файла логов проб: {e}", "ERROR")
        return None


def main():
    """Главная функция"""
    log("=" * 60)
    log("Запуск теста подключения проб к серверу RooTrace")
    log("=" * 60)
    
    # Проверяем логи проб, если они есть
    probe_logs = check_probe_logs()
    if probe_logs:
        log("=" * 60)
        log("Обнаружены логи проб. Это означает, что код проб выполняется.")
        log("=" * 60)
    
    # Получаем URL сервера
    workspace_root = find_workspace_root()
    if workspace_root:
        log(f"Корень рабочей области: {workspace_root}")
    else:
        log("Корень рабочей области не найден, используем текущую директорию", "WARNING")
        workspace_root = Path.cwd()
    
    url = get_server_url(workspace_root)
    if not url:
        log("Не удалось получить URL сервера", "ERROR")
        sys.exit(1)
    
    log(f"URL сервера: {url}")
    
    # Тестируем подключение
    success, message = test_server_connection(url)
    
    log("=" * 60)
    if success:
        log("✅ ТЕСТ ПРОЙДЕН: Подключение к серверу работает!", "SUCCESS")
        log(f"Результат: {message}")
        log("")
        log("РЕКОМЕНДАЦИИ:")
        log("1. Если код проб не пишет в логи, проверьте:")
        log("   - Выполняется ли код до места вставки пробы")
        log("   - Правильно ли вставлена проба в код")
        log("   - Нет ли синтаксических ошибок в коде пробы")
        log("2. Проверьте файл ~/.roo_probe_debug.log для детальных логов проб")
        log("3. Убедитесь, что HTTP сервер запущен (проверьте Output Channel в VS Code)")
        sys.exit(0)
    else:
        log("❌ ТЕСТ НЕ ПРОЙДЕН: Подключение к серверу не работает!", "ERROR")
        log(f"Ошибка: {message}")
        log("")
        log("РЕКОМЕНДАЦИИ:")
        log("1. Убедитесь, что HTTP сервер запущен:")
        log("   - Откройте Output Channel 'AI Debugger' в VS Code")
        log("   - Проверьте, что сервер запущен на порту из .debug_port")
        log("2. Проверьте, что порт не занят другим процессом")
        log("3. Попробуйте перезапустить расширение RooTrace")
        sys.exit(1)


if __name__ == '__main__':
    main()
