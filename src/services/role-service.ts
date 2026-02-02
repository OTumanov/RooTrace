import * as vscode from 'vscode';
import { RoleManager } from '../role-manager';

export class RoleService {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Синхронизировать роль с Roo Code
     */
    async syncRoleWithRoo(context: vscode.ExtensionContext): Promise<void> {
        try {
            this.outputChannel.appendLine('[RooTrace] Syncing role with Roo Code...');
            await RoleManager.syncRoleWithRoo(context);
            this.outputChannel.appendLine('[RooTrace] Role sync completed');
        } catch (error) {
            this.outputChannel.appendLine(`[RooTrace] Error syncing role: ${error}`);
            throw error;
        }
    }
}