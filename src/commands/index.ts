/**
 * Команды VS Code для расширения RooTrace
 */
import * as vscode from 'vscode';
import { CommandFactory } from './command-factory';
import { CommandRegistry } from '../extension-core/command-registry';

export * from './command-factory';
export * from './command-handlers';

export function registerAllCommands(context: vscode.ExtensionContext): void {
    const commands = CommandFactory.getAllCommands();
    const registry = CommandRegistry.getInstance();
    registry.registerCommands(commands, context);
}