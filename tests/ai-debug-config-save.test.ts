// Тесты для метода saveAIDebugConfig в ConfigManager
import * as fs from 'fs';
import { ConfigManager } from '../src/config/config-manager';
import { getRootraceFilePath } from '../src/rootrace-dir-utils';
import { getEncryptionKey, encryptObject, decryptObject } from '../src/encryption-utils';
import { AIDebugConfig } from '../src/services/storage-service';

// Моки для модулей
jest.mock('../src/rootrace-dir-utils', () => ({
    getRootraceFilePath: jest.fn((fileName) => `/mock/path/${fileName}`),
}));

jest.mock('../src/encryption-utils', () => ({
    getEncryptionKey: jest.fn(() => Buffer.from('mock-encryption-key')),
    encryptObject: jest.fn((obj, key) => `encrypted_${JSON.stringify(obj)}`),
    decryptObject: jest.fn(),
}));

describe('ConfigManager saveAIDebugConfig Tests', () => {
    let configManager: ConfigManager;
    let writeFileSyncSpy: jest.SpyInstance;

    beforeEach(() => {
        configManager = ConfigManager.getInstance();

        // Очистка моков перед каждым тестом
        jest.clearAllMocks();

        // Мокаем fs.writeFileSync перед каждым тестом
        writeFileSyncSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
            // Успешная запись без ошибок
        });
    });

    afterEach(() => {
        // Восстанавливаем мок после каждого теста
        if (writeFileSyncSpy) {
            writeFileSyncSpy.mockRestore();
        }
    });

    test('Должен успешно сохранить конфигурацию в зашифрованном виде', () => {
        // Подготовка
        const testConfig: AIDebugConfig = {
            url: 'http://localhost:3000/',
            status: 'active',
            timestamp: Date.now()
        };

        // Выполнение
        const result = configManager.saveAIDebugConfig(testConfig);

        // Проверка
        expect(result).toBe(true);
        expect(getRootraceFilePath).toHaveBeenCalledWith('ai_debug_config');
        expect(getEncryptionKey).toHaveBeenCalled();
        expect(encryptObject).toHaveBeenCalledWith(testConfig, Buffer.from('mock-encryption-key'));
        expect(writeFileSyncSpy).toHaveBeenCalledWith(
            '/mock/path/ai_debug_config',
            expect.stringContaining('encrypted_'),
            'utf8'
        );
    });

    test('Должен вернуть false при ошибке записи файла', () => {
        // Подготовка
        const testConfig: AIDebugConfig = {
            url: 'http://localhost:3000/',
            status: 'active',
            timestamp: Date.now()
        };

        // Мокаем fs.writeFileSync чтобы он бросал ошибку
        writeFileSyncSpy.mockImplementation(() => {
            throw new Error('Mock write error');
        });

        // Выполнение
        const result = configManager.saveAIDebugConfig(testConfig);

        // Проверка
        expect(result).toBe(false);
    });

    test('Должен вызвать правильные функции при сохранении конфигурации', () => {
        // Подготовка
        const testConfig: AIDebugConfig = {
            url: 'http://localhost:8080/',
            status: 'inactive',
            timestamp: 1234567890
        };

        // Выполнение
        const result = configManager.saveAIDebugConfig(testConfig);

        // Проверка
        expect(result).toBe(true);
        expect(getRootraceFilePath).toHaveBeenCalledWith('ai_debug_config');
        expect(getEncryptionKey).toHaveBeenCalled();
        expect(encryptObject).toHaveBeenCalledWith(testConfig, Buffer.from('mock-encryption-key'));
    });
});
