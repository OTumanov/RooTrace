/**
 * Генератор кода проб для JavaScript/TypeScript
 */

import { BaseGenerator } from './base-generator';

export class JavaScriptGenerator extends BaseGenerator {
  readonly supportedLanguages = ['javascript', 'typescript', 'js', 'ts', 'jsx', 'tsx'];

  generate(
    language: string,
    probeType: 'log' | 'trace' | 'error',
    message: string,
    serverUrl: string,
    hypothesisId?: string
  ): string | null {
    const hId = this.generateHypothesisId(message, hypothesisId);
    const escapedMessage = this.escapeMessage(message);

    // Добавляем логирование в консоль для JavaScript/TypeScript
    return `try { console.error('[RooTrace Probe] EXECUTING: ${hId} - ${escapedMessage}, URL: ${serverUrl}'); fetch('${serverUrl}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hypothesisId: '${hId}', message: '${escapedMessage}', state: {} }) }).then(res => { console.error('[RooTrace Probe] SUCCESS: ${hId} - status=' + res.status + ', URL: ${serverUrl}'); }).catch(err => { console.error('[RooTrace Probe ERROR] ${hId} - ' + err.name + ': ' + err.message + ', URL: ${serverUrl}'); }); } catch(e) { console.error('[RooTrace Probe ERROR] ${hId} - ' + e.name + ': ' + e.message + ', URL: ${serverUrl}'); }`;
  }
}
