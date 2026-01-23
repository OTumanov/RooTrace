/**
 * Генератор кода проб для неизвестных языков (fallback на JavaScript)
 */

import { BaseGenerator } from './base-generator';

export class FallbackGenerator extends BaseGenerator {
  readonly supportedLanguages: string[] = []; // Пустой массив - используется для всех неизвестных языков

  generate(
    language: string,
    probeType: 'log' | 'trace' | 'error',
    message: string,
    serverUrl: string,
    hypothesisId?: string
  ): string | null {
    const hId = this.generateHypothesisId(message, hypothesisId);
    const escapedMessage = this.escapeMessage(message);

    // Для неизвестных языков используем JavaScript как fallback
    return `try { fetch('${serverUrl}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hypothesisId: '${hId}', message: '${escapedMessage}', state: {} }) }).catch(() => {}); } catch(e) {}`;
  }
}
