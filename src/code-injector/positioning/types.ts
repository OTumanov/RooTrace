/**
 * Типы для модуля positioning
 */

/**
 * Результат определения позиции вставки
 */
export interface InsertionPosition {
  /**
   * Индекс строки для вставки (0-based)
   */
  insertIndex: number;
  
  /**
   * Базовый отступ для вставки
   */
  baseIndent: string;
  
  /**
   * Была ли позиция скорректирована относительно запрошенной
   */
  adjusted: boolean;
  
  /**
   * Причина корректировки (если была)
   */
  adjustmentReason?: string;
}

/**
 * Контекст для определения позиции вставки
 */
export interface PositioningContext {
  /**
   * Содержимое файла, разбитое на строки
   */
  lines: string[];
  
  /**
   * Индекс целевой строки (0-based)
   */
  lineIndex: number;
  
  /**
   * Язык программирования
   */
  language: string;
  
  /**
   * Содержимое целевой строки
   */
  originalCode: string;
  
  /**
   * Обрезанное содержимое целевой строки
   */
  trimmedCode: string;
}
