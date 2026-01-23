/**
 * Генератор кода проб для C#
 */

import { BaseGenerator } from './base-generator';

export class CSharpGenerator extends BaseGenerator {
  readonly supportedLanguages = ['csharp', 'cs'];

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
    using (var client = new System.Net.Http.HttpClient()) {
        var content = new System.Net.Http.StringContent("{\\"hypothesisId\\":\\"${hId}\\",\\"message\\":\\"${escapedMessage}\\",\\"state\\":{}}", System.Text.Encoding.UTF8, "application/json");
        client.PostAsync("${serverUrl}", content).Wait();
    }
} catch {}`;
  }
}
