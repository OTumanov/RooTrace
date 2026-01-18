const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_PATH = path.resolve(__dirname, '../out/mcp-server.js');
const TEST_FILE = path.resolve(__dirname, './test-target.js');

// Создаем подопытный файл
fs.writeFileSync(TEST_FILE, 'function hello() {\n  console.log("world");\n}');

const server = spawn('node', [SERVER_PATH]);

function send(method, params = {}) {
    const msg = { jsonrpc: "2.0", id: Date.now(), method, params };
    server.stdin.write(JSON.stringify(msg) + '\n');
}

server.stdout.on('data', (data) => {
    const res = JSON.parse(data.toString());
    console.log('✅ Ответ:', JSON.stringify(res, null, 2));
    
    // Если это был ответ на inject_probes, проверяем файл
    if (res.result && res.result.content && res.result.content[0].text.includes('Successfully injected')) {
        const content = fs.readFileSync(TEST_FILE, 'utf8');
        if (content.includes('AI_DEBUG_START')) {
            console.log('🚀 ТЕСТ ПРОЙДЕН: Код успешно впрыснут!');
        }
    }
});

server.stderr.on('data', (data) => console.log('ℹ️ Log:', data.toString()));

// Последовательность действий
setTimeout(() => {
    console.log('1. Запрашиваем список инструментов...');
    send('tools/list');
}, 1000);

setTimeout(() => {
    console.log('2. Пробуем инъекцию...');
    send('tools/call', {
        name: 'inject_probes',
        arguments: {
            filePath: TEST_FILE,
            lineNumber: 2,
            probeType: 'log',
            message: 'MCP Test Probe'
        }
    });
}, 2000);

setTimeout(() => {
    console.log('3. Завершаем...');
    server.kill();
    fs.unlinkSync(TEST_FILE); // Чистим за собой
}, 4000);