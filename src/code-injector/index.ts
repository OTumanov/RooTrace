/**
 * Централизованный экспорт для модуля code-injector
 * 
 * Используйте этот файл для импорта:
 * ```typescript
 * import { InjectionResult, getServerUrl } from './code-injector';
 * ```
 */

// Типы
export * from './types';

// Конфигурация
export * from './config/server-url';
export * from './config/config-reader';

// Генераторы
export { getGenerator } from './generators/generator-factory';
export * from './generators/base-generator';
export * from './generators/python-generator';
export * from './generators/javascript-generator';
export * from './generators/go-generator';
export * from './generators/java-generator';
export * from './generators/rust-generator';
export * from './generators/cpp-generator';
export * from './generators/php-generator';
export * from './generators/ruby-generator';
export * from './generators/csharp-generator';
export * from './generators/swift-generator';
export * from './generators/kotlin-generator';
export * from './generators/fallback-generator';

// Валидаторы
export { getValidator } from './validation/validator-factory';
export * from './validation/base-validator';
export * from './validation/python-validator';
export * from './validation/javascript-validator';
export * from './validation/typescript-validator';
export * from './validation/go-validator';
export * from './validation/java-validator';
export * from './validation/rust-validator';
export * from './validation/cpp-validator';
export * from './validation/php-validator';
export * from './validation/ruby-validator';
export * from './validation/csharp-validator';
export * from './validation/swift-validator';
export * from './validation/kotlin-validator';

// Host Detection
export * from './host-detection/python-host-init';
export * from './host-detection/go-host-init';
export * from './host-detection/host-init-registry';

// Positioning
export * from './positioning/types';
export * from './positioning/insertion-position';
export * from './positioning/python-positioning';
export * from './positioning/indentation-handler';

// Core
export { 
  getAllProbes, 
  getProbe, 
  registerProbe,
  removeProbeFromRegistry,
  removeProbesForFile,
  clearRegistry,
  getProbeCount
} from './core/probe-registry';
export { injectProbe, generateProbeCode } from './core/probe-injector';
export { removeProbe, removeAllProbesFromFile } from './core/probe-remover';
