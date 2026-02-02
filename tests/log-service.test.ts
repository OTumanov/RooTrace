import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { LogService } from '../src/services/log-service';
import { SharedLogStorage } from '../src/shared-log-storage';
import { waitForLogsSaved } from './helpers/test-helpers';

// Мокаем vscode перед импортом модулей, которые его используют
jest.mock('vscode', () => require('./vscode-mock'), { virtual: true });

// Глобальный таймаут для всех тестов (5 секунд как указано в требованиях)
jest.setTimeout(5000);

describe('LogService', () => {
    let testDir: string;
    let logFilePath: string;
    let storage: SharedLogStorage;
    let logService: LogService;
    let mockOutputChannel: jest.Mocked<vscode.OutputChannel>;
    let originalCwd: string;

    beforeEach(async () => {
        // Сохраняем оригинальную рабочую директорию
        originalCwd = process.cwd();
        
        // Создаем уникальную временную директорию для каждого теста
        testDir = path.join(tmpdir(), `log-service-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
        fs.mkdirSync(testDir, { recursive: true });
        
        // Создаем .rootrace директорию
        const rootraceDir = path.join(testDir, '.rootrace');
        fs.mkdirSync(rootraceDir, { recursive: true });
        
        // Явный путь к лог файлу
        logFilePath = path.join(rootraceDir, 'ai_debug_logs.json');
        
        // Меняем рабочую директорию на тестовую
        process.chdir(testDir);
        
        // Сбрасываем синглтон SharedLogStorage
        (SharedLogStorage as any).instance = undefined;
        
        // Получаем экземпляр SharedLogStorage (синглтон)
        storage = SharedLogStorage.getInstance();
        
        // Переопределяем getLogFilePath для использования нашего пути
        (storage as any).getLogFilePath = () => logFilePath;
        
        // Инициализируем storage вручную (вызываем приватный метод через any)
        await (storage as any).initStorage();
        
        // Создаем мок output channel
        mockOutputChannel = {
            appendLine: jest.fn(),
            clear: jest.fn(),
            show: jest.fn(),
            dispose: jest.fn(),
            hide: jest.fn(),
            name: 'Test Output Channel'
        } as unknown as jest.Mocked<vscode.OutputChannel>;

        logService = new LogService(mockOutputChannel);
        
        // Очищаем shared storage перед каждым тестом
        await storage.clear();
        
        // Ждем завершения всех асинхронных операций
        await new Promise(resolve => setTimeout(resolve, 50));
    });

    afterEach(async () => {
        // Очищаем моки
        jest.clearAllMocks();
        
        // Останавливаем watcher и очищаем storage
        if (storage) {
            (storage as any).stopWatcher();
            await storage.clear();
        }
        
        // Сбрасываем синглтон SharedLogStorage
        (SharedLogStorage as any).instance = undefined;
        
        // Возвращаем оригинальную рабочую директорию
        process.chdir(originalCwd);
        
        // Удаляем временную директорию
        if (testDir && fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
        
        // Ждем завершения всех асинхронных операций и завершения watcher
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    describe('formatLogEntry', () => {
        it('should format log entry correctly', () => {
            const hypothesisId = 'test-hypothesis';
            const context = 'Test context';
            const data = { key: 'value' };
            
            const formatted = logService.formatLogEntry(hypothesisId, context, data);
            
            expect(formatted).toContain(`[LOG][Hypothesis: ${hypothesisId}]`);
            expect(formatted).toContain(`Context: "${context}"`);
            expect(formatted).toContain(`Data: ${JSON.stringify(data, null, 2)}`);
            expect(formatted).toContain('---');
        });
    });

    describe('logToOutputChannel', () => {
        it('should add log to shared storage and output channel', async () => {
            // Убедимся, что storage пуст перед тестом
            const initialLogs = await storage.getLogs();
            expect(initialLogs).toHaveLength(0);
            
            const hypothesisId = 'test-log';
            const context = 'Test log context';
            const data = { foo: 'bar' };
            
            await logService.logToOutputChannel(hypothesisId, context, data);
            
            // Дадим время для асинхронных операций
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Проверяем, что лог добавлен в shared storage
            const logs = await storage.getLogs();
            expect(logs).toHaveLength(1);
            expect(logs[0].hypothesisId).toBe(hypothesisId);
            expect(logs[0].context).toBe(context);
            expect(logs[0].data).toEqual(data);
            
            // Проверяем, что output channel был использован
            expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining(`logToOutputChannel called: hypothesisId=${hypothesisId}`)
            );
            expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining(`Total logs in storage after add: 1`)
            );
        });

        it('should handle errors gracefully', async () => {
            // Мокаем storage.addLog чтобы выбросить ошибку
            const error = new Error('Storage error');
            jest.spyOn(storage, 'addLog').mockRejectedValueOnce(error);
            
            const hypothesisId = 'test-error';
            const context = 'Error context';
            const data = {};
            
            await expect(logService.logToOutputChannel(hypothesisId, context, data))
                .rejects.toThrow('Storage error');
            
            expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('[ERROR] Failed to log to output channel')
            );
        });
    });

    describe('getInMemoryLogs', () => {
        it('should return formatted logs from shared storage', async () => {
            // Убедимся, что storage пуст перед тестом
            const initialLogs = await storage.getLogs();
            expect(initialLogs).toHaveLength(0);
            
            // Добавляем несколько логов
            await storage.addLog({
                timestamp: new Date().toISOString(),
                hypothesisId: 'hyp1',
                context: 'Context 1',
                data: { a: 1 }
            });
            await storage.addLog({
                timestamp: new Date().toISOString(),
                hypothesisId: 'hyp2',
                context: 'Context 2',
                data: { b: 2 }
            });
            
            // Ждем немного, чтобы гарантировать сохранение (если используется асинхронное сохранение)
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const formattedLogs = await logService.getInMemoryLogs();
            
            expect(formattedLogs).toHaveLength(2);
            expect(formattedLogs[0]).toContain('[LOG][Hypothesis: hyp1]');
            expect(formattedLogs[1]).toContain('[LOG][Hypothesis: hyp2]');
            
            // Проверяем, что логи правильно отформатированы
            expect(formattedLogs[0]).toContain('Context: "Context 1"');
            expect(formattedLogs[1]).toContain('Context: "Context 2"');
        });
    });

    describe('clearLogs', () => {
        it('should clear shared storage and output channel', async () => {
            // Убедимся, что storage пуст перед тестом
            const initialLogs = await storage.getLogs();
            expect(initialLogs).toHaveLength(0);
            
            // Добавляем лог
            await storage.addLog({
                timestamp: new Date().toISOString(),
                hypothesisId: 'to-clear',
                context: 'Context',
                data: {}
            });
            
            // Ждем немного, чтобы гарантировать сохранение
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Проверяем, что лог добавлен
            const logsBeforeClear = await storage.getLogs();
            expect(logsBeforeClear).toHaveLength(1);
            
            await logService.clearLogs();
            
            // Ждем завершения watcher и асинхронных операций
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Проверяем, что shared storage очищен
            const logs = await storage.getLogs();
            expect(logs).toHaveLength(0);
            
            // Проверяем, что output channel был очищен
            expect(mockOutputChannel.clear).toHaveBeenCalled();
            expect(mockOutputChannel.appendLine).toHaveBeenCalledWith('[SYSTEM] Logs cleared.');
            expect(mockOutputChannel.show).toHaveBeenCalledWith(true);
        });
    });
});