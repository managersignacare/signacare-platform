import type {
  TaskMonitoringSummary,
  TaskPriority,
  TaskStatus,
} from '@signacare/shared';

export type TaskWorkbenchBucket =
  | 'overdue'
  | 'today'
  | 'next_7_days'
  | 'undated'
  | 'waiting_external'
  | 'blocked'
  | 'review_pending';

export function humanizeTaskStatus(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function statusTone(status: TaskStatus | string): 'error' | 'warning' | 'info' | 'default' | 'success' {
  switch (status) {
    case 'blocked':
      return 'error';
    case 'waiting_external':
      return 'warning';
    case 'review_pending':
      return 'info';
    case 'completed':
      return 'success';
    default:
      return 'default';
  }
}

export function priorityTone(priority: TaskPriority): 'error' | 'warning' | 'info' | 'default' {
  switch (priority) {
    case 'urgent':
      return 'error';
    case 'high':
      return 'warning';
    case 'medium':
      return 'info';
    default:
      return 'default';
  }
}

export function workbenchBucketToQuery(bucket: TaskWorkbenchBucket): {
  status?: TaskStatus;
  dueBucket?: 'overdue' | 'today' | 'next_7_days' | 'undated';
} {
  switch (bucket) {
    case 'overdue':
      return { dueBucket: 'overdue' };
    case 'today':
      return { dueBucket: 'today' };
    case 'next_7_days':
      return { dueBucket: 'next_7_days' };
    case 'undated':
      return { dueBucket: 'undated' };
    case 'waiting_external':
      return { status: 'waiting_external' };
    case 'blocked':
      return { status: 'blocked' };
    case 'review_pending':
      return { status: 'review_pending' };
    default:
      return {};
  }
}

export function buildMonitoringCards(summary: TaskMonitoringSummary): Array<{
  id: string;
  label: string;
  value: number;
}> {
  return [
    { id: 'open', label: 'Open', value: summary.totals.open },
    { id: 'overdue', label: 'Overdue', value: summary.totals.overdue },
    { id: 'today', label: 'Due today', value: summary.totals.dueToday },
    { id: 'waiting', label: 'Waiting external', value: summary.totals.waitingExternal },
    { id: 'blocked', label: 'Blocked', value: summary.totals.blocked },
    { id: 'unassigned', label: 'Unassigned', value: summary.totals.unassigned },
  ];
}
