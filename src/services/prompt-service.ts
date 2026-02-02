import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class PromptService {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Копирует модули промптов из ресурсов расширения в рабочую область
     * Копирует только если файлы еще не существуют (не перезаписывает пользовательские изменения)
     */
    async copyPromptModules(context: vscode.ExtensionContext): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return; // Нет рабочей области
        }

        const extensionPath = context.extensionPath;
        // Пробуем несколько возможных путей к модулям в расширении
        // ИСПОЛЬЗУЕМ roo-trace-rules, чтобы Roo Code не загружал их автоматически
        const possibleSourceDirs = [
            path.join(extensionPath, '.roo', 'roo-trace-rules'),
            path.join(extensionPath, 'extension', '.roo', 'roo-trace-rules'), // Для упакованного расширения
            path.join(__dirname, '..', '.roo', 'roo-trace-rules') // Для разработки
        ];
        
        let sourceDir: string | null = null;
        for (const dir of possibleSourceDirs) {
            if (fs.existsSync(dir)) {
                sourceDir = dir;
                this.outputChannel.appendLine(`[RooTrace] Found prompt modules at: ${dir}`);
                break;
            }
        }
        
        // Проверяем, существует ли директория с модулями в расширении
        if (!sourceDir) {
            this.outputChannel.appendLine(`[RooTrace] Warning: Prompt modules directory not found. Tried: ${possibleSourceDirs.join(', ')}`);
            return;
        }

        // Копируем для каждой рабочей области
        // ИСПОЛЬЗУЕМ roo-trace-rules, чтобы Roo Code не загружал их автоматически
        for (const folder of workspaceFolders) {
            const workspacePath = folder.uri.fsPath;
            const targetDir = path.join(workspacePath, '.roo', 'roo-trace-rules');

            try {
                // Создаем целевую директорию, если её нет
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                    this.outputChannel.appendLine(`[RooTrace] Created directory: ${targetDir}`);
                }

                // Читаем все файлы из исходной директории
                const sourceFiles = fs.readdirSync(sourceDir, { withFileTypes: true });
                let copiedCount = 0;
                let skippedCount = 0;

                for (const file of sourceFiles) {
                    if (file.isFile() && file.name.endsWith('.md')) {
                        const sourcePath = path.join(sourceDir, file.name);
                        const targetPath = path.join(targetDir, file.name);

                        // Копируем только если файл еще не существует
                        if (!fs.existsSync(targetPath)) {
                            fs.copyFileSync(sourcePath, targetPath);
                            copiedCount++;
                            this.outputChannel.appendLine(`[RooTrace] Copied: ${file.name}`);
                        } else {
                            skippedCount++;
                            this.outputChannel.appendLine(`[RooTrace] Skipped (exists): ${file.name}`);
                        }
                    }
                }

                this.outputChannel.appendLine(`[RooTrace] Prompt modules: ${copiedCount} copied, ${skippedCount} skipped for workspace: ${workspacePath}`);
            } catch (error) {
                const errorMsg = `Failed to copy prompt modules to ${targetDir}: ${error}`;
                this.outputChannel.appendLine(`[RooTrace] ERROR: ${errorMsg}`);
                throw new Error(errorMsg);
            }
        }
    }
}