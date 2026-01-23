/**
 * Генератор кода проб для Python
 */

import { BaseGenerator } from './base-generator';

export class PythonGenerator extends BaseGenerator {
  readonly supportedLanguages = ['python', 'py'];

  generate(
    language: string,
    probeType: 'log' | 'trace' | 'error',
    message: string,
    serverUrl: string,
    hypothesisId?: string
  ): string | null {
    const hId = this.generateHypothesisId(message, hypothesisId);
    const escapedMessage = this.escapeMessage(message);
    const escapedUrl = this.escapeUrl(serverUrl);

    // Для Python используем urllib (встроенная библиотека) - однострочный вариант
    // КРИТИЧЕСКИ ВАЖНО: timeout=5.0 для тяжелых операций (IFC, многопоточность, CPU-intensive)
    // ДОБАВЛЕНО: улучшенное логирование с URL и traceback для ошибок
    // ДОБАВЛЕНО: параллельное логирование в файл И в консоль (stderr) для видимости
    // ДОБАВЛЕНО: поддержка Docker - определение хоста происходит во время выполнения через _rootrace_host
    // Используем переменную _rootrace_host, которая должна быть инициализирована в начале файла
    // Переменная _rootrace_host определяется ВО ВРЕМЯ ВЫПОЛНЕНИЯ внутри Docker контейнера
    // Если переменная не инициализирована (старые пробы), используем URL напрямую как fallback
    return `try: import urllib.request, json, os, traceback, sys; log_file = os.path.expanduser('~/.roo_probe_debug.log'); base_url = '${escapedUrl}'; server_url = base_url.replace('localhost', _rootrace_host) if '_rootrace_host' in globals() and 'localhost' in base_url else base_url; log_msg = f"Probe EXECUTING: ${hId} - ${escapedMessage}, URL: {server_url}\\n"; open(log_file, 'a').write(log_msg); sys.stderr.write(f"[RooTrace Probe] {log_msg}"); req = urllib.request.Request(server_url, data=json.dumps({'hypothesisId': '${hId}', 'message': '${escapedMessage}', 'state': {}}).encode('utf-8'), headers={'Content-Type': 'application/json'}); resp = urllib.request.urlopen(req, timeout=5.0); success_msg = f"Probe SUCCESS: ${hId} - status={resp.getcode()}, URL={server_url}\\n"; open(log_file, 'a').write(success_msg); sys.stderr.write(f"[RooTrace Probe] {success_msg}"); except Exception as e: log_file = os.path.expanduser('~/.roo_probe_debug.log'); error_msg = f"Probe ERROR: ${hId} - {type(e).__name__}: {str(e)}, URL: {server_url if 'server_url' in locals() else base_url}\\n{traceback.format_exc()}\\n"; open(log_file, 'a').write(error_msg); sys.stderr.write(f"[RooTrace Probe ERROR] {error_msg}"); pass`;
  }
}
