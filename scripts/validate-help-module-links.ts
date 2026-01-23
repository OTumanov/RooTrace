#!/usr/bin/env node
/**
 * Скрипт валидации ссылок в help-модуле
 * Проверяет, что все ссылки на модули указывают на существующие файлы
 */

import * as fs from 'fs';
import * as path from 'path';

const HELP_MODULE_PATH = path.join(process.cwd(), '.roo', 'roo-trace-rules', '00-help-operations.md');
const RULES_DIR = path.join(process.cwd(), '.roo', 'roo-trace-rules');

interface ValidationResult {
    link: string;
    moduleName: string;
    exists: boolean;
    fullPath: string;
}

function extractModuleLinks(content: string): string[] {
    const links: string[] = [];
    
    // Паттерн для поиска ссылок: load_rule(rulePath="имя-модуля.md")
    const pattern = /load_rule\s*\(\s*rulePath\s*=\s*["']([^"']+\.md)["']\s*\)/gi;
    
    let match;
    while ((match = pattern.exec(content)) !== null) {
        const moduleName = match[1];
        // Убираем путь, если есть (оставляем только имя файла)
        const fileName = path.basename(moduleName);
        if (!links.includes(fileName)) {
            links.push(fileName);
        }
    }
    
    // Также ищем ссылки в markdown формате: `имя-модуля.md`
    const markdownPattern = /`([a-z0-9-]+\.md)`/gi;
    while ((match = markdownPattern.exec(content)) !== null) {
        const moduleName = match[1];
        if (!links.includes(moduleName)) {
            links.push(moduleName);
        }
    }
    
    return links;
}

function validateLinks(links: string[]): ValidationResult[] {
    const results: ValidationResult[] = [];
    
    for (const link of links) {
        const moduleName = path.basename(link);
        const fullPath = path.join(RULES_DIR, moduleName);
        const exists = fs.existsSync(fullPath);
        
        results.push({
            link,
            moduleName,
            exists,
            fullPath
        });
    }
    
    return results;
}

function main() {
    console.log('🔍 Валидация ссылок в help-модуле...\n');
    
    // Проверяем существование help-модуля
    if (!fs.existsSync(HELP_MODULE_PATH)) {
        console.error(`❌ Help-модуль не найден: ${HELP_MODULE_PATH}`);
        console.error('   Создайте help-модуль перед валидацией.');
        process.exit(1);
    }
    
    // Проверяем существование директории с правилами
    if (!fs.existsSync(RULES_DIR)) {
        console.error(`❌ Директория с правилами не найдена: ${RULES_DIR}`);
        console.error('   Создайте директорию .roo/roo-trace-rules/ перед валидацией.');
        process.exit(1);
    }
    
    // Читаем help-модуль
    const content = fs.readFileSync(HELP_MODULE_PATH, 'utf8');
    
    // Извлекаем ссылки
    const links = extractModuleLinks(content);
    console.log(`📋 Найдено ссылок: ${links.length}\n`);
    
    // Валидируем ссылки
    const results = validateLinks(links);
    
    // Выводим результаты
    const validLinks = results.filter(r => r.exists);
    const invalidLinks = results.filter(r => !r.exists);
    
    console.log('✅ Валидные ссылки:');
    for (const result of validLinks) {
        console.log(`   ✓ ${result.moduleName}`);
    }
    
    if (invalidLinks.length > 0) {
        console.log('\n❌ Невалидные ссылки:');
        for (const result of invalidLinks) {
            console.log(`   ✗ ${result.moduleName} (файл не найден: ${result.fullPath})`);
        }
        console.log('\n⚠️  ВНИМАНИЕ: Некоторые ссылки указывают на несуществующие файлы!');
        process.exit(1);
    }
    
    console.log('\n✅ Все ссылки валидны!');
}

if (require.main === module) {
    main();
}

export { extractModuleLinks, validateLinks };
