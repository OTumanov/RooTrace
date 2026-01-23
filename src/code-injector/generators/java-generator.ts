/**
 * Генератор кода проб для Java
 */

import { BaseGenerator } from './base-generator';

export class JavaGenerator extends BaseGenerator {
  readonly supportedLanguages = ['java'];

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
    java.net.URL url = new java.net.URL("${serverUrl}");
    java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
    conn.setRequestMethod("POST");
    conn.setRequestProperty("Content-Type", "application/json");
    conn.setDoOutput(true);
    String json = "{\\"hypothesisId\\":\\"${hId}\\",\\"message\\":\\"${escapedMessage}\\",\\"state\\":{}}";
    conn.getOutputStream().write(json.getBytes());
    conn.getResponseCode();
} catch(Exception e) {}`;
  }
}
