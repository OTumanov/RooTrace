# Задача 006: Проверить статус контроля доступа к логам

## Что нужно проверить

Проверить файлы [`src/config/approval-manager.ts`](../../src/config/approval-manager.ts) и [`src/mcp-handler/security/approval-checker.ts`](../../src/mcp-handler/security/approval-checker.ts) на наличие исправления контроля доступа.

**Конкретные проверки:**
1. Интерфейс `Approval` содержит уникальный токен (UUID)
2. Интерфейс `Approval` содержит nonce
3. Интерфейс `Approval` содержит requestId
4. Интерфейс `Approval` содержит expiresAt
5. Реализовано гарантированное удаление токена после использования

## Как протестировать

### Тест 1: Проверка генерации токена
```bash
# Запустить тест
npm test -- tests/approval-token-generation.test.ts
```

### Тест 2: Проверка удаления токена
```bash
# Запустить тест
node -e "
const { ApprovalManager } = require('./src/config/approval-manager.ts');
// Создать токен
# Использовать токен
# Проверить что токен удален
"
```

**Лимит:** Макс. 100 строк лога или 30 секунд выполнения

**Ожидаемый результат:** Токен содержит UUID, nonce, requestId, expiresAt, удаляется после использования
