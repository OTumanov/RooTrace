# RooTrace - MCP-Интеграция для Roo Code

## Обзор

RooTrace — это расширение для VSCode, которое обеспечивает революционный **UX без настройки** для отладки с помощью Roo Code. Система автоматически настраивает все необходимое для отладки с искусственным интеллектом без какой-либо ручной настройки.

## Ключевые особенности

### ✨ Автоматический запуск и конфигурация
- Автоматически запускает сервер отладки при открытии VSCode
- Автоматически создает файл `.ai_debug_config` с URL-адресом сервера
- Не требуется ручная настройка

### 🤖 Интеграция с AI Debugger Pro
- Бесшовная интеграция с ролью AI Debugger Pro в Roo Code
- Автоматическое обнаружение и настройка
- Готовый к использованию опыт отладки

### 📊 Интерактивная панель управления
- Живая панель отладки доступна через `AI Debugger Dashboard`
- Отладка на основе гипотез с визуальными индикаторами
- Мониторинг журналов в реальном времени

### 🛡️ Повышенная безопасность и производительность
- **Поддержка CORS**: Полная совместимость с браузером с заголовками CORS
- **Ограничение частоты запросов**: Защита от перегрузки сервера
- **Буферизация**: Оптимизированная производительность для сценариев с высокой частотой
- **Безопасная среда выполнения**: Обертки try-catch вокруг вызовов fetch

## Установка

1. Установите расширение RooTrace из VSCode Marketplace
2. Откройте свой проект в VSCode
3. Расширение автоматически:
   - Запускает сервер отладки на случайном порту
   - Создает `.ai_debug_config` в корне рабочей области
   - Настраивает все необходимые конфигурации

## MCP Integration

### Обзор
RooTrace теперь интегрируется с Model Context Protocol (MCP) для обеспечения расширенных возможностей отладки. Расширение автоматически регистрирует сервер RooTrace MCP, который предоставляет специализированные инструменты отладки:

- `read_runtime_logs` - получает журналы сеанса отладки
- `get_debug_status` - возвращает статус сервера, активные гипотезы и текущий сеанс
- `clear_session` - очищает сеанс отладки, сбрасывает все гипотезы и журналы
- `inject_probes` - внедряет зонды в код для дополнительной информации об отладке

### Настройка без конфигурации
Регистрация MCP-сервера происходит автоматически при активации расширения:
1. Сервер RooTrace MCP регистрируется в системе MCP
2. Все инструменты отладки становятся доступны Roo Code без ручной настройки
3. Система сохраняет обратную совместимость с существующей функциональностью

## Интеграция с Roo Code

Расширение отлично работает с ролью AI Debugger Pro в Roo Code:

### Особенности роли AI Debugger Pro:
- **Фаза 1**: Генерация гипотез (H1, H2, H3...)
- **Фаза 2**: Автоматическая инъекция инструментов
- **Фаза 3**: Сбор данных и наблюдений
- **Фаза 4**: Анализ и выводы
- **Фаза 5**: Автоматическая очистка

### Протокол отладки:
1. **Фаза гипотез**: ИИ генерирует 3-5 проверяемых гипотез
2. **Фаза инструментов**: ИИ внедряет код отладки с маркерами `AI_DEBUG_START`/`AI_DEBUG_END`
3. **Фаза наблюдений**: Запустите приложение и воспроизведите проблему
4. **Фаза анализа**: ИИ анализирует собранные данные по сравнению с гипотезами
5. **Фаза очистки**: Весь отладочный код автоматически удаляется

## Команды

- `Start RooTrace Server` - Вручную запустить сервер
- `Stop RooTrace Server` - Остановить сервер
- `Clear RooTrace Logs` - Очистить все журналы отладки
- `Open RooTrace Dashboard` - Открыть интерактивную панель
- `Cleanup RooTrace Debug Code` - Удалить все отладочные маркеры и конфигурацию

## Особенности панели управления

- **Отслеживание гипотез**: Индикаторы гипотез с цветовой кодировкой (H1=красный, H2=зеленый и т.д.)
- **Обновления в реальном времени**: Потоковые журналы из вашего приложения в реальном времени
- **Структурированные данные**: Форматированная информация об отладке с метками времени
- **Интерактивный интерфейс**: Нажмите для анализа, очистите для сброса

## Конфигурационный файл

Файл `.ai_debug_config` создается автоматически и содержит:
```json
{
  "url": "http://localhost:ПОРТ/",
  "status": "active",
  "timestamp": ЧИСЛО
}
```

## Устранение неполадок

- **Сервер не запускается**: Проверьте, запущен ли другой экземпляр
- **Панель не показывает журналы**: Убедитесь, что ваше приложение отправляет данные на правильную конечную точку
- **Роль ИИ не работает**: Убедитесь, что в Roo Code установлена роль AI Debugger Pro
- **Проблемы с CORS**: Сервер теперь включает правильные заголовки CORS для совместимости с браузером
- **Высокая нагрузка**: Ограничение частоты предотвращает перегрузку сервера

