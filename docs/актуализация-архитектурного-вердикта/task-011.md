# Задача 011: Проверить статус Phase 1 (существование директорий)

## Что нужно проверить

Проверить существование всех требуемых директорий Phase 1.

**Конкретные проверки:**
1. Директория [`src/extension-core/`](../../src/extension-core/) существует
2. Директория [`src/dashboard/`](../../src/dashboard/) существует
3. Директория [`src/server/`](../../src/server/) существует
4. Директория [`src/websocket/`](../../src/websocket/) существует
5. Директория [`src/config/`](../../src/config/) существует
6. Директория [`src/logging/`](../../src/logging/) существует
7. Директория [`src/commands/`](../../src/commands/) существует

## Как протестировать

### Тест 1: Проверка существования директорий
```bash
# Проверить существование всех директорий
ls -la src/extension-core/
ls -la src/dashboard/
ls -la src/server/
ls -la src/websocket/
ls -la src/config/
ls -la src/logging/
ls -la src/commands/
```

**Лимит:** Макс. 100 строк лога или 30 секунд выполнения

**Ожидаемый результат:** Все директории существуют
