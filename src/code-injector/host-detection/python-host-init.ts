/**
 * Генератор кода инициализации хоста для Python
 */

/**
 * Генерирует код инициализации хоста для Python файлов
 * Определяет правильный хост для Docker окружения с fallback цепочкой
 * 
 * Fallback цепочка:
 * 1. ROO_TRACE_HOST env var (высший приоритет - пользователь может переопределить)
 * 2. Проверка Docker (/.dockerenv или /proc/self/cgroup)
 * 3. Пробуем резолвить host.docker.internal (работает на Mac/Windows/Linux с --add-host)
 * 4. Если не работает - определяем gateway IP через socket.connect(8.8.8.8)
 * 5. Если все не работает - localhost (fallback для локального окружения)
 * 
 * @returns Код инициализации, который устанавливает _rootrace_host
 */
export function generatePythonHostInitCode(): string {
  return `# RooTrace [init] Host detection - устанавливаем _rootrace_host для всех проб
try:
    import os, socket
    _rootrace_host = os.environ.get('ROO_TRACE_HOST')
    if not _rootrace_host:
        is_docker = False
        if os.path.exists('/.dockerenv'):
            is_docker = True
        elif os.path.exists('/proc/self/cgroup'):
            try:
                with open('/proc/self/cgroup', 'r') as f:
                    if 'docker' in f.read():
                        is_docker = True
            except:
                pass
        if is_docker:
            try:
                socket.gethostbyname('host.docker.internal')
                _rootrace_host = 'host.docker.internal'
            except:
                try:
                    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                    s.connect(('8.8.8.8', 80))
                    container_ip = s.getsockname()[0]
                    s.close()
                    _rootrace_host = '.'.join(container_ip.split('.')[:-1]) + '.1'
                except:
                    _rootrace_host = 'localhost'
        else:
            _rootrace_host = 'localhost'
except:
    _rootrace_host = 'localhost'
# RooTrace [init]: end
`;
}
