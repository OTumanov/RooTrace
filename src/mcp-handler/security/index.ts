/**
 * Экспорт утилит безопасности
 */

export {
  checkReadRuntimeLogsApproval,
  READ_LOGS_APPROVAL_FILE,
  READ_LOGS_APPROVAL_MAX_AGE_MS,
  AUTO_DEBUG_APPROVAL_FILE,
  AUTO_DEBUG_APPROVAL_MAX_AGE_MS,
  type ReadLogsApprovalResult
} from './approval-checker';

export {
  checkGitCommitBeforeEdit,
  type GitCommitCheckResult
} from './git-commit-checker';
