import { describe, expect, it } from 'vitest';
import { resolveOpenTaskTileCount } from './dashboardPageSupport';

describe('resolveOpenTaskTileCount', () => {
  it('uses task-list row count when task query succeeds', () => {
    const count = resolveOpenTaskTileCount({
      openTaskRowsCount: 3,
      clinicianOpenTasksCount: 0,
      tasksQueryFailed: false,
    });
    expect(count).toBe(3);
  });

  it('falls back to clinician dashboard count when task query fails', () => {
    const count = resolveOpenTaskTileCount({
      openTaskRowsCount: 0,
      clinicianOpenTasksCount: 2,
      tasksQueryFailed: true,
    });
    expect(count).toBe(2);
  });

  it('returns zero when both task query fails and dashboard count is absent', () => {
    const count = resolveOpenTaskTileCount({
      openTaskRowsCount: 0,
      clinicianOpenTasksCount: undefined,
      tasksQueryFailed: true,
    });
    expect(count).toBe(0);
  });
});
