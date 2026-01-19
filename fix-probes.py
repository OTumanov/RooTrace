#!/usr/bin/env python3
"""
Скрипт для исправления timeout в пробах.
Заменяет timeout=1.0 на timeout=5.0 во всех пробах.
"""

import re
import sys
from pathlib import Path

def fix_probes_in_file(file_path: Path) -> int:
    """Исправляет timeout в пробах в указанном файле."""
    if not file_path.exists():
        print(f"File not found: {file_path}")
        return 0
    
    content = file_path.read_text(encoding='utf-8')
    original_content = content
    
    # Заменяем timeout=1.0 на timeout=5.0 в пробах
    # Ищем паттерн: timeout=1.0 в контексте проб
    patterns = [
        (r'timeout=1\.0', 'timeout=5.0'),  # Простая замена
        (r'socket\.create_connection\(\([^)]+\),\s*timeout=1\.0\)', 
         lambda m: m.group(0).replace('timeout=1.0', 'timeout=5.0')),  # В socket.create_connection
        (r'requests\.post\([^)]+timeout=1\.0', 
         lambda m: m.group(0).replace('timeout=1.0', 'timeout=5.0')),  # В requests.post
        (r'urllib\.request\.urlopen\([^)]+timeout=1\.0', 
         lambda m: m.group(0).replace('timeout=1.0', 'timeout=5.0')),  # В urllib.request.urlopen
    ]
    
    count = 0
    for pattern in patterns:
        if callable(pattern[1]):
            # Функция замены
            matches = list(re.finditer(pattern[0], content))
            for match in reversed(matches):  # Обратный порядок чтобы не сломать индексы
                content = content[:match.start()] + pattern[1](match) + content[match.end():]
                count += 1
        else:
            # Простая замена
            new_count = len(re.findall(pattern[0], content))
            content = content.replace(pattern[0], pattern[1])
            count += new_count
    
    if content != original_content:
        file_path.write_text(content, encoding='utf-8')
        print(f"Fixed {count} timeout values in {file_path}")
        return count
    else:
        print(f"No timeout=1.0 found in {file_path}")
        return 0

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python fix-probes.py <file_path>")
        sys.exit(1)
    
    file_path = Path(sys.argv[1])
    fix_probes_in_file(file_path)
