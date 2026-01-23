# Анализ общих утилит и дублирования кода

## 🎯 Цель
Выявить все общие утилиты, дублирование кода и паттерны перед рефакторингом монофайлов. Это позволит:
1. Создать общие модули один раз
2. Избежать дублирования при рефакторинге
3. Улучшить архитектуру проекта

---

## 📊 Найденные дублирования

### 1. 🔴 КРИТИЧНО: Получение Workspace Root (дублируется в 4 местах)

#### Варианты реализации:

**A. `code-injector.ts` - `getProjectRoot()`**
```typescript
function getProjectRoot(): string {
  if (vscode) {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        return workspaceFolders[0].uri.fsPath;
      }
    } catch (e) {
      // Игнорируем ошибки при доступе к workspace в MCP контексте
    }
  }
  return process.cwd();
}
```

**B. `mcp-handler.ts` - `getWorkspaceRootForFiles()`**
```typescript
private getWorkspaceRootForFiles(): string {
  const envWorkspace = process.env.ROO_TRACE_WORKSPACE || process.env.ROO_TRACE_WORKSPACE_ROOT;
  if (envWorkspace && typeof envWorkspace === 'string' && envWorkspace.trim().length > 0) {
    return envWorkspace.trim();
  }
  return process.cwd();
}
```

**C. `rules-loader.ts` - `getWorkspaceRoot()`**
```typescript
private static getWorkspaceRoot(): string | null {
  const envWorkspace = process.env.ROO_TRACE_WORKSPACE || process.env.ROO_TRACE_WORKSPACE_ROOT;
  if (envWorkspace && typeof envWorkspace === 'string' && envWorkspace.trim().length > 0) {
    return envWorkspace.trim();
  }
  if (vscode) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      return workspaceFolders[0].uri.fsPath;
    }
  }
  return process.cwd();
}
```

**D. `rootrace-dir-utils.ts` - внутри `getRootraceDir()`**
```typescript
const envWorkspace = process.env.ROO_TRACE_WORKSPACE || process.env.ROO_TRACE_WORKSPACE_ROOT;
if (envWorkspace && typeof envWorkspace === 'string' && envWorkspace.trim().length > 0) {
  workspaceRoot = envWorkspace.trim();
} else if (vscode) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    workspaceRoot = workspaceFolders[0].uri.fsPath;
  } else {
    workspaceRoot = process.cwd();
  }
} else {
  workspaceRoot = process.cwd();
}
```

#### Проблемы:
- ❌ Разная логика приоритетов (env vs vscode)
- ❌ Разные возвращаемые типы (string vs string | null)
- ❌ Дублирование ~15-20 строк в каждом месте
- ❌ Сложно поддерживать - изменения нужно делать в 4 местах

#### Решение:
Создать `src/utils/workspace-utils.ts`:
```typescript
export function getWorkspaceRoot(): string {
  // Приоритет 1: переменная окружения (для MCP сервера)
  const envWorkspace = process.env.ROO_TRACE_WORKSPACE || process.env.ROO_TRACE_WORKSPACE_ROOT;
  if (envWorkspace && typeof envWorkspace === 'string' && envWorkspace.trim().length > 0) {
    return envWorkspace.trim();
  }
  
  // Приоритет 2: VS Code workspace
  if (vscode) {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        return workspaceFolders[0].uri.fsPath;
      }
    } catch (e) {
      // Игнорируем ошибки при доступе к workspace в MCP контексте
    }
  }
  
  // Fallback: текущая директория
  return process.cwd();
}
```

**Экономия**: ~60-80 строк дублированного кода

---

### 2. 🔴 КРИТИЧНО: Парсинг JSON с fallback на дешифровку (дублируется в 4+ местах)

#### Паттерн повторяется в:

**A. `extension.ts` - `loadAIDebugConfig()`**
```typescript
try {
  config = JSON.parse(configContent);
} catch (parseError) {
  try {
    const encryptionKey = getEncryptionKey();
    config = decryptObject(configContent, encryptionKey);
  } catch (decryptError) {
    // handle error
  }
}
```

**B. `code-injector.ts` - `getServerUrl()`**
```typescript
try {
  config = JSON.parse(configContent);
} catch (parseError) {
  try {
    const encryptionKey = getEncryptionKey();
    config = decryptObject(configContent, encryptionKey);
  } catch (decryptError) {
    config = null;
  }
}
```

