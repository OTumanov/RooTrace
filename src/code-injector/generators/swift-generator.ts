/**
 * Генератор кода проб для Swift
 */

import { BaseGenerator } from './base-generator';

export class SwiftGenerator extends BaseGenerator {
  readonly supportedLanguages = ['swift'];

  generate(
    language: string,
    probeType: 'log' | 'trace' | 'error',
    message: string,
    serverUrl: string,
    hypothesisId?: string
  ): string | null {
    const hId = this.generateHypothesisId(message, hypothesisId);
    const escapedMessage = this.escapeMessage(message);

    return `do {
    let url = URL(string: "${serverUrl}")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: ["hypothesisId": "${hId}", "message": "${escapedMessage}", "state": [:]], options: [])
    request.timeoutInterval = 0.1
    URLSession.shared.dataTask(with: request).resume()
} catch {}`;
  }
}
