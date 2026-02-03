import * as vscode from 'vscode';
import { ActivationManager } from './extension-core/activation-manager';

/**
 * Активация расширения
 */
export async function activate(context: vscode.ExtensionContext) {
    const activationManager = ActivationManager.getInstance();
    await activationManager.activate(context);
}

/**
 * Деактивация расширения
 */
export function deactivate() {
    const activationManager = ActivationManager.getInstance();
    activationManager.deactivate();
}
