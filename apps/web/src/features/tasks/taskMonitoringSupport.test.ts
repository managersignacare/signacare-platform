import { describe, expect, it } from 'vitest';
import {
  buildMonitoringCards,
  humanizeTaskStatus,
  workbenchBucketToQuery,
} from './taskMonitoringSupport';

describe('taskMonitoringSupport', () => {
  it('maps workbench buckets into task query filters', () => {
    expect(workbenchBucketToQuery('overdue')).toEqual({ dueBucket: 'overdue' });
    expect(workbenchBucketToQuery('today')).toEqual({ dueBucket: 'today' });
    expect(workbenchBucketToQuery('next_7_days')).toEqual({ dueBucket: 'next_7_days' });
    expect(workbenchBucketToQuery('undated')).toEqual({ dueBucket: 'undated' });
    expect(workbenchBucketToQuery('waiting_external')).toEqual({ status: 'waiting_external' });
    expect(workbenchBucketToQuery('blocked')).toEqual({ status: 'blocked' });
    expect(workbenchBucketToQuery('review_pending')).toEqual({ status: 'review_pending' });
  });

  it('humanizes task statuses for chips and headings', () => {
    expect(humanizeTaskStatus('waiting_external')).toBe('Waiting External');
    expect(humanizeTaskStatus('review_pending')).toBe('Review Pending');
    expect(humanizeTaskStatus('in_progress')).toBe('In Progress');
  });

  it('builds high-signal monitoring cards from summary totals', () => {
    const cards = buildMonitoringCards({
      totals: {
        open: 8,
        overdue: 3,
        dueToday: 2,
        dueNext7Days: 4,
        undated: 1,
        blocked: 2,
        waitingExternal: 1,
        reviewPending: 1,
        unassigned: 2,
        urgent: 1,
        completed: 5,
      },
      dueBuckets: [],
      statusBreakdown: [],
      priorityBreakdown: [],
      assigneeBreakdown: [],
    });

    expect(cards).toEqual([
      { id: 'open', label: 'Open', value: 8 },
      { id: 'overdue', label: 'Overdue', value: 3 },
      { id: 'today', label: 'Due today', value: 2 },
      { id: 'waiting', label: 'Waiting external', value: 1 },
      { id: 'blocked', label: 'Blocked', value: 2 },
      { id: 'unassigned', label: 'Unassigned', value: 2 },
    ]);
  });
});
