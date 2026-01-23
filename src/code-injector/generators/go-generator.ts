/**
 * Генератор кода проб для Go
 */

import { BaseGenerator } from './base-generator';

export class GoGenerator extends BaseGenerator {
  readonly supportedLanguages = ['go'];

  generate(
    language: string,
    probeType: 'log' | 'trace' | 'error',
    message: string,
    serverUrl: string,
    hypothesisId?: string
  ): string | null {
    const hId = this.generateHypothesisId(message, hypothesisId);
    const escapedMessage = this.escapeMessage(message);
    const escapedUrl = serverUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    // Для Go используем переменную rootraceHost, которая должна быть инициализирована в начале файла
    // Если переменная не инициализирована (старые пробы), используем URL напрямую как fallback
    // ВАЖНО: Проба должна использовать импорты http, bytes, json, strings, time которые уже могут быть в файле
    // или будут добавлены при инициализации rootraceHost
    return `go func() {
    defer func() { recover() }()
    serverURL := "${escapedUrl}"
    if rootraceHost != "" && strings.Contains(serverURL, "localhost") {
        serverURL = strings.Replace(serverURL, "localhost", rootraceHost, 1)
    }
    jsonData := []byte(\`{"hypothesisId":"${hId}","message":"${escapedMessage}","state":{}}\`)
    req, _ := http.NewRequest("POST", serverURL, bytes.NewBuffer(jsonData))
    req.Header.Set("Content-Type", "application/json")
    client := &http.Client{Timeout: 100 * time.Millisecond}
    client.Do(req)
}()`;
  }
}
