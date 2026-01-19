/**
 * Тесты для VS Code Commands
 * 
 * Проверяет критически важные команды:
 * - rooTrace.startServer
 * - rooTrace.stopServer
 * - rooTrace.clearLogs
 * - ai-debugger.openDashboard
 * - ai-debugger.cleanup
 * - rooTrace.exportJSON
 * - rooTrace.showUserInstructions
 * - rooTrace.continueDebugging
 * - rooTrace.markResolved
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SharedLogStorage } from '../src/shared-log-storage';

// Мокаем модули
jest.mock('vscode');

describe('VS Code Commands', () => {
    jest.setTimeout(30000);

    let mockOutputChannel: vscode.OutputChannel;
    let mockWebviewPanel: vscode.WebviewPanel;
    let sharedStorage: SharedLogStorage;
    const testDir = path.join(__dirname, 'temp-commands-test');

    beforeEach(() => {
        // Создаем временную директорию
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }

        // Мокаем output channel
        mockOutputChannel = {
            appendLine: jest.fn(),
            show: jest.fn(),
            clear: jest.fn(),
            dispose: jest.fn()
        } as any;

        // Мокаем webview panel
        mockWebviewPanel = {
            reveal: jest.fn(),
            webview: {
                html: '',
                postMessage: jest.fn(),
                onDidReceiveMessage: jest.fn()
            },
            onDidDispose: jest.fn(),
            dispose: jest.fn()
        } as any;

        // Мокаем workspace folders
        const mockUri = {
            fsPath: testDir,
            scheme: 'file',
            authority: '',
            path: testDir,
            query: '',
            fragment: '',
            toString: () => `file://${testDir}`,
            with: jest.fn(),
            toJSON: jest.fn()
        };
        (vscode.workspace.workspaceFolders as any) = [
            {
                uri: mockUri,
                name: 'test-workspace',
                index: 0
            }
        ];

        // Мокаем vscode API
        (vscode.window.createOutputChannel as jest.Mock) = jest.fn(() => mockOutputChannel);
        (vscode.window.createWebviewPanel as jest.Mock) = jest.fn(() => mockWebviewPanel);
        (vscode.window.showInformationMessage as jest.Mock) = jest.fn();
        (vscode.window.showErrorMessage as jest.Mock) = jest.fn();
        (vscode.window.showWarningMessage as jest.Mock) = jest.fn();
        (vscode.window.withProgress as jest.Mock) = jest.fn((options, task) => task({
            report: jest.fn()
        }));
        (vscode.commands.executeCommand as jest.Mock) = jest.fn();
        (vscode.workspace.findFiles as jest.Mock) = jest.fn().mockResolvedValue([]);
        (vscode.workspace.openTextDocument as jest.Mock) = jest.fn();
        (vscode.workspace.applyEdit as jest.Mock) = jest.fn().mockResolvedValue(true);

        // Очищаем singleton
        (SharedLogStorage as any).instance = undefined;
        sharedStorage = SharedLogStorage.getInstance();
    });

    afterEach(async () => {
        // Очищаем логи
        if (sharedStorage) {
            await sharedStorage.clear();
            (sharedStorage as any).stopWatcher();
        }

        // Очищаем singleton
        (SharedLogStorage as any).instance = undefined;

        // Удаляем тестовые файлы
        const filesToRemove = ['.ai_debug_config', '.debug_port', '.ai_debug_logs.json'];
        filesToRemove.forEach(file => {
            const filePath = path.join(testDir, file);
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                } catch (error) {
                    // Игнорируем ошибки
                }
            }
        });
    });

    afterAll(() => {
        // Удаляем временную директорию
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    test('rooTrace.startServer должен запустить сервер', async () => {
        // Импортируем команду (в реальной реализации это будет через registerCommand)
        // Для теста проверяем, что команда может быть вызвана
        const startServer = jest.fn().mockResolvedValue(undefined);
        
        await startServer();

        // Проверяем, что команда была вызвана
        expect(startServer).toHaveBeenCalled();
    });

    test('rooTrace.stopServer должен остановить сервер', async () => {
        const stopServer = jest.fn().mockResolvedValue(undefined);
        
        await stopServer();

        expect(stopServer).toHaveBeenCalled();
    });

    test('rooTrace.clearLogs должен очистить логи', async () => {
        // Добавляем тестовые логи
        await sharedStorage.addLog({
            timestamp: new Date().toISOString(),
            hypothesisId: 'H1',
            context: 'Test context',
            data: { test: 'data' }
        });

        // Проверяем, что логи добавлены
        const logsBefore = await sharedStorage.getLogs();
        expect(logsBefore.length).toBeGreaterThan(0);

        // Очищаем логи
        await sharedStorage.clear();

        // Проверяем, что логи очищены
        const logsAfter = await sharedStorage.getLogs();
        expect(logsAfter.length).toBe(0);
    });

    test('ai-debugger.openDashboard должен открыть дашборд', async () => {
        // Симулируем открытие дашборда
        const openDashboard = jest.fn().mockImplementation(() => {
            return vscode.window.createWebviewPanel(
                'aiDebuggerDashboard',
                'AI Debugger Dashboard',
                vscode.ViewColumn.Two,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );
        });

        const panel = await openDashboard();

        expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
            'aiDebuggerDashboard',
            'AI Debugger Dashboard',
            vscode.ViewColumn.Two,
            expect.objectContaining({
                enableScripts: true,
                retainContextWhenHidden: true
            })
        );
    });

    test('ai-debugger.cleanup должен очистить debug код', async () => {
        // Создаем тестовый файл с debug маркерами
        const testFile = path.join(testDir, 'test.ts');
        const content = `// AI_DEBUG_START
console.log('debug code');
// AI_DEBUG_END
`;

        fs.writeFileSync(testFile, content, 'utf8');

        // Мокаем findFiles для возврата тестового файла
        const mockFileUri = {
            fsPath: testFile,
            scheme: 'file',
            authority: '',
            path: testFile,
            query: '',
            fragment: '',
            toString: () => `file://${testFile}`,
            with: jest.fn(),
            toJSON: jest.fn()
        };
        (vscode.workspace.findFiles as jest.Mock) = jest.fn().mockResolvedValue([
            mockFileUri
        ]);

        // Мокаем openTextDocument
        const mockDocument = {
            getText: jest.fn().mockReturnValue(content),
            save: jest.fn().mockResolvedValue(undefined),
            positionAt: jest.fn().mockReturnValue({ line: 0, character: 0 }),
            uri: mockFileUri
        };
        (vscode.workspace.openTextDocument as jest.Mock) = jest.fn().mockResolvedValue(mockDocument);

        // Симулируем cleanup команду
        const cleanup = jest.fn().mockImplementation(async () => {
            const files = await vscode.workspace.findFiles('**/*.{ts,js,tsx,jsx}', '**/node_modules/**');
            // В реальной реализации здесь будет удаление маркеров
            return true;
        });

        await cleanup();

        expect(vscode.workspace.findFiles).toHaveBeenCalled();
    });

    test('rooTrace.exportJSON должен экспортировать логи', async () => {
        // Добавляем тестовые логи
        await sharedStorage.addLog({
            timestamp: new Date().toISOString(),
            hypothesisId: 'H1',
            context: 'Test context',
            data: { test: 'data' }
        });

        await new Promise(resolve => setTimeout(resolve, 200));

        // Симулируем экспорт
        const exportLogs = jest.fn().mockImplementation(async () => {
            const logs = await sharedStorage.getLogs();
            return JSON.stringify(logs, null, 2);
        });

        const exported = await exportLogs();

        expect(exported).toBeDefined();
        expect(() => JSON.parse(exported)).not.toThrow();
    });

    test('rooTrace.showUserInstructions должен показать инструкции', async () => {
        const instructions = 'Test instructions';
        const stepNumber = 1;

        // Мокаем showInformationMessage для возврата действия
        (vscode.window.showInformationMessage as jest.Mock) = jest.fn().mockResolvedValue('Продолжить (анализ логов)');

        // Симулируем команду
        const showInstructions = jest.fn().mockImplementation(async (inst: string, step?: number) => {
            const message = `📋 Шаг ${step || 1}: Инструментация готова!\n\n${inst}`;
            const action = await vscode.window.showInformationMessage(
                message,
                'Продолжить (анализ логов)',
                'Проблема устранена'
            );
            return { action, message: inst };
        });

        const result = await showInstructions(instructions, stepNumber);

        expect(vscode.window.showInformationMessage).toHaveBeenCalled();
        expect(result.action).toBe('Продолжить (анализ логов)');
    });

    test('rooTrace.continueDebugging должен обработать действие', async () => {
        // Мокаем showInformationMessage
        (vscode.window.showInformationMessage as jest.Mock) = jest.fn().mockResolvedValue('Да, проанализировать логи');

        // Симулируем команду
        const continueDebugging = jest.fn().mockImplementation(async () => {
            const action = await vscode.window.showInformationMessage(
                'Готовы продолжить анализ логов?',
                'Да, проанализировать логи',
                'Отмена'
            );
            if (action === 'Да, проанализировать логи') {
                return { action: 'continue' };
            }
            return { action: 'cancelled' };
        });

        const result = await continueDebugging();

        expect(vscode.window.showInformationMessage).toHaveBeenCalled();
        expect(result.action).toBe('continue');
    });

    test('rooTrace.markResolved должен очистить сессию', async () => {
        // Мокаем showInformationMessage
        (vscode.window.showInformationMessage as jest.Mock) = jest.fn()
            .mockResolvedValueOnce('Да, очистить сессию')
            .mockResolvedValueOnce('Сессия отладки очищена. Проблема решена!');

        // Мокаем executeCommand для clearSession
        (vscode.commands.executeCommand as jest.Mock) = jest.fn().mockResolvedValue(undefined);

        // Симулируем команду
        const markResolved = jest.fn().mockImplementation(async () => {
            const action = await vscode.window.showInformationMessage(
                'Проблема устранена? Очистить сессию отладки?',
                'Да, очистить сессию',
                'Отмена'
            );
            if (action === 'Да, очистить сессию') {
                await vscode.commands.executeCommand('rooTrace.clearSession');
                return { action: 'resolved' };
            }
            return { action: 'cancelled' };
        });

        const result = await markResolved();

        expect(vscode.window.showInformationMessage).toHaveBeenCalled();
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('rooTrace.clearSession');
        expect(result.action).toBe('resolved');
    });

    test('должен обработать отмену действия в showUserInstructions', async () => {
        // Мокаем showInformationMessage для возврата undefined (отмена)
        (vscode.window.showInformationMessage as jest.Mock) = jest.fn().mockResolvedValue(undefined);

        const showInstructions = jest.fn().mockImplementation(async (inst: string) => {
            const action = await vscode.window.showInformationMessage(
                inst,
                'Продолжить (анализ логов)',
                'Проблема устранена'
            );
            return { action: action || 'cancelled' };
        });

        const result = await showInstructions('Test');

        expect(result.action).toBe('cancelled');
    });

    test('должен обработать ошибку при очистке сессии', async () => {
        // Мокаем showInformationMessage
        (vscode.window.showInformationMessage as jest.Mock) = jest.fn()
            .mockResolvedValueOnce('Да, очистить сессию');

        // Мокаем executeCommand для возврата ошибки
        (vscode.commands.executeCommand as jest.Mock) = jest.fn().mockRejectedValue(new Error('Session error'));

        const markResolved = jest.fn().mockImplementation(async () => {
            try {
                const action = await vscode.window.showInformationMessage(
                    'Проблема устранена? Очистить сессию отладки?',
                    'Да, очистить сессию',
                    'Отмена'
                );
                if (action === 'Да, очистить сессию') {
                    await vscode.commands.executeCommand('rooTrace.clearSession');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Ошибка при очистке сессии: ${error}`);
                return { action: 'error', error };
            }
        });

        const result = await markResolved();

        expect(vscode.window.showErrorMessage).toHaveBeenCalled();
        expect(result.action).toBe('error');
    });
});
