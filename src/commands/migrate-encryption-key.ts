import * as vscode from 'vscode';
import { getEncryptionKey, deriveKeyFromPhrase, migrateEncryptionKey } from '../encryption-utils';
import { getRootraceFilePath } from '../rootrace-dir-utils';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Команда миграции зашифрованных данных на новый ключ
 */
export async function migrateEncryptionKeyCommand(): Promise<void> {
    const outputChannel = vscode.window.createOutputChannel('RooTrace Migration');
    outputChannel.show();
    
    outputChannel.appendLine('[Migration] Starting encryption key migration...');
    
    try {
        // Запрашиваем старую секретную фразу
        const oldSecretPhrase = await vscode.window.showInputBox({
            prompt: 'Введите старую секретную фразу для расшифровки данных',
            password: true,
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.length < 12) {
                    return 'Секретная фраза должна быть минимум 12 символов';
                }
                return null;
            }
        });
        
        if (!oldSecretPhrase) {
            outputChannel.appendLine('[Migration] Migration cancelled by user.');
            return;
        }
        
        // Получаем текущий (новый) ключ
        const newKey = getEncryptionKey();
        
        // Генерируем старый ключ
        const oldKey = deriveKeyFromPhrase(oldSecretPhrase);
        
        // Находим все зашифрованные файлы
        const rootraceDir = path.dirname(getRootraceFilePath(''));
        const filesToMigrate: string[] = [];
        
        if (fs.existsSync(rootraceDir)) {
            const files = fs.readdirSync(rootraceDir);
            for (const file of files) {
                const filePath = path.join(rootraceDir, file);
                const stat = fs.statSync(filePath);
                if (stat.isFile()) {
                    try {
                        const content = fs.readFileSync(filePath, 'utf8');
                        // Проверяем, является ли файл зашифрованным JSON
                        JSON.parse(atob(content));
                        filesToMigrate.push(filePath);
                    } catch {
                        // Не зашифрованный файл, пропускаем
                    }
                }
            }
        }
        
        if (filesToMigrate.length === 0) {
            outputChannel.appendLine('[Migration] No encrypted files found to migrate.');
            vscode.window.showInformationMessage('Нет зашифрованных файлов для миграции.');
            return;
        }
        
        outputChannel.appendLine(`[Migration] Found ${filesToMigrate.length} files to migrate.`);
        
        // Подтверждение миграции
        const confirm = await vscode.window.showWarningMessage(
            `Найдено ${filesToMigrate.length} зашифрованных файлов. Выполнить миграцию?`,
            { modal: true },
            'Выполнить миграцию',
            'Отмена'
        );
        
        if (confirm !== 'Выполнить миграцию') {
            outputChannel.appendLine('[Migration] Migration cancelled by user.');
            return;
        }
        
        // Мигрируем файлы
        let successCount = 0;
        let failCount = 0;
        
        for (const filePath of filesToMigrate) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const migratedContent = migrateEncryptionKey(content, oldKey, newKey);
                fs.writeFileSync(filePath, migratedContent, 'utf8');
                successCount++;
                outputChannel.appendLine(`[Migration] Migrated: ${path.basename(filePath)}`);
            } catch (error) {
                failCount++;
                outputChannel.appendLine(`[Migration] Failed to migrate ${path.basename(filePath)}: ${error}`);
            }
        }
        
        outputChannel.appendLine(`[Migration] Migration complete: ${successCount} succeeded, ${failCount} failed.`);
        
        if (failCount === 0) {
            vscode.window.showInformationMessage(`Миграция успешно завершена: ${successCount} файлов.`);
        } else {
            vscode.window.showWarningMessage(
                `Миграция завершена с ошибками: ${successCount} успешно, ${failCount} с ошибками. Подробности в Output.`
            );
        }
        
    } catch (error) {
        outputChannel.appendLine(`[Migration] Error: ${error}`);
        vscode.window.showErrorMessage(`Ошибка миграции: ${error}`);
    }
}