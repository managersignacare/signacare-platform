import { OPEN_TASK_STATUSES as SHARED_OPEN_TASK_STATUSES } from '@signacare/shared';

/**
 * API-local alias for the shared canonical "open/actionable" task statuses.
 * Keep imports stable for existing feature modules while enforcing SSoT.
 */
export const OPEN_TASK_STATUSES = SHARED_OPEN_TASK_STATUSES;
