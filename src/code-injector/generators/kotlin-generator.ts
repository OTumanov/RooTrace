/**
 * Генератор кода проб для Kotlin
 */

import { BaseGenerator } from './base-generator';

export class KotlinGenerator extends BaseGenerator {
  readonly supportedLanguages = ['kotlin', 'kt', 'kts'];

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
    val url = java.net.URL("${serverUrl}")
    val conn = url.openConnection() as java.net.HttpURLConnection
    conn.requestMethod = "POST"
    conn.setRequestProperty("Content-Type", "application/json")
    conn.doOutput = true
    conn.outputStream.write("{\\"hypothesisId\\":\\"${hId}\\",\\"message\\":\\"${escapedMessage}\\",\\"state\\":{}}".toByteArray())
    conn.responseCode
} catch(e: Exception) {}`;
  }
}