**C. `shared-log-storage.ts` - `loadFromFile()`**
```typescript
try {
  const parsed = JSON.parse(fileContent);
  logs = Array.isArray(parsed) ? parsed : [];
} catch (parseError) {
  try {
    const encryptionKey = getEncryptionKey();
    const decrypted = decryptObject(fileContent, encryptionKey);
    logs = Array.isArray(decrypted) ? decrypted : [];
  } catch (decryptError) {
    // handle error
  }
}
```

**D. `session-manager.ts` - `loadSessions()`**
```typescript
try {
  data = JSON.parse(content);
} catch (parseError) {
  try {
    const encryptionKey = getEncryptionKey();
    data = decryptObject(content, encryptionKey);
  } catch (decryptError) {
    // handle error
  }
}
```

#### Проблемы:
- ❌ Один и тот же паттерн повторяется 4+ раза
- ❌ Разная обработка ошибок
- ❌ Дублирование ~10-15 строк в каждом месте

#### Решение:
Создать `src/utils/config-parser.ts`:
```typescript
/**
 * Парсит конфигурацию с fallback на дешифровку
 * @param content Содержимое файла (JSON или зашифрованное)
 * @param defaultValue Значение по умолчанию при ошибке
 * @returns Распарсенный объект или defaultValue
 */
export function parseConfigOrDecrypt<T>(
  content: string,
  defaultValue: T
): T {
  try {
    return JSON.parse(content) as T;
  } catch (parseError) {
    try {
      const encryptionKey = getEncryptionKey();
      return decryptObject(content, encryptionKey) as T;
    } catch (decryptError) {
      return defaultValue;
    }
  }
}
```

**Экономия**: ~40-60 строк дублированного кода

---

### 3. 🟡 СРЕДНЕ: Условный импорт vscode (дублируется в 3 местах)

#### Повторяется в:
- `code-injector.ts`
- `rootrace-dir-utils.ts`
- `rules-loader.ts`

#### Паттерн:
```typescript
let vscode: typeof import('vscode') | undefined;
try {
  vscode = require('vscode');
} catch (e) {
  vscode = undefined;
}
```

#### Решение:
Создать `src/utils/vscode-loader.ts`:
```typescript
let vscodeInstance: typeof import('vscode') | undefined;

export function getVSCode(): typeof import('vscode') | undefined {
  if (vscodeInstance !== undefined) {
    return vscodeInstance;
  }
  
  try {
    vscodeInstance = require('vscode');
  } catch (e) {
    vscodeInstance = undefined;
  }
  
  return vscodeInstance;
}
```

**Экономия**: ~15-20 строк дублированного кода

---

### 4. 🟡 СРЕДНЕ: Нормализация путей файлов (дублируется в 2 местах)

#### Варианты:

**A. `mcp-handler.ts` - `normalizeFilePath()`**
```typescript
private normalizeFilePath(filePath: string): string {
  return filePath.startsWith('@') ? filePath.substring(1) : filePath;
}
```

**B. `code-injector.ts` - `sanitizeFilePath()`**
```typescript
function sanitizeFilePath(inputPath: string): string {
  PROJECT_ROOT = getProjectRoot();
  const resolved = path.resolve(PROJECT_ROOT, inputPath);
  const normalized = path.normalize(resolved);
  if (!normalized.startsWith(PROJECT_ROOT + path.sep)) {
    throw new Error(`Invalid file path: path traversal detected (${inputPath})`);
  }
  return normalized;
}
```

#### Проблемы:
- ❌ Разная функциональность (нормализация vs валидация)
- ❌ Можно объединить в один модуль

#### Решение:
Создать `src/utils/file-path-utils.ts`:
```typescript
/**
 * Нормализует путь файла (удаляет @ в начале)
 */
export function normalizeFilePath(filePath: string): string {
  return filePath.startsWith('@') ? filePath.substring(1) : filePath;
}

/**
 * Валидирует и нормализует путь файла с защитой от path traversal
 */
export function sanitizeFilePath(inputPath: string, workspaceRoot: string): string {
  const normalized = normalizeFilePath(inputPath);
  const resolved = path.resolve(workspaceRoot, normalized);
  const finalPath = path.normalize(resolved);
  
  if (!finalPath.startsWith(workspaceRoot + path.sep)) {
    throw new Error(`Invalid file path: path traversal detected (${inputPath})`);
  }
  
  return finalPath;
}
```

**Экономия**: ~10-15 строк + улучшение безопасности

---

### 5. 🟢 НИЗКО: Поиск корня git репозитория

#### Используется в:
- `mcp-handler.ts` - `findGitRoot()`

#### Решение:
Вынести в `src/utils/git-utils.ts` для переиспользования

---

