/**
 * Генератор кода проб для C++
 */

import { BaseGenerator } from './base-generator';

export class CppGenerator extends BaseGenerator {
  readonly supportedLanguages = ['cpp', 'c++', 'cxx', 'cc'];

  generate(
    language: string,
    probeType: 'log' | 'trace' | 'error',
    message: string,
    serverUrl: string,
    hypothesisId?: string
  ): string | null {
    const hId = this.generateHypothesisId(message, hypothesisId);
    const escapedMessage = this.escapeMessage(message);

    // C++ используем curl через system call (если доступен) или комментарий
    return `std::system(("curl -s -X POST -H \\"Content-Type: application/json\\" -d '{\\"hypothesisId\\":\\"${hId}\\",\\"message\\":\\"${escapedMessage}\\",\\"state\\":{}}' '" + std::string("${serverUrl}") + "' > /dev/null 2>&1 &").c_str());`;
  }
}
