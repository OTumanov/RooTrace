/**
 * Реестр проб - управление информацией о всех инъектированных пробах
 */

import { ProbeInfo } from '../types';

/**
 * Внутреннее хранилище для информации о пробах
 */
const probeRegistry = new Map<string, ProbeInfo>();

/**
 * Получает информацию о всех зарегистрированных пробах
 * 
 * Возвращает список всех проб, которые были успешно инъектированы в текущей сессии.
 * Каждая проба содержит информацию о файле, позиции, типе и сообщении.
 * 
 * @returns Массив объектов ProbeInfo с информацией о всех пробах
 * 
 * @example
 * ```typescript
 * const probes = getAllProbes();
 * console.log(`Total probes: ${probes.length}`);
 * probes.forEach(probe => {
 *   console.log(`Probe ${probe.id} in ${probe.filePath}:${probe.lineNumber}`);
 * });
 * ```
 */
export function getAllProbes(): ProbeInfo[] {
  return Array.from(probeRegistry.values());
}

/**
 * Получает информацию о пробе по её ID
 * 
 * @param probeId - ID пробы
 * @returns Информация о пробе или undefined, если проба не найдена
 */
export function getProbe(probeId: string): ProbeInfo | undefined {
  return probeRegistry.get(probeId);
}

/**
 * Регистрирует новую пробу в реестре
 * 
 * @param probeId - ID пробы
 * @param probeInfo - Информация о пробе
 */
export function registerProbe(probeId: string, probeInfo: ProbeInfo): void {
  probeRegistry.set(probeId, probeInfo);
}

/**
 * Удаляет пробу из реестра
 * 
 * @param probeId - ID пробы для удаления
 * @returns true, если проба была удалена, false если не найдена
 */
export function removeProbeFromRegistry(probeId: string): boolean {
  return probeRegistry.delete(probeId);
}

/**
 * Удаляет все пробы из реестра для указанного файла
 * 
 * @param filePath - Путь к файлу
 * @returns Количество удаленных проб
 */
export function removeProbesForFile(filePath: string): number {
  let removedCount = 0;
  const registryEntries = Array.from(probeRegistry.entries());
  
  for (const [probeId, probe] of registryEntries) {
    const probeFilePath = probe.filePath;
    // Сравниваем пути с учетом нормализации
    if (probeFilePath === filePath) {
      probeRegistry.delete(probeId);
      removedCount++;
    }
  }
  
  return removedCount;
}

/**
 * Очищает реестр проб (используется только для тестирования)
 * 
 * Удаляет все записи о пробах из внутреннего реестра. Используется в unit-тестах
 * для изоляции тестовых случаев.
 * 
 * @internal
 * @example
 * ```typescript
 * // В тесте
 * clearRegistry();
 * // Теперь реестр пуст
 * ```
 */
export function clearRegistry(): void {
  probeRegistry.clear();
}

/**
 * Получает количество проб в реестре
 * 
 * @returns Количество зарегистрированных проб
 */
export function getProbeCount(): number {
  return probeRegistry.size;
}