### 6. 🟢 НИЗКО: Поиск workspace root от файла

#### Используется в:
- `code-injector.ts` - `findWorkspaceRoot()`

#### Решение:
Вынести в `src/utils/workspace-utils.ts`

---

## 📦 Предлагаемая структура общих утилит

```
src/utils/
├── workspace-utils.ts      # Получение workspace root (объединяет 4 варианта)
├── config-parser.ts        # Парсинг JSON с fallback на дешифровку
├── vscode-loader.ts        # Условный импорт vscode
├── file-path-utils.ts      # Нормализация и валидация путей
├── git-utils.ts            # Работа с git (findGitRoot)
└── index.ts                # Экспорты всех утилит
```

---

## 📊 Статистика дублирования

| Категория | Дублирование | Файлов | Строк кода | Приоритет |
|-----------|--------------|--------|------------|-----------|
| Workspace Root | 4 варианта | 4 | ~60-80 | 🔴 КРИТИЧНО |
| JSON/Decrypt парсинг | 4+ места | 4 | ~40-60 | 🔴 КРИТИЧНО |
| VSCode импорт | 3 места | 3 | ~15-20 | 🟡 СРЕДНЕ |
| Нормализация путей | 2 варианта | 2 | ~10-15 | 🟡 СРЕДНЕ |
| Git утилиты | 1 место | 1 | ~20-30 | 🟢 НИЗКО |

**Итого дублирования**: ~145-205 строк кода

---

## 🎯 План действий

### Этап 0: Вынесение общих утилит (ПЕРЕД рефакторингом монофайлов)

#### Шаг 1: Создать структуру `src/utils/` (1 день)
1. Создать директорию `src/utils/`
2. Создать `workspace-utils.ts` - объединить все варианты получения workspace root
3. Создать `config-parser.ts` - унифицировать парсинг JSON/дешифровку
4. Создать `vscode-loader.ts` - централизовать импорт vscode
5. Создать `file-path-utils.ts` - объединить нормализацию и валидацию путей
6. Создать `git-utils.ts` - вынести git утилиты
7. Создать `index.ts` - экспорты

#### Шаг 2: Рефакторинг существующих файлов (2-3 дня)
1. Обновить `code-injector.ts` - использовать общие утилиты
2. Обновить `mcp-handler.ts` - использовать общие утилиты
3. Обновить `rules-loader.ts` - использовать общие утилиты
4. Обновить `rootrace-dir-utils.ts` - использовать общие утилиты
5. Обновить `extension.ts` - использовать общие утилиты
6. Обновить `shared-log-storage.ts` - использовать общие утилиты
7. Обновить `session-manager.ts` - использовать общие утилиты

#### Шаг 3: Тестирование (1 день)
1. Запустить все тесты
2. Проверить компиляцию
3. Проверить линтер
4. Интеграционное тестирование

---

## ✅ Преимущества подхода

1. **Единая точка изменений** - изменения в логике workspace root делаются в одном месте
2. **Улучшенная безопасность** - единая валидация путей
3. **Упрощение рефакторинга** - при разбиении монофайлов уже будут готовы утилиты
4. **Лучшая тестируемость** - утилиты можно тестировать изолированно
5. **Меньше кода** - удаление ~145-205 строк дублирования

---

## ⚠️ Риски

1. **Риск**: Изменение логики может сломать существующий код
   - **Митигация**: Тщательное тестирование, пошаговая миграция

2. **Риск**: Разные файлы используют разные варианты логики намеренно
   - **Митигация**: Анализ каждого использования перед объединением

3. **Риск**: Циклические зависимости
   - **Митигация**: Правильное проектирование зависимостей

---

## 🎯 Рекомендация

**ДА, стоит сначала вынести общие утилиты!**

Это даст:
- ✅ Упрощение последующего рефакторинга монофайлов
- ✅ Улучшение архитектуры проекта
- ✅ Уменьшение дублирования кода
- ✅ Единые точки изменений

**Порядок действий:**
1. **Этап 0**: Вынести общие утилиты (4-5 дней)
2. **Этап 1**: Рефакторинг `mcp-handler.ts` (используя новые утилиты)
3. **Этап 2**: Рефакторинг `code-injector.ts` (используя новые утилиты)
4. **Этап 3**: Рефакторинг `extension.ts` (используя новые утилиты)

---

## 📝 Следующие шаги

1. Создать план детального рефакторинга утилит
2. Начать с самого критичного - workspace-utils.ts
3. Постепенно мигрировать все файлы
4. После завершения - продолжить рефакторинг монофайлов
