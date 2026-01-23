/**
 * Генератор кода проб для PHP
 */

import { BaseGenerator } from './base-generator';

export class PhpGenerator extends BaseGenerator {
  readonly supportedLanguages = ['php'];

  generate(
    language: string,
    probeType: 'log' | 'trace' | 'error',
    message: string,
    serverUrl: string,
    hypothesisId?: string
  ): string | null {
    const hId = this.generateHypothesisId(message, hypothesisId);
    const escapedMessage = this.escapeMessage(message);

    return `try {
    $ch = curl_init('${serverUrl}');
    curl_setopt($ch, CURLOPT_POST, 1);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['hypothesisId' => '${hId}', 'message' => '${escapedMessage}', 'state' => []]));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_TIMEOUT_MS, 100);
    curl_exec($ch);
    curl_close($ch);
} catch(Exception $e) {}`;
  }
}
