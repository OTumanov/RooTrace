/**
 * Константы для тестов
 */

// Таймауты для асинхронных операций (в миллисекундах)
export const LOG_SAVE_TIMEOUT = 300; // Время на сохранение одного лога
export const FILE_SYNC_TIMEOUT = 500; // Время на синхронизацию файла
export const HIGH_LOAD_TIMEOUT = 1000; // Время на сохранение большого количества логов
export const WATCHER_TIMEOUT = 1000; // Время на обработку fs.watchFile

// Короткие задержки для инициализации и синхронизации
export const INIT_DELAY = 50; // Задержка для инициализации компонентов
export const SHORT_DELAY = 100; // Короткая задержка для простых операций
export const MEDIUM_DELAY = 200; // Средняя задержка для операций сохранения
export const LONG_DELAY = 500; // Длинная задержка для сложных операций

// Задержки для тестов файловых блокировок
export const LOCK_TEST_DELAY_SHORT = 10; // Короткая задержка для тестов блокировок
export const LOCK_TEST_DELAY_MEDIUM = 30; // Средняя задержка для тестов блокировок
export const LOCK_TEST_DELAY_LONG = 50; // Длинная задержка для тестов блокировок
export const LOCK_TEST_DELAY_VERY_LONG = 100; // Очень длинная задержка для тестов блокировок

// Количество повторных попыток для проверки асинхронных операций
export const MAX_RETRY_ATTEMPTS = 5;
export const RETRY_DELAY = 200; // Задержка между попытками (в миллисекундах)
