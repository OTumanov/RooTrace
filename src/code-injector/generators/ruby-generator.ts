/**
 * Генератор кода проб для Ruby
 */

import { BaseGenerator } from './base-generator';

export class RubyGenerator extends BaseGenerator {
  readonly supportedLanguages = ['ruby', 'rb'];

  generate(
    language: string,
    probeType: 'log' | 'trace' | 'error',
    message: string,
    serverUrl: string,
    hypothesisId?: string
  ): string | null {
    const hId = this.generateHypothesisId(message, hypothesisId);
    const escapedMessage = this.escapeMessage(message);

    return `begin
    require 'net/http'
    require 'json'
    uri = URI('${serverUrl}')
    http = Net::HTTP.new(uri.host, uri.port)
    http.read_timeout = 0.1
    req = Net::HTTP::Post.new(uri.path)
    req['Content-Type'] = 'application/json'
    req.body = {hypothesisId: '${hId}', message: '${escapedMessage}', state: {}}.to_json
    http.request(req)
rescue
end`;
  }
}
