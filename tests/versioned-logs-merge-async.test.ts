import { VersionedLogStore } from '../src/versioned-logs';
import * as fs from 'fs';

// Тип для RuntimeLog (должен соответствовать типу из src/types.ts)
interface RuntimeLog {
    timestamp: string;
    hypothesisId: string;
    context: string;
    data: any;
}

describe('VersionedLogStore.mergeLogsWithoutBlocking', () => {
    const testFilePath = '/tmp/test-merge-logs-async.json';

    afterEach(() => {
        if (fs.existsSync(testFilePath)) {
            fs.unlinkSync(testFilePath);
        }
    });

    /**
     * Тест 1: Базовый функционал слияния
     */
    test('should merge logs correctly with basic functionality', async () => {
        const existingLogs: RuntimeLog[] = [
            { timestamp: '2024-01-01T00:00:00.000Z', hypothesisId: 'H1', context: 'Test 1', data: {} },
            { timestamp: '2024-01-01T00:01:00.000Z', hypothesisId: 'H2', context: 'Test 2', data: {} }
        ];

        const newLogs: RuntimeLog[] = [
            { timestamp: '2024-01-01T00:02:00.000Z', hypothesisId: 'H3', context: 'Test 3', data: {} },
            { timestamp: '2024-01-01T00:03:00.000Z', hypothesisId: 'H4', context: 'Test 4', data: {} }
        ];

        // Сначала запишем существующие логи в файл
        await VersionedLogStore.replaceLogs(testFilePath, existingLogs);

        // Сливаем логи
        const result = await VersionedLogStore.mergeLogs(testFilePath, newLogs, 'append', {
            useStreaming: true
        });

        // Проверяем, что все логи слиты
        expect(result.mergedLogs.length).toBe(4);
        
        // Проверяем, что версия увеличилась
        expect(result.version).toBeGreaterThan(0);

        // Проверяем, что логи действительно слиты (не только количество, но и содержимое)
        expect(result.mergedLogs.some(log => log.hypothesisId === 'H1')).toBe(true);
        expect(result.mergedLogs.some(log => log.hypothesisId === 'H4')).toBe(true);
    }, 30000); // Ограничение времени выполнения 30 секунд

    /**
     * Тест 2: Производительность на больших данных
     */
    test('should handle large datasets without blocking event loop', async () => {
        const existingLogs = Array(5000).fill(null).map((_, i) => ({
            timestamp: new Date(Date.now() - (5000 - i) * 1000).toISOString(),
            hypothesisId: 'H1',
            context: `Existing ${i}`,
            data: { value: i }
        }));

        const newLogs = Array(5000).fill(null).map((_, i) => ({
            timestamp: new Date(Date.now() + i * 1000).toISOString(),
            hypothesisId: 'H2',
            context: `New ${i}`,
            data: { value: i + 5000 }
        }));

        // Записываем существующие логи в файл
        await VersionedLogStore.replaceLogs(testFilePath, existingLogs);

        // Измеряем время слияния
        const start = Date.now();
        const result = await VersionedLogStore.mergeLogs(testFilePath, newLogs, 'append', {
            useStreaming: true
        });
        const end = Date.now();

        // Проверяем, что слияние не занимает слишком много времени
        const duration = end - start;
        expect(duration).toBeLessThan(500); // Должно быть < 500ms

        // Проверяем корректность данных
        expect(result.mergedLogs.length).toBe(10000);

        // Проверяем, что данные не потерялись
        expect(result.mergedLogs.some(log => log.context === 'Existing 0')).toBe(true);
        expect(result.mergedLogs.some(log => log.context === 'New 0')).toBe(true);
    }, 30000); // Ограничение времени выполнения 30 секунд

    /**
     * Тест 3: Дедупликация в smart стратегии
     */
    test('should deduplicate logs with smart strategy', async () => {
        const existingLogs: RuntimeLog[] = [
            { timestamp: '2024-01-01T00:00:00.000Z', hypothesisId: 'H1', context: 'Test 1', data: {} },
            { timestamp: '2024-01-01T00:01:00.000Z', hypothesisId: 'H2', context: 'Test 2', data: {} }
        ];

        const newLogs: RuntimeLog[] = [
            { timestamp: '2024-01-01T00:00:00.000Z', hypothesisId: 'H1', context: 'Duplicate', data: {} },  // Дубликат
            { timestamp: '2024-01-01T00:02:00.000Z', hypothesisId: 'H3', context: 'Test 3', data: {} }
        ];

        // Записываем существующие логи в файл
        await VersionedLogStore.replaceLogs(testFilePath, existingLogs);

        // Сливаем логи с smart стратегией
        const result = await VersionedLogStore.mergeLogs(testFilePath, newLogs, 'smart', {
            useStreaming: true
        });

        // Проверяем, что дубликаты удалены (должно остаться 3 уникальных лога)
        expect(result.mergedLogs.length).toBe(3);

        // Проверяем, что конфликт был разрешён
        expect(result.conflictResolved).toBe(true);

        // Проверяем, что дубликат не попал в результат, а новый лог есть
        const duplicateExists = result.mergedLogs.some(log => 
            log.timestamp === '2024-01-01T00:00:00.000Z' && log.context === 'Duplicate'
        );
        expect(duplicateExists).toBe(false);

        const newLogExists = result.mergedLogs.some(log => 
            log.timestamp === '2024-01-01T00:02:00.000Z' && log.hypothesisId === 'H3'
        );
        expect(newLogExists).toBe(true);
    }, 30000); // Ограничение времени выполнения 30 секунд
});

// Ограничиваем вывод логов до 100 строк
console.log = jest.fn((...args) => {
    if ((console.log as any)._callCount < 100) {
        // eslint-disable-next-line no-console
        global.console.log(...args);
    }
    (console.log as any)._callCount = ((console.log as any)._callCount || 0) + 1;
});