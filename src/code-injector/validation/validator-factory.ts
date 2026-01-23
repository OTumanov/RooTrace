/**
 * Фабрика валидаторов синтаксиса
 */

import { SyntaxValidator } from '../types';
import { PythonValidator } from './python-validator';
import { JavaScriptValidator } from './javascript-validator';
import { TypeScriptValidator } from './typescript-validator';
import { GoValidator } from './go-validator';
import { JavaValidator } from './java-validator';
import { RustValidator } from './rust-validator';
import { CppValidator } from './cpp-validator';
import { PhpValidator } from './php-validator';
import { RubyValidator } from './ruby-validator';
import { CSharpValidator } from './csharp-validator';
import { SwiftValidator } from './swift-validator';
import { KotlinValidator } from './kotlin-validator';

/**
 * Реестр валидаторов по языкам
 */
class ValidatorRegistry {
  private validators = new Map<string, SyntaxValidator>();

  constructor() {
    // Регистрируем все валидаторы
    this.register(new PythonValidator());
    this.register(new JavaScriptValidator());
    this.register(new TypeScriptValidator());
    this.register(new GoValidator());
    this.register(new JavaValidator());
    this.register(new RustValidator());
    this.register(new CppValidator());
    this.register(new PhpValidator());
    this.register(new RubyValidator());
    this.register(new CSharpValidator());
    this.register(new SwiftValidator());
    this.register(new KotlinValidator());
  }

  /**
   * Регистрирует валидатор для языков
   */
  private register(validator: SyntaxValidator): void {
    for (const lang of validator.supportedLanguages) {
      this.validators.set(lang.toLowerCase(), validator);
    }
  }

  /**
   * Получает валидатор для указанного языка
   */
  get(language: string): SyntaxValidator | null {
    return this.validators.get(language.toLowerCase()) || null;
  }

  /**
   * Получает все зарегистрированные языки
   */
  getSupportedLanguages(): string[] {
    return Array.from(this.validators.keys());
  }
}

// Singleton экземпляр реестра
const registry = new ValidatorRegistry();

/**
 * Получает валидатор для указанного языка
 * @param language Язык программирования
 * @returns Валидатор или null, если язык не поддерживается
 */
export function getValidator(language: string): SyntaxValidator | null {
  return registry.get(language);
}

/**
 * Получает все поддерживаемые языки
 */
export function getSupportedLanguages(): string[] {
  return registry.getSupportedLanguages();
}