## Архитектура

Расширение состоит из двух основных компонентов:

### 1. HTTP-сервер отладки
- Запускается при активации расширения
- Обрабатывает отладочные сообщения от приложений
- Предоставляет веб-интерфейс панели управления

### 2. MCP-сервер (Model Context Protocol)
- Регистрируется в системе MCP автоматически
- Предоставляет следующие инструменты для отладки:
  - `get_debug_status` - возвращает статус сервера, активные гипотезы и текущий сеанс
  - `read_runtime_logs` - получает логи сеанса отладки
  - `inject_probes` - инъекция проб в код для дополнительной отладочной информации
  - `clear_session` - очищает сеанс отладки, сбрасывает все гипотезы и логи
- Обеспечивает бесшовную интеграцию с AI-агентами через протокол MCP

## Лицензия

MIT

---

# RooTrace - MCP Integration for Roo Code

## Overview

RooTrace is a VSCode extension that provides a revolutionary **zero-config UX** for debugging with Roo Code. The system automatically sets up everything needed for AI-powered debugging without any manual configuration.

## Key Features

### ✨ Automatic Launch & Configuration
- Automatically launches the debug server when opening VSCode
- Automatically creates `.ai_debug_config` file with the server URL
- No manual setup required

### 🤖 AI Debugger Pro Integration
- Seamless integration with AI Debugger Pro role in Roo Code
- Automatic discovery and configuration
- Ready-to-use debugging experience

### 📊 Interactive Dashboard
- Live debugging dashboard accessible via `AI Debugger Dashboard`
- Hypothesis-based debugging with visual indicators
- Real-time log monitoring

### 🛡️ Enhanced Security & Performance
- **CORS Support**: Full browser compatibility with CORS headers
- **Rate Limiting**: Protection against server overload
- **Buffering**: Optimized performance for high-frequency scenarios
- **Safe Runtime**: Try-catch wrappers around fetch calls

## Installation

1. Install the RooTrace extension from VSCode Marketplace
2. Open your project in VSCode
3. The extension will automatically:
   - Launch the debug server on a random port
   - Create `.ai_debug_config` in the workspace root
   - Set up all necessary configurations

## MCP Integration

### Overview
RooTrace now integrates with the Model Context Protocol (MCP) to provide enhanced debugging capabilities. The extension automatically registers the RooTrace MCP server which exposes specialized debugging tools:

- `read_runtime_logs` - retrieves debugging session logs
- `get_debug_status` - returns server status, active hypotheses and current session
- `clear_session` - clears debugging session, resets all hypotheses and logs
- `inject_probes` - injects probes into code for additional debugging information

### Zero-Config Setup
The MCP server registration happens automatically when the extension activates:
1. The RooTrace MCP server is registered with the MCP system
2. All debugging tools become available to Roo Code without manual configuration
3. The system maintains backward compatibility with existing functionality

## Roo Code Integration

The extension works great with the AI Debugger Pro role in Roo Code:

### AI Debugger Pro Role Features:
- **Phase 1**: Hypothesis Generation (H1, H2, H3...)
- **Phase 2**: Automatic Instrumentation
- **Phase 3**: Data Collection & Observations
- **Phase 4**: Analysis & Conclusions
- **Phase 5**: Automatic Cleanup

### Debugging Protocol:
1. **Hypothesis Phase**: AI generates 3-5 testable hypotheses
2. **Instrumentation Phase**: AI injects debugging code with `AI_DEBUG_START`/`AI_DEBUG_END` markers
3. **Observation Phase**: Run your application and reproduce the issue
4. **Analysis Phase**: AI analyzes collected data against hypotheses
5. **Cleanup Phase**: All debug code is automatically removed

## Commands

- `Start RooTrace Server` - Manually start the server
- `Stop RooTrace Server` - Stop the server
- `Clear RooTrace Logs` - Clear all debugging logs
- `Open RooTrace Dashboard` - Open the interactive panel
- `Cleanup RooTrace Debug Code` - Remove all debug markers and configuration

## Dashboard Features

- **Hypothesis Tracking**: Color-coded hypothesis indicators (H1=red, H2=green, etc.)
- **Real-time Updates**: Streaming logs from your application in real-time
- **Structured Data**: Formatted debugging information with timestamps
- **Interactive Interface**: Click to analyze, clear to reset

## Configuration File

The `.ai_debug_config` file is automatically created and contains:
```json
{
  "url": "http://localhost:PORT/",
  "status": "active",
  "timestamp": NUMBER
}
```

## Troubleshooting

- **Server won't start**: Check if another instance is running
- **Dashboard doesn't show logs**: Ensure your application is sending data to the correct endpoint
- **AI role isn't working**: Make sure the AI Debugger Pro role is installed in Roo Code
- **CORS issues**: Server now includes proper CORS headers for browser compatibility
- **High load**: Rate limiting prevents server overload

## Development

The extension uses Node.js HTTP server and React for the dashboard UI, providing a robust foundation for AI-powered debugging with enhanced security and performance optimization.

## License

MIT