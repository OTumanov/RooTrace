/**
 * Главный файл code-injector - реэкспорт всех функций для обратной совместимости
 * 
 * После рефакторинга этот файл содержит только реэкспорты из модулей.
 * Вся логика вынесена в специализированные модули в подкаталогах.
 */

// Реэкспорт типов для обратной совместимости
export { 
  InjectionResult, 
  ProbeInfo, 
  SyntaxValidationResult,
  ProbeCodeGenerator,
  SyntaxValidator,
  ProbeGenerationOptions
} from './code-injector/types';

// Реэкспорт функций конфигурации
export { getServerUrl } from './code-injector/config/server-url';

// Реэкспорт core функций
export { injectProbe } from './code-injector/core/probe-injector';
export { removeProbe, removeAllProbesFromFile } from './code-injector/core/probe-remover';
export { 
  getAllProbes, 
  getProbe, 
  clearRegistry as clearProbeRegistryForTesting 
} from './code-injector/core/probe-registry';

// Реэкспорт функции генерации кода (для обратной совместимости)
export { generateProbeCode } from './code-injector/core/probe-injector';