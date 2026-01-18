const fs = require('fs');
const path = require('path');

// Проверка MCP-интеграции
function testMCPIntegration() {
    console.log('🔍 Проверка MCP-интеграции...\n');
    
    // Проверяем наличие mcpConfig.json
    const configPath = path.join(__dirname, '../mcpConfig.json');
    if (!fs.existsSync(configPath)) {
        console.error('❌ Файл mcpConfig.json не найден!');
        return false;
    }
    
    console.log('✅ Файл mcpConfig.json найден');
    
    try {
        // Читаем и парсим конфигурацию
        const configData = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configData);
        
        // Проверяем структуру mcpConfig.json
        if (!config.servers || !Array.isArray(config.servers)) {
            console.error('❌ Неверная структура mcpConfig.json: отсутствует массив servers');
            return false;
        }
        
        console.log(`✅ mcpConfig.json имеет правильную структуру, найдено ${config.servers.length} серверов`);
        
        // Проверяем наличие RooTrace сервера
        const rooTraceServer = config.servers.find(server => 
            server.name === 'roo-trace' || server.name === 'RooTrace'
        );
        
        if (!rooTraceServer) {
            console.error('❌ Сервер RooTrace не найден в mcpConfig.json');
            return false;
        }
        
        console.log('✅ Сервер RooTrace найден в конфигурации');
        
        // Проверяем наличие инструментов
        if (!rooTraceServer.tools || !Array.isArray(rooTraceServer.tools)) {
            console.error('❌ У сервера RooTrace отсутствуют инструменты или они не являются массивом');
            return false;
        }
        
        console.log(`✅ У сервера RooTrace найдено ${rooTraceServer.tools.length} инструментов`);
        
        // Проверяем каждый инструмент
        const expectedTools = [
            'roo_trace_start_session',
            'roo_trace_stop_session', 
            'roo_trace_add_event',
            'roo_trace_get_events',
            'roo_trace_clear_events',
            'roo_trace_export_trace'
        ];
        
        const foundTools = rooTraceServer.tools.map(tool => tool.name);
        const missingTools = expectedTools.filter(tool => !foundTools.includes(tool));
        
        if (missingTools.length > 0) {
            console.error(`❌ Отсутствуют следующие инструменты: ${missingTools.join(', ')}`);
            return false;
        }
        
        console.log('✅ Все ожидаемые инструменты присутствуют');
        
        // Проверяем пути к файлам инструментов
        for (const tool of rooTraceServer.tools) {
            if (tool.handler && typeof tool.handler === 'object' && tool.handler.type === 'stdio') {
                const scriptPath = path.join(__dirname, '..', tool.handler.command);
                
                if (!fs.existsSync(scriptPath)) {
                    console.error(`❌ Файл инструмента не найден: ${scriptPath}`);
                    return false;
                }
                
                console.log(`✅ Файл инструмента найден: ${tool.name}`);
            } else {
                console.warn(`⚠️  Инструмент ${tool.name} не использует stdio handler`);
            }
        }
        
        // Проверяем наличие основного файла mcp-сервера
        const serverPath = path.join(__dirname, '../out/mcp-server.js');
        if (!fs.existsSync(serverPath)) {
            console.error('❌ Основной файл mcp-сервера не найден: out/mcp-server.js');
            return false;
        }
        
        console.log('✅ Основной файл mcp-сервера найден');
        
        console.log('\n🎉 Все проверки MCP-интеграции пройдены успешно!');
        return true;
        
    } catch (error) {
        console.error('❌ Ошибка при чтении или парсинге mcpConfig.json:', error.message);
        return false;
    }
}

// Запуск проверки
const success = testMCPIntegration();
process.exit(success ? 0 : 1);