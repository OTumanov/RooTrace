const fs = require('fs');
const path = require('path');

// Проверка сборки
function verifyBuild() {
    console.log('🔍 Проверка сборки...\n');
    
    let success = true;
    
    // Проверяем наличие скомпилированных файлов
    const compiledFiles = [
        'out/extension.js',
        'out/mcp-server.js',
        'out/mcp-handler.js',
        'out/mcp-registration.js',
        'out/code-injector.js'
    ];
    
    for (const file of compiledFiles) {
        const filePath = path.join(__dirname, '..', file);
        if (!fs.existsSync(filePath)) {
            console.error(`❌ Скомпилированный файл не найден: ${file}`);
            success = false;
        } else {
            console.log(`✅ Скомпилированный файл найден: ${file}`);
        }
    }
    
    // Проверяем package.json
    const packageJsonPath = path.join(__dirname, '../package.json');
    if (!fs.existsSync(packageJsonPath)) {
        console.error('❌ Файл package.json не найден!');
        return false;
    }
    
    console.log('✅ Файл package.json найден');
    
    try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        
        // Проверяем main entry
        if (!packageJson.main || packageJson.main !== './out/extension.js') {
            console.error('❌ Неверное значение поля main в package.json');
            success = false;
        } else {
            console.log('✅ Поле main в package.json корректно');
        }
        
        // Проверяем activationEvents
        if (!packageJson.activationEvents || packageJson.activationEvents.length === 0) {
            console.error('❌ Поле activationEvents в package.json отсутствует или пустое');
            success = false;
        } else {
            console.log('✅ Поле activationEvents в package.json присутствует');
        }
        
        // Проверяем contributons.mcpServers (опционально)
        if (!packageJson.contributes || !packageJson.contributes.mcpServers) {
            console.warn('⚠️  Поле contributes.mcpServers в package.json отсутствует (опционально)');
        } else {
            console.log('✅ Поле contributes.mcpServers в package.json присутствует');
        }
        
        // Проверяем зависимости
        const dependencies = packageJson.dependencies || {};
        const devDependencies = packageJson.devDependencies || {};
        const allDeps = { ...dependencies, ...devDependencies };
        
        const requiredDeps = ['vscode'];
        
        for (const dep of requiredDeps) {
            if (!allDeps[dep]) {
                console.warn(`⚠️  Зависимость ${dep} не найдена в package.json (опционально, т.к. @types/vscode присутствует)`);
            } else {
                console.log(`✅ Зависимость ${dep} найдена в package.json`);
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка при чтении или парсинге package.json:', error.message);
        return false;
    }
    
    // Проверяем наличие tsconfig.json
    const tsconfigPath = path.join(__dirname, '../tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) {
        console.error('❌ Файл tsconfig.json не найден!');
        success = false;
    } else {
        console.log('✅ Файл tsconfig.json найден');
    }
    
    // Проверяем наличие исходных файлов
    const sourceFiles = [
        'src/extension.ts',
        'src/mcp-server.ts',
        'src/mcp-handler.ts',
        'src/mcp-registration.ts',
        'src/code-injector.ts'
    ];
    
    for (const file of sourceFiles) {
        const filePath = path.join(__dirname, '..', file);
        if (!fs.existsSync(filePath)) {
            console.error(`❌ Исходный файл не найден: ${file}`);
            success = false;
        } else {
            console.log(`✅ Исходный файл найден: ${file}`);
        }
    }
    
    if (success) {
        console.log('\n🎉 Все проверки сборки пройдены успешно!');
    } else {
        console.log('\n❌ Некоторые проверки сборки не пройдены');
    }
    
    return success;
}

// Запуск проверки
const success = verifyBuild();
process.exit(success ? 0 : 1);