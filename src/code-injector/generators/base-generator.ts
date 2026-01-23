/**
 * Базовый класс для генераторов кода проб
 */

import { ProbeCodeGenerator } from '../types';

/**
 * Базовый класс для генераторов
 * Упрощает создание новых генераторов
 */
export abstract class BaseGenerator implements ProbeCodeGenerator {
  abstract readonly supportedLanguages: string[];

  /**
   * Генерирует hypothesisId из message, если не указан
   */
  protected generateHypothesisId(message: string, hypothesisId?: string): string {
    if (hypothesisId && /^H[1-5]$/.test(hypothesisId.trim())) {
      return hypothesisId.trim();
    } else if (hypothesisId) {
      // Если передан невалидный hypothesisId, генерируем новый
      return `H${Math.abs(message.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % 5 + 1}`;
    } else {
      // Генерируем hypothesisId из message (H1-H5)
      return `H${Math.abs(message.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % 5 + 1}`;
    }
  }

  /**
   * Экранирует кавычки в message для использования в коде
   */
  protected escapeMessage(message: string): string {
    return message.replace(/"/g, '\\"').replace(/'/g, "\\'");
  }

  /**
   * Экранирует URL для использования в строке
   */
  protected escapeUrl(url: string): string {
    return url.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  /**
   * Генерирует код пробы
   */
  abstract generate(
    language: string,
    probeType: 'log' | 'trace' | 'error',
    message: string,
    serverUrl: string,
    hypothesisId?: string
  ): string | null;
}
