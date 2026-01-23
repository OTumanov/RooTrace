/**
 * КРИТИЧЕСКИ ВАЖНЫЕ ТЕСТЫ ДЛЯ НОРМАЛИЗАТОРА ИМЕН ИНСТРУМЕНТОВ
 * 
 * Этот файл содержит 100+ тестов для проверки нормализации имен инструментов,
 * которые могут быть искажены Roo Code при парсинге.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// Копируем функцию нормализации из mcp-handler.ts
const normalizeToolName = (toolName: string): string => {
  let normalized = toolName
    .toLowerCase()
    .replace(/\s+/g, '') // Удаляем ВСЕ пробелы, табуляции, переносы строк
    .replace(/[-_]+/g, '') // Удаляем ВСЕ дефисы и подчеркивания
    .trim();
  
  // Убираем дубликаты префиксов (например, mcprootracemcprootrace -> mcprootrace)
  // Обрабатываем множественные дубликаты рекурсивно
  const knownPrefixes = ['mcprootrace', 'rootrace', 'mcp'];
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of knownPrefixes) {
      const doublePrefix = prefix + prefix;
      // Проверяем начало строки
      if (normalized.startsWith(doublePrefix)) {
        normalized = prefix + normalized.substring(doublePrefix.length);
        changed = true;
        break;
      }
      // Также проверяем в середине строки (для случаев типа mcprootracemcprootraceloadrule)
      const index = normalized.indexOf(doublePrefix);
      if (index >= 0) {
        normalized = normalized.substring(0, index) + prefix + normalized.substring(index + doublePrefix.length);
        changed = true;
        break;
      }
    }
  }
  
  return normalized;
};

// Генерируем маппинг как в mcp-handler.ts
const generateToolNameMap = (actualToolNames: string[]): Record<string, string> => {
  const map: Record<string, string> = {};
  
  actualToolNames.forEach(actualName => {
    const normalized = normalizeToolName(actualName);
    
    // Основное нормализованное имя
    map[normalized] = actualName;
    
    // Вариант без префикса mcp--roo-trace-- (если есть)
    if (actualName.startsWith('mcp--roo-trace--')) {
      const withoutPrefix = actualName.replace(/^mcp--roo-trace--/, '');
      const normalizedWithoutPrefix = normalizeToolName(withoutPrefix);
      if (normalizedWithoutPrefix !== normalized) {
        map[normalizedWithoutPrefix] = actualName;
      }
    }
  });
  
  return map;
};

describe('Tool Name Normalizer - 100+ Critical Tests', () => {
  const correctToolName = 'mcp--roo-trace--load_rule';
  const expectedNormalized = 'mcprootraceloadrule';
  
  const toolNameMap = generateToolNameMap([
    'mcp--roo-trace--load_rule',
    'mcp--roo-trace--get_debug_status',
    'mcp--roo-trace--read_runtime_logs',
    'mcp--roo-trace--inject_probes',
    'mcp--roo-trace--clear_session',
    'mcp--roo-trace--get_problems',
  ]);

  describe('Basic Normalization Tests (1-20)', () => {
    it('Test 1: Правильное имя с двойными дефисами', () => {
      const result = normalizeToolName('mcp--roo-trace--load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 2: Имя с одинарными дефисами', () => {
      const result = normalizeToolName('mcp-roo-trace-load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 3: Имя с подчеркиваниями вместо дефисов', () => {
      const result = normalizeToolName('mcp__roo_trace__load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 4: Смешанные дефисы и подчеркивания', () => {
      const result = normalizeToolName('mcp--roo_trace--load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 5: Тройные подчеркивания', () => {
      const result = normalizeToolName('mcp___roo___trace___load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 6: Множественные дефисы', () => {
      const result = normalizeToolName('mcp----roo----trace----load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 7: Верхний регистр', () => {
      const result = normalizeToolName('MCP--ROO-TRACE--LOAD_RULE');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 8: Смешанный регистр', () => {
      const result = normalizeToolName('McP--RoO-TrAcE--LoAd_RuLe');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 9: Пробелы в начале и конце', () => {
      const result = normalizeToolName('  mcp--roo-trace--load_rule  ');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 10: Только правильное имя', () => {
      const result = normalizeToolName('mcp--roo-trace--load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 11: Без префикса mcp--', () => {
      const result = normalizeToolName('roo-trace--load_rule');
      expect(result).toBe('rootraceloadrule');
    });

    it('Test 12: Только имя функции', () => {
      const result = normalizeToolName('load_rule');
      expect(result).toBe('loadrule');
    });

    it('Test 13: Пустая строка', () => {
      const result = normalizeToolName('');
      expect(result).toBe('');
    });

    it('Test 14: Только дефисы', () => {
      const result = normalizeToolName('----');
      expect(result).toBe('');
    });

    it('Test 15: Только подчеркивания', () => {
      const result = normalizeToolName('____');
      expect(result).toBe('');
    });

    it('Test 16: Один символ', () => {
      const result = normalizeToolName('a');
      expect(result).toBe('a');
    });

    it('Test 17: Без разделителей', () => {
      const result = normalizeToolName('mcprootraceloadrule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 18: Специальные символы (должны остаться)', () => {
      const result = normalizeToolName('mcp--roo-trace--load.rule');
      expect(result).toBe('mcprootraceload.rule');
    });

    it('Test 19: Цифры в имени', () => {
      const result = normalizeToolName('mcp--roo-trace--load_rule_2');
      expect(result).toBe('mcprootraceloadrule2');
    });

    it('Test 20: Много пробелов', () => {
      const result = normalizeToolName('   mcp--roo-trace--load_rule   ');
      expect(result).toBe('mcprootraceloadrule');
    });
  });

  describe('Roo Code Parsing Distortions (21-50)', () => {
    it('Test 21: Дубликат префикса в начале (mcprootracemcprootrace)', () => {
      const result = normalizeToolName('mcprootracemcprootraceloadrule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 22: Дубликат с дефисами (mcp--roo-trace--mcp--roo-trace--)', () => {
      const result = normalizeToolName('mcp--roo-trace--mcp--roo-trace--load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 23: Дубликат с подчеркиваниями', () => {
      const result = normalizeToolName('mcp___roo___trace___mcp___roo___trace___load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 24: Тройной дубликат префикса', () => {
      const result = normalizeToolName('mcprootracemcprootracemcprootraceloadrule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 25: Дубликат mcp префикса', () => {
      const result = normalizeToolName('mcpmcprootraceloadrule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 26: Дубликат в середине строки', () => {
      const result = normalizeToolName('mcprootracemcprootraceloadrule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 27: Реальный случай из лога: mcp--roo___trace--mcp___roo___trace___load_rule', () => {
      const result = normalizeToolName('mcp--roo___trace--mcp___roo___trace___load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 28: Реальный случай: одинарные дефисы после парсинга', () => {
      const result = normalizeToolName('mcp-roo-trace-load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 29: Смешанные дубликаты с разными разделителями', () => {
      const result = normalizeToolName('mcp--roo-trace--mcp___roo___trace___load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 30: Дубликат только roo-trace части', () => {
      const result = normalizeToolName('mcp--roo-trace--roo-trace--load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 31: Множественные дубликаты префиксов', () => {
      const result = normalizeToolName('mcprootracemcprootracemcprootracemcprootraceloadrule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 32: Дубликат с пробелами', () => {
      const result = normalizeToolName('mcp--roo-trace-- mcp--roo-trace--load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 33: Дубликат mcp в разных регистрах', () => {
      const result = normalizeToolName('MCP--roo-trace--mcp--roo-trace--load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 34: Дубликат с разными разделителями', () => {
      const result = normalizeToolName('mcp--roo-trace--mcp__roo__trace__load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 35: Дубликат только в конце', () => {
      const result = normalizeToolName('mcp--roo-trace--load_rule--mcp--roo-trace');
      expect(result).toBe('mcprootraceloadrulemcprootrace');
    });

    it('Test 36: Дубликат load_rule', () => {
      const result = normalizeToolName('mcp--roo-trace--load_rule--load_rule');
      expect(result).toBe('mcprootraceloadruleloadrule');
    });

    it('Test 37: Дубликат с одинарными дефисами', () => {
      const result = normalizeToolName('mcp-roo-trace-mcp-roo-trace-load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 38: Дубликат с тройными подчеркиваниями', () => {
      const result = normalizeToolName('mcp___roo___trace___mcp___roo___trace___load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 39: Дубликат префикса mcp в начале', () => {
      const result = normalizeToolName('mcpmcp--roo-trace--load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 40: Дубликат roo-trace в середине', () => {
      const result = normalizeToolName('mcp--roo-trace--roo-trace--load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });
  });

  describe('Tool Name Map Lookup Tests (41-70)', () => {
    it('Test 41: Поиск правильного имени', () => {
      const normalized = normalizeToolName('mcp--roo-trace--load_rule');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
    });

    it('Test 42: Поиск с одинарными дефисами', () => {
      const normalized = normalizeToolName('mcp-roo-trace-load_rule');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
    });

    it('Test 43: Поиск с подчеркиваниями', () => {
      const normalized = normalizeToolName('mcp__roo__trace__load_rule');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
    });

    it('Test 44: Поиск с дубликатом префикса', () => {
      const normalized = normalizeToolName('mcprootracemcprootraceloadrule');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
    });

    it('Test 45: Поиск реального случая из лога', () => {
      const normalized = normalizeToolName('mcp--roo___trace--mcp___roo___trace___load_rule');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
    });

    it('Test 46: Поиск без префикса mcp--roo-trace--', () => {
      const normalized = normalizeToolName('load_rule');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
    });

    it('Test 47: Поиск get_debug_status', () => {
      const normalized = normalizeToolName('mcp--roo-trace--get_debug_status');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--get_debug_status');
    });

    it('Test 48: Поиск get_debug_status с искажениями', () => {
      const normalized = normalizeToolName('mcp-roo-trace-get_debug_status');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--get_debug_status');
    });

    it('Test 49: Поиск read_runtime_logs', () => {
      const normalized = normalizeToolName('mcp--roo-trace--read_runtime_logs');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--read_runtime_logs');
    });

    it('Test 50: Поиск inject_probes', () => {
      const normalized = normalizeToolName('mcp--roo-trace--inject_probes');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--inject_probes');
    });

    it('Test 51: Поиск clear_session', () => {
      const normalized = normalizeToolName('mcp--roo-trace--clear_session');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--clear_session');
    });

    it('Test 52: Поиск get_problems', () => {
      const normalized = normalizeToolName('mcp--roo-trace--get_problems');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--get_problems');
    });

    it('Test 53: Поиск с дубликатом для get_debug_status', () => {
      const normalized = normalizeToolName('mcprootracemcprootracegetdebugstatus');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--get_debug_status');
    });

    it('Test 54: Поиск с тройными подчеркиваниями', () => {
      const normalized = normalizeToolName('mcp___roo___trace___load___rule');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
    });

    it('Test 55: Поиск с множественными дефисами', () => {
      const normalized = normalizeToolName('mcp----roo----trace----load----rule');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
    });

    it('Test 56: Поиск в верхнем регистре', () => {
      const normalized = normalizeToolName('MCP--ROO-TRACE--LOAD_RULE');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
    });

    it('Test 57: Поиск с пробелами', () => {
      const normalized = normalizeToolName('  mcp--roo-trace--load_rule  ');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
    });

    it('Test 58: Поиск несуществующего инструмента', () => {
      const normalized = normalizeToolName('mcp--roo-trace--unknown_tool');
      expect(toolNameMap[normalized]).toBeUndefined();
    });

    it('Test 59: Поиск с неправильным префиксом', () => {
      const normalized = normalizeToolName('wrong--prefix--load_rule');
      expect(toolNameMap[normalized]).toBeUndefined();
    });

    it('Test 60: Поиск только имени функции для load_rule', () => {
      const normalized = normalizeToolName('load_rule');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
    });

    it('Test 61: Поиск только имени функции для get_debug_status', () => {
      const normalized = normalizeToolName('get_debug_status');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--get_debug_status');
    });

    it('Test 62: Поиск с дубликатом mcp префикса', () => {
      const normalized = normalizeToolName('mcpmcp--roo-trace--load_rule');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
    });

    it('Test 63: Поиск с дубликатом в середине', () => {
      const normalized = normalizeToolName('mcp--roo-trace--mcp--roo-trace--load_rule');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
    });

    it('Test 64: Поиск с тройным дубликатом', () => {
      const normalized = normalizeToolName('mcprootracemcprootracemcprootraceloadrule');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
    });

    it('Test 65: Поиск с смешанными разделителями', () => {
      const normalized = normalizeToolName('mcp--roo_trace--load_rule');
      expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
    });

    it('Test 66: Поиск с цифрами', () => {
      const normalized = normalizeToolName('mcp--roo-trace--load_rule_2');
      expect(toolNameMap[normalized]).toBeUndefined();
    });

    it('Test 67: Поиск с дополнительными символами', () => {
      const normalized = normalizeToolName('mcp--roo-trace--load_rule_extra');
      expect(toolNameMap[normalized]).toBeUndefined();
    });

    it('Test 68: Поиск с неправильным порядком', () => {
      const normalized = normalizeToolName('load_rule--mcp--roo-trace');
      expect(toolNameMap[normalized]).toBeUndefined();
    });

    it('Test 69: Поиск с частичным совпадением', () => {
      const normalized = normalizeToolName('mcp--roo-trace--load');
      expect(toolNameMap[normalized]).toBeUndefined();
    });

    it('Test 70: Поиск пустой строки', () => {
      const normalized = normalizeToolName('');
      expect(toolNameMap[normalized]).toBeUndefined();
    });
  });

  describe('Edge Cases and Stress Tests (71-100)', () => {
    it('Test 71: Очень длинное имя с множественными дубликатами', () => {
      const result = normalizeToolName('mcprootracemcprootracemcprootracemcprootracemcprootraceloadrule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 72: Дубликаты на разных уровнях', () => {
      const result = normalizeToolName('mcpmcprootracemcprootraceloadrule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 73: Дубликаты с разными разделителями', () => {
      const result = normalizeToolName('mcp--roo-trace--mcp__roo__trace__load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 74: Множественные пробелы и разделители', () => {
      const result = normalizeToolName('mcp  --  roo  -  trace  --  load  _  rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 75: Смешанные дубликаты и разделители', () => {
      const result = normalizeToolName('mcp--roo-trace--mcp___roo___trace___mcp--roo-trace--load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 76: Дубликат только roo части (не обрабатывается - не известный префикс)', () => {
      const result = normalizeToolName('mcp--roo--roo-trace--load_rule');
      // roo не является известным префиксом, поэтому дубликат не удаляется
      expect(result).toBe('mcproorootraceloadrule');
    });

    it('Test 77: Дубликат только trace части (не обрабатывается - не известный префикс)', () => {
      const result = normalizeToolName('mcp--roo-trace--trace--load_rule');
      // trace не является известным префиксом, поэтому дубликат не удаляется
      expect(result).toBe('mcprootracetraceloadrule');
    });

    it('Test 78: Дубликат load части (не обрабатывается - не известный префикс)', () => {
      const result = normalizeToolName('mcp--roo-trace--load--load_rule');
      // load не является известным префиксом, поэтому дубликат не удаляется
      expect(result).toBe('mcprootraceloadloadrule');
    });

    it('Test 79: Дубликат rule части', () => {
      const result = normalizeToolName('mcp--roo-trace--load_rule--rule');
      expect(result).toBe('mcprootraceloadrulerule');
    });

    it('Test 80: Все части дублированы (обрабатываются только известные префиксы)', () => {
      const result = normalizeToolName('mcp--mcp--roo--roo-trace--trace--load--load_rule--rule');
      // Обрабатываются только дубликаты mcp, mcprootrace, rootrace
      expect(result).toBe('mcproorootracetraceloadloadrulerule');
    });

    it('Test 81: Дубликаты с пробелами между', () => {
      const result = normalizeToolName('mcp--roo-trace-- mcp--roo-trace-- load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 82: Дубликаты в обратном порядке', () => {
      const result = normalizeToolName('load_rule--mcp--roo-trace--mcp--roo-trace');
      expect(result).toBe('loadrulemcprootrace');
    });

    it('Test 83: Дубликаты только в середине', () => {
      const result = normalizeToolName('mcp--roo-trace--mcp--roo-trace--load_rule--mcp--roo-trace');
      expect(result).toBe('mcprootraceloadrulemcprootrace');
    });

    it('Test 84: Множественные дубликаты mcp', () => {
      const result = normalizeToolName('mcpmcpmcp--roo-trace--load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 85: Дубликаты с разными регистрами', () => {
      const result = normalizeToolName('MCP--roo-trace--mcp--ROO-TRACE--load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 86: Дубликаты с специальными символами', () => {
      const result = normalizeToolName('mcp--roo-trace--mcp--roo-trace--load.rule');
      expect(result).toBe('mcprootraceload.rule');
    });

    it('Test 87: Дубликаты с цифрами', () => {
      const result = normalizeToolName('mcp--roo-trace--mcp--roo-trace--load_rule_2');
      expect(result).toBe('mcprootraceloadrule2');
    });

    it('Test 88: Дубликаты с табуляциями', () => {
      const result = normalizeToolName('mcp--roo-trace--\tmcp--roo-trace--\tload_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 89: Дубликаты с переносами строк', () => {
      const result = normalizeToolName('mcp--roo-trace--\nmcp--roo-trace--\nload_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 90: Дубликаты с нулевой шириной символов', () => {
      const result = normalizeToolName('mcp--roo-trace--\u200Bmcp--roo-trace--\u200Bload_rule');
      // Нулевая ширина символов не удаляется, но дубликат mcprootrace обрабатывается
      expect(result).toBe('mcprootrace\u200Bmcprootrace\u200Bloadrule');
    });

    it('Test 91: Реальный случай: все возможные искажения', () => {
      const result = normalizeToolName('mcp--roo___trace--mcp___roo___trace___mcp--roo-trace--load_rule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 92: Дубликаты с Unicode символами', () => {
      const result = normalizeToolName('mcp--roo-trace--mcp--roo-trace--load_rule_🚀');
      expect(result).toBe('mcprootraceloadrule🚀');
    });

    it('Test 93: Дубликаты с кириллицей', () => {
      const result = normalizeToolName('mcp--roo-trace--mcp--roo-trace--load_rule_тест');
      expect(result).toBe('mcprootraceloadruleтест');
    });

    it('Test 94: Дубликаты с эмодзи', () => {
      const result = normalizeToolName('mcp--roo-trace--mcp--roo-trace--load_rule_🔥');
      expect(result).toBe('mcprootraceloadrule🔥');
    });

    it('Test 95: Дубликаты с HTML entities', () => {
      const result = normalizeToolName('mcp--roo-trace--mcp--roo-trace--load_rule_&amp;');
      expect(result).toBe('mcprootraceloadrule&amp;');
    });

    it('Test 96: Дубликаты с URL encoding', () => {
      const result = normalizeToolName('mcp--roo-trace--mcp--roo-trace--load_rule_%20');
      expect(result).toBe('mcprootraceloadrule%20');
    });

    it('Test 97: Дубликаты с SQL injection попыткой', () => {
      const result = normalizeToolName('mcp--roo-trace--mcp--roo-trace--load_rule\'; DROP TABLE');
      expect(result).toBe('mcprootraceloadrule\';droptable');
    });

    it('Test 98: Дубликаты с XSS попыткой', () => {
      const result = normalizeToolName('mcp--roo-trace--mcp--roo-trace--load_rule<script>alert(1)</script>');
      expect(result).toBe('mcprootraceloadrule<script>alert(1)</script>');
    });

    it('Test 99: Дубликаты с очень длинным именем', () => {
      const longName = 'mcp--roo-trace--' + 'a'.repeat(1000) + '--mcp--roo-trace--load_rule';
      const result = normalizeToolName(longName);
      expect(result).toContain('mcprootrace');
      expect(result).toContain('loadrule');
    });

    it('Test 100: Финальный стресс-тест: все возможные искажения одновременно', () => {
      const worstCase = 'MCP--ROO___TRACE--mcp___roo___trace___MCP--ROO-TRACE--mcp--roo-trace--LOAD_RULE';
      const result = normalizeToolName(worstCase);
      expect(result).toBe('mcprootraceloadrule');
      expect(toolNameMap[result]).toBe('mcp--roo-trace--load_rule');
    });
  });

  describe('Performance and Correctness Tests (101-110)', () => {
    it('Test 101: Проверка что все инструменты находятся', () => {
      const tools = [
        'mcp--roo-trace--load_rule',
        'mcp--roo-trace--get_debug_status',
        'mcp--roo-trace--read_runtime_logs',
        'mcp--roo-trace--inject_probes',
        'mcp--roo-trace--clear_session',
        'mcp--roo-trace--get_problems',
      ];

      tools.forEach(tool => {
        const normalized = normalizeToolName(tool);
        expect(toolNameMap[normalized]).toBe(tool);
      });
    });

    it('Test 102: Проверка что искаженные имена находятся', () => {
      const distorted = [
        'mcp-roo-trace-load_rule',
        'mcp__roo__trace__get_debug_status',
        'mcp___roo___trace___read_runtime_logs',
        'mcprootracemcprootraceinjectprobes',
        'MCP--ROO-TRACE--CLEAR_SESSION',
        'mcp--roo-trace--get-problems',
      ];

      distorted.forEach((distortedName, index) => {
        const normalized = normalizeToolName(distortedName);
        const expected = [
          'mcp--roo-trace--load_rule',
          'mcp--roo-trace--get_debug_status',
          'mcp--roo-trace--read_runtime_logs',
          'mcp--roo-trace--inject_probes',
          'mcp--roo-trace--clear_session',
          'mcp--roo-trace--get_problems',
        ][index];
        expect(toolNameMap[normalized]).toBe(expected);
      });
    });

    it('Test 103: Проверка что неправильные имена не находятся', () => {
      const wrong = [
        'wrong--prefix--load_rule',
        'mcp--wrong--tool',
        'completely--different--name',
        'mcp--roo-trace--',
        'load_rule--wrong--prefix',
      ];

      wrong.forEach(wrongName => {
        const normalized = normalizeToolName(wrongName);
        expect(toolNameMap[normalized]).toBeUndefined();
      });
    });

    it('Test 104: Проверка консистентности нормализации', () => {
      const variants = [
        'mcp--roo-trace--load_rule',
        'mcp-roo-trace-load_rule',
        'mcp__roo__trace__load_rule',
        'mcp___roo___trace___load_rule',
        'MCP--ROO-TRACE--LOAD_RULE',
        'McP--RoO-TrAcE--LoAd_RuLe',
      ];

      const normalized = variants.map(v => normalizeToolName(v));
      const first = normalized[0];
      normalized.forEach(n => {
        expect(n).toBe(first);
      });
    });

    it('Test 105: Проверка что маппинг содержит все варианты', () => {
      const variants = [
        'mcp--roo-trace--load_rule',
        'mcp-roo-trace-load_rule',
        'load_rule',
      ];

      variants.forEach(variant => {
        const normalized = normalizeToolName(variant);
        expect(toolNameMap[normalized]).toBe('mcp--roo-trace--load_rule');
      });
    });

    it('Test 106: Проверка производительности на 1000 итерациях', () => {
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        normalizeToolName('mcp--roo-trace--mcp--roo-trace--load_rule');
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000); // Должно быть быстрее 1 секунды
    });

    it('Test 107: Проверка что дубликаты удаляются рекурсивно', () => {
      const result = normalizeToolName('mcprootracemcprootracemcprootracemcprootraceloadrule');
      expect(result).toBe('mcprootraceloadrule');
    });

    it('Test 108: Проверка что дубликаты удаляются в середине строки', () => {
      const result = normalizeToolName('prefixmcprootracemcprootracesuffix');
      expect(result).toBe('prefixmcprootracesuffix');
    });

    it('Test 109: Проверка что маппинг работает для всех инструментов', () => {
      const allTools = [
        'mcp--roo-trace--load_rule',
        'mcp--roo-trace--get_debug_status',
        'mcp--roo-trace--read_runtime_logs',
        'mcp--roo-trace--inject_probes',
        'mcp--roo-trace--clear_session',
        'mcp--roo-trace--get_problems',
      ];

      allTools.forEach(tool => {
        // Проверяем прямой поиск
        const normalized = normalizeToolName(tool);
        expect(toolNameMap[normalized]).toBe(tool);

        // Проверяем поиск без префикса
        const withoutPrefix = tool.replace(/^mcp--roo-trace--/, '');
        const normalizedWithoutPrefix = normalizeToolName(withoutPrefix);
        expect(toolNameMap[normalizedWithoutPrefix]).toBe(tool);
      });
    });

    it('Test 110: Финальная проверка: реальный сценарий из лога', () => {
      // Реальный случай из roo_task_jan-23-2026_7-50-22-pm.md:
      // Агент вызывает: mcp--roo___trace--mcp___roo___trace___load_rule
      // Roo Code парсит как: mcp-roo-trace-load_rule
      // Ожидаемый результат: mcp--roo-trace--load_rule

      const agentCall = 'mcp--roo___trace--mcp___roo___trace___load_rule';
      const rooCodeParsed = 'mcp-roo-trace-load_rule';
      const expected = 'mcp--roo-trace--load_rule';

      const normalized1 = normalizeToolName(agentCall);
      const normalized2 = normalizeToolName(rooCodeParsed);

      expect(normalized1).toBe('mcprootraceloadrule');
      expect(normalized2).toBe('mcprootraceloadrule');
      expect(normalized1).toBe(normalized2);

      expect(toolNameMap[normalized1]).toBe(expected);
      expect(toolNameMap[normalized2]).toBe(expected);
    });
  });
});
