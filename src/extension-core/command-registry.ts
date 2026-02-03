/**
 * Реестр команд VS Code для расширения RooTrace
 */

import * as vscode from 'vscode';

/**
 * Интерфейс команды расширения
 */
export interface ExtensionCommand {
    id: string;
    handler: (...args: any[]) => any;
    title?: string;
    category?: string;
}

/**
 * Реестр команд расширения
 */
export class CommandRegistry {
    private static instance: CommandRegistry;
    private commands: Map<string, vscode.Disposable> = new Map();
    
    private constructor() {}
    
    /**
     * Получить экземпляр реестра (Singleton)
     */
    public static getInstance(): CommandRegistry {
        if (!CommandRegistry.instance) {
            CommandRegistry.instance = new CommandRegistry();
        }
        return CommandRegistry.instance;
    }
    
    /**
     * Зарегистрировать команду
     */
    public registerCommand(command: ExtensionCommand, context: vscode.ExtensionContext): void {
        const disposable = vscode.commands.registerCommand(command.id, command.handler);
        this.commands.set(command.id, disposable);
        context.subscriptions.push(disposable);
    }
    
    /**
     * Зарегистрировать несколько команд
     */
    public registerCommands(commands: ExtensionCommand[], context: vscode.ExtensionContext): void {
        commands.forEach(command => this.registerCommand(command, context));
    }
    
    /**
     * Получить зарегистрированную команду
     */
    public getCommand(id: string): vscode.Disposable | undefined {
        return this.commands.get(id);
    }
    
    /**
     * Проверить, зарегистрирована ли команда
     */
    public hasCommand(id: string): boolean {
        return this.commands.has(id);
    }
    
    /**
     * Отменить регистрацию команды
     */
    public unregisterCommand(id: string): boolean {
        const disposable = this.commands.get(id);
        if (disposable) {
            disposable.dispose();
            return this.commands.delete(id);
        }
        return false;
    }
    
    /**
     * Очистить все команды
     */
    public clear(): void {
        this.commands.forEach(disposable => disposable.dispose());
        this.commands.clear();
    }
    
    /**
     * Получить список всех зарегистрированных команд
     */
    public getCommandIds(): string[] {
        return Array.from(this.commands.keys());
    }
}