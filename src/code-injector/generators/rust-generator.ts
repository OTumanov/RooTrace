/**
 * Генератор кода проб для Rust
 */

import { BaseGenerator } from './base-generator';

export class RustGenerator extends BaseGenerator {
  readonly supportedLanguages = ['rust', 'rs'];

  generate(
    language: string,
    probeType: 'log' | 'trace' | 'error',
    message: string,
    serverUrl: string,
    hypothesisId?: string
  ): string | null {
    const hId = this.generateHypothesisId(message, hypothesisId);
    const escapedMessage = this.escapeMessage(message);

    // Rust использует reqwest или ureq, но для простоты используем однострочный вариант с ureq
    return `std::thread::spawn(|| { let _ = ureq::post("${serverUrl}").set("Content-Type", "application/json").send_json(ureq::json!({"hypothesisId": "${hId}", "message": "${escapedMessage}", "state": {}})); });`;
  }
}
