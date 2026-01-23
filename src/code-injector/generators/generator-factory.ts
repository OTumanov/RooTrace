/**
 * Фабрика генераторов кода проб
 */

import { ProbeCodeGenerator } from '../types';
import { PythonGenerator } from './python-generator';
import { JavaScriptGenerator } from './javascript-generator';
import { GoGenerator } from './go-generator';
import { JavaGenerator } from './java-generator';
import { RustGenerator } from './rust-generator';
import { CppGenerator } from './cpp-generator';
import { PhpGenerator } from './php-generator';
import { RubyGenerator } from './ruby-generator';
import { CSharpGenerator } from './csharp-generator';
import { SwiftGenerator } from './swift-generator';
import { KotlinGenerator } from './kotlin-generator';
import { FallbackGenerator } from './fallback-generator';

/**
 * Реестр генераторов по языкам
 */
class GeneratorRegistry {
  private generators = new Map<string, ProbeCodeGenerator>();

  constructor() {
    // Регистрируем все генераторы
    this.register(new PythonGenerator());
    this.register(new JavaScriptGenerator());
    this.register(new GoGenerator());
    this.register(new JavaGenerator());
    this.register(new RustGenerator());
    this.register(new CppGenerator());
    this.register(new PhpGenerator());
    this.register(new RubyGenerator());
    this.register(new CSharpGenerator());
    this.register(new SwiftGenerator());
    this.register(new KotlinGenerator());
    // FallbackGenerator регистрируем последним, но не для конкретных языков
    // Он используется через специальную логику в get()
    const fallback = new FallbackGenerator();
    // Регистрируем fallback для явного использования
    this.generators.set('fallback', fallback);
  }

  /**
   * Регистрирует генератор для языков
   */
  private register(generator: ProbeCodeGenerator): void {
    for (const lang of generator.supportedLanguages) {
      this.generators.set(lang.toLowerCase(), generator);
    }
  }

  /**
   * Получает генератор для указанного языка
   * Если язык не найден, возвращает FallbackGenerator
   */
  get(language: string): ProbeCodeGenerator | null {
    const generator = this.generators.get(language.toLowerCase());
    if (generator) {
      return generator;
    }
    // Если язык не найден, возвращаем FallbackGenerator
    return this.generators.get('fallback') || null;
  }

  /**
   * Получает все зарегистрированные языки
   */
  getSupportedLanguages(): string[] {
    return Array.from(this.generators.keys());
  }
}

// Singleton экземпляр реестра
const registry = new GeneratorRegistry();

/**
 * Получает генератор для указанного языка
 * @param language Язык программирования
 * @returns Генератор или null, если язык не поддерживается
 */
export function getGenerator(language: string): ProbeCodeGenerator | null {
  return registry.get(language);
}

/**
 * Получает все поддерживаемые языки
 */
export function getSupportedLanguages(): string[] {
  return registry.getSupportedLanguages();
}
