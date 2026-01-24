/**
 * Валидация параметров для инъекции проб
 * 
 * Этот модуль предоставляет функции для валидации параметров
 * перед инъекцией проб в код.
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Параметры для инъекции одной пробы
 */
export interface InjectProbeParams {
  filePath?: string;
  lineNumber?: number;
  probeType?: string;
  message?: string;
  probeCode?: any;
  hypothesisId?: any;
}

/**
 * Результат валидации
 */
export interface ValidationResult {
  valid: boolean;
  error?: CallToolResult;
}

/**
 * Валидирует параметры для инъекции одной пробы
 * 
 * @param params - Параметры для валидации
 * @param probeIndex - Индекс пробы (для множественной инъекции, опционально)
 * @returns Результат валидации
 */
export function validateInjectProbeParams(
  params: InjectProbeParams,
  probeIndex?: number
): ValidationResult {
  const prefix = probeIndex !== undefined ? `Probe ${probeIndex + 1}: ` : '';

  // Проверка filePath
  if (!params.filePath || typeof params.filePath !== 'string') {
    return {
      valid: false,
      error: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `${prefix}Missing or invalid filePath parameter (must be a non-empty string)`,
            errorCode: 'MISSING_PARAMETERS',
            ...(probeIndex !== undefined && { probeIndex })
          })
        }],
        isError: true
      }
    };
  }

  // Проверка lineNumber
  if (
    params.lineNumber === undefined ||
    params.lineNumber === null ||
    typeof params.lineNumber !== 'number' ||
    isNaN(params.lineNumber) ||
    params.lineNumber < 1
  ) {
    return {
      valid: false,
      error: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `${prefix}Missing or invalid lineNumber parameter (must be a positive integer)`,
            errorCode: 'MISSING_PARAMETERS',
            ...(probeIndex !== undefined && { probeIndex })
          })
        }],
        isError: true
      }
    };
  }

  // Проверка probeType
  if (!params.probeType || typeof params.probeType !== 'string') {
    return {
      valid: false,
      error: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `${prefix}Missing or invalid probeType parameter (must be a string)`,
            errorCode: 'MISSING_PARAMETERS',
            ...(probeIndex !== undefined && { probeIndex })
          })
        }],
        isError: true
      }
    };
  }

  // Валидация типа пробы
  const validProbeTypes = ['log', 'trace', 'error'];
  if (!validProbeTypes.includes(params.probeType)) {
    return {
      valid: false,
      error: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `${prefix}Invalid probeType (must be log, trace, or error)`,
            errorCode: 'INVALID_PROBE_TYPE',
            ...(probeIndex !== undefined && { probeIndex })
          })
        }],
        isError: true
      }
    };
  }

  // Валидация опциональных параметров
  if (params.probeCode !== undefined && params.probeCode !== null && typeof params.probeCode !== 'string') {
    return {
      valid: false,
      error: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `${prefix}Invalid probeCode parameter (must be a string if provided)`,
            errorCode: 'INVALID_PARAMETERS',
            ...(probeIndex !== undefined && { probeIndex })
          })
        }],
        isError: true
      }
    };
  }

  // Валидация hypothesisId
  if (params.hypothesisId !== undefined && params.hypothesisId !== null) {
    if (typeof params.hypothesisId !== 'string') {
      return {
        valid: false,
        error: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `${prefix}Invalid hypothesisId parameter (must be a string if provided)`,
              errorCode: 'INVALID_PARAMETERS',
              ...(probeIndex !== undefined && { probeIndex })
            })
          }],
          isError: true
        }
      };
    }

    // Валидация формата hypothesisId (должен быть H1-H5)
    const trimmedHypothesisId = params.hypothesisId.trim();
    if (!/^H[1-5]$/.test(trimmedHypothesisId)) {
      return {
        valid: false,
        error: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `${prefix}Invalid hypothesisId format. Must be H1, H2, H3, H4, or H5, got: ${trimmedHypothesisId}`,
              errorCode: 'INVALID_PARAMETERS',
              ...(probeIndex !== undefined && { probeIndex })
            })
          }],
          isError: true
        }
      };
    }
  }

  return { valid: true };
}

/**
 * Валидирует параметры для множественной инъекции проб
 * 
 * @param probes - Массив проб для валидации
 * @returns Результат валидации
 */
export function validateInjectMultipleProbesParams(
  probes: any
): ValidationResult {
  if (!probes || !Array.isArray(probes) || probes.length === 0) {
    return {
      valid: false,
      error: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Missing or invalid probes parameter (must be a non-empty array)',
            errorCode: 'MISSING_PARAMETERS'
          })
        }],
        isError: true
      }
    };
  }

  // Валидируем каждую пробу
  for (let i = 0; i < probes.length; i++) {
    const validation = validateInjectProbeParams(probes[i], i);
    if (!validation.valid) {
      return validation;
    }
  }

  return { valid: true };
}
