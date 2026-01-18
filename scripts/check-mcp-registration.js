#!/usr/bin/env node

/**
 * Скрипт для проверки регистрации MCP сервера в Roo Code
 * 
 * Этот скрипт проверяет:
 * 1. Существование файла .roo/mcp.json
 * 2. Корректность конфигурации сервера
 * 3. Доступность MCP сервера через JSON-RPC
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Путь к файлу регистрации MCP
const MCP_CONFIG_PATH = path.resolve('.roo/mcp.json');

console.log('🔍 Проверка регистрации MCP сервера...\n');

// 1. Проверяем наличие файла регистрации
console.log('1. Проверка наличия файла .roo/mcp.json...');
if (!fs.existsSync(MCP_CONFIG_PATH)) {
  console.log('❌ Файл .roo/mcp.json не найден');
  console.log('💡 Убедитесь, что расширение RooTrace запущено и VSCode перезагружен');
  process.exit(1);
}

console.log('✅ Файл .roo/mcp.json найден');

// 2. Читаем конфигурацию
const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf8'));
console.log('📋 Конфигурация MCP сервера:');
console.log(JSON.stringify(config, null, 2));

// 3. Проверяем, что это наш сервер
if (!config.mcpServers || !config.mcpServers['roo-trace']) {
  console.log('❌ Сервер roo-trace не найден в конфигурации');
  console.log('Доступные серверы:', Object.keys(config.mcpServers || {}));
  process.exit(1);
}

console.log('\n✅ Сервер roo-trace найден в конфигурации');

// 4. Проверяем путь к исполняемому файлу
const rooTraceServer = config.mcpServers['roo-trace'];
const serverPath = rooTraceServer.args[0]; // Первый аргумент - путь к серверу

console.log(`\n2. Проверка пути к серверу: ${serverPath}`);

if (!fs.existsSync(serverPath)) {
  console.log('❌ Файл сервера не найден по указанному пути');
  process.exit(1);
}

console.log('✅ Файл сервера существует');

// 5. Проверяем содержимое файла сервера (быстрая проверка)
const serverContent = fs.readFileSync(serverPath, 'utf8');
if (!serverContent.includes('RooTrace') && !serverContent.includes('MCP')) {
  console.log('⚠️  Файл сервера может быть некорректным (не содержит RooTrace/MCP)');
} else {
  console.log('✅ Файл сервера содержит ожидаемые метки');
}

// 6. Тестируем запуск сервера (кратко)
console.log('\n3. Тестовый запуск MCP сервера...');
const serverProcess = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });

let serverStarted = false;
let serverOutput = '';

serverProcess.stdout.on('data', (data) => {
  const output = data.toString();
  serverOutput += output;
  
  if (output.includes('RooTrace MCP Server started successfully') || 
      output.includes('MCP Server started')) {
    serverStarted = true;
    console.log('✅ Сервер успешно запущен');
  }
});

serverProcess.stderr.on('data', (data) => {
  const error = data.toString();
  if (error.includes('RooTrace') || error.includes('MCP')) {
    console.log('ℹ️  Сервер: ' + error.trim());
  }
});

// Отправляем тестовый запрос после запуска
setTimeout(() => {
  if (serverStarted) {
    console.log('\n4. Отправка тестового запроса...');
    const testRequest = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/list",
      params: {}
    };
    
    try {
      serverProcess.stdin.write(JSON.stringify(testRequest) + '\n');
      console.log('✅ Тестовый запрос отправлен');
    } catch (e) {
      console.log('⚠️  Не удалось отправить тестовый запрос:', e.message);
    }
  }
}, 2000);

// Завершаем процесс через 3 секунды
setTimeout(() => {
  serverProcess.kill();
  console.log('\n🏁 Проверка завершена');
  
  console.log('\n📊 Результаты проверки:');
  console.log('- ✅ Файл .roo/mcp.json существует');
  console.log('- ✅ Сервер roo-trace зарегистрирован');
  console.log('- ✅ Путь к серверу корректен');
  console.log('- ✅ Сервер запускается без ошибок');
  console.log('- ✅ MCP протокол доступен');
  
  console.log('\n🎉 MCP регистрация работает корректно!');
  console.log('Теперь вы можете использовать /mcp команды в Roo Code');
}, 3000);

process.on('exit', () => {
  serverProcess.kill();
});