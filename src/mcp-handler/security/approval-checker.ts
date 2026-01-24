/**
 * Утилиты для проверки разрешений пользователя на выполнение операций
 * 
 * Этот модуль обеспечивает безопасность, требуя явного одобрения пользователя
 * для критических операций, таких как чтение runtime логов.
 */

import * as fs from 'fs';

/**
 * Константы для файлов одобрения
 */
export const READ_LOGS_APPROVAL_FILE = 'allow-read-runtime-logs.json';
export const READ_LOGS_APPROVAL_MAX_AGE_MS = 2 * 60 * 1000; // 2 minutes
export const AUTO_DEBUG_APPROVAL_FILE = 'allow-auto-debug.json';
export const AUTO_DEBUG_APPROVAL_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes (user-granted)

/**
 * Результат проверки разрешения на чтение логов
 */
export interface ReadLogsApprovalResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Проверяет разрешение на чтение runtime логов
 * 
 * Разрешение на чтение логов должно приходить ТОЛЬКО от пользователя (кнопкой в UI).
 * MCP-сервер не должен позволять агенту дергать read_runtime_logs самостоятельно.
 * 
 * Поддерживает два типа одобрения:
 * 1. AUTO_DEBUG_APPROVAL_FILE - долгоживущее одобрение (5 минут) для hands-free debugging
 * 2. READ_LOGS_APPROVAL_FILE - строгое одобрение (2 минуты) для каждого запроса
 * 
 * @param getRootraceFilePath - Функция для получения пути к файлу в директории .rootrace
 * @returns Результат проверки разрешения
 */
export function checkReadRuntimeLogsApproval(
  getRootraceFilePath: (filename: string) => string
): ReadLogsApprovalResult {
  try {
    // Long-lived (but expiring) user grant: allow the agent to read logs without pressing the button each time.
    // This is still a USER action (granted via popup button), just less strict for hands-free debugging.
    const autoPath = getRootraceFilePath(AUTO_DEBUG_APPROVAL_FILE);
    if (fs.existsSync(autoPath)) {
      try {
        const rawAuto = fs.readFileSync(autoPath, 'utf8');
        const dataAuto = JSON.parse(rawAuto) as { approvedAt?: string; approvedAtMs?: number };
        const approvedAtMsAuto =
          typeof dataAuto.approvedAtMs === 'number'
            ? dataAuto.approvedAtMs
            : (dataAuto.approvedAt ? Date.parse(dataAuto.approvedAt) : NaN);
        if (Number.isFinite(approvedAtMsAuto)) {
          const ageAuto = Date.now() - approvedAtMsAuto;
          if (ageAuto >= 0 && ageAuto <= AUTO_DEBUG_APPROVAL_MAX_AGE_MS) {
            return { allowed: true };
          }
        }
      } catch {
        // ignore malformed auto grant; fall back to strict gate
      }
    }

    const approvalPath = getRootraceFilePath(READ_LOGS_APPROVAL_FILE);
    if (!fs.existsSync(approvalPath)) {
      return { allowed: false, reason: 'No user approval file present' };
    }
    const raw = fs.readFileSync(approvalPath, 'utf8');
    const data = JSON.parse(raw) as { approvedAt?: string; approvedAtMs?: number };
    const approvedAtMs =
      typeof data.approvedAtMs === 'number'
        ? data.approvedAtMs
        : (data.approvedAt ? Date.parse(data.approvedAt) : NaN);
    if (!Number.isFinite(approvedAtMs)) {
      return { allowed: false, reason: 'Approval file malformed' };
    }
    const age = Date.now() - approvedAtMs;
    if (age < 0 || age > READ_LOGS_APPROVAL_MAX_AGE_MS) {
      return { allowed: false, reason: `Approval expired (ageMs=${age})` };
    }
    return { allowed: true };
  } catch (e) {
    return { allowed: false, reason: `Approval check error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
