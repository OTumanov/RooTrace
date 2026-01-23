/**
 * Реестр файлов с инициализацией хоста
 * 
 * Отслеживает файлы, в которые уже была вставлена инициализация хоста
 * для Python (_rootrace_host) и Go (rootraceHost).
 */

class HostInitRegistry {
  private filesWithHostInit = new Set<string>();

  /**
   * Проверяет, была ли добавлена инициализация хоста в файл
   */
  has(filePath: string): boolean {
    return this.filesWithHostInit.has(filePath);
  }

  /**
   * Отмечает файл как имеющий инициализацию хоста
   */
  add(filePath: string): void {
    this.filesWithHostInit.add(filePath);
  }

  /**
   * Удаляет файл из реестра (при удалении всех проб)
   */
  delete(filePath: string): void {
    this.filesWithHostInit.delete(filePath);
  }

  /**
   * Очищает реестр (используется для тестирования)
   */
  clear(): void {
    this.filesWithHostInit.clear();
  }

  /**
   * Получает все файлы с инициализацией хоста
   */
  getAll(): string[] {
    return Array.from(this.filesWithHostInit);
  }
}

// Singleton экземпляр реестра
const registry = new HostInitRegistry();

/**
 * Проверяет, была ли добавлена инициализация хоста в файл
 */
export function hasHostInit(filePath: string): boolean {
  return registry.has(filePath);
}

/**
 * Отмечает файл как имеющий инициализацию хоста
 */
export function markHostInit(filePath: string): void {
  registry.add(filePath);
}

/**
 * Удаляет файл из реестра (при удалении всех проб)
 */
export function removeHostInit(filePath: string): void {
  registry.delete(filePath);
}

/**
 * Очищает реестр (используется для тестирования)
 */
export function clearHostInitRegistry(): void {
  registry.clear();
}

/**
 * Получает все файлы с инициализацией хоста
 */
export function getAllFilesWithHostInit(): string[] {
  return registry.getAll();
}
