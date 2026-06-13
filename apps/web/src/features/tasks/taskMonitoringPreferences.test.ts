import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TASK_MONITORING_COLLAPSE_STATE,
  normalizeTaskMonitoringCollapseState,
  parseTaskMonitoringCollapseState,
  serializeTaskMonitoringCollapseState,
  TASK_MONITORING_COLLAPSE_KEY,
} from './taskMonitoringPreferences';

describe('taskMonitoringPreferences', () => {
  it('pins the local-storage key and defaults my scope to collapsed', () => {
    expect(TASK_MONITORING_COLLAPSE_KEY).toBe('tasks-monitoring-collapsed');
    expect(DEFAULT_TASK_MONITORING_COLLAPSE_STATE).toEqual({
      my: true,
      team: false,
    });
  });

  it('normalizes partial or invalid values back to the safe defaults', () => {
    expect(normalizeTaskMonitoringCollapseState({ my: false })).toEqual({
      my: false,
      team: false,
    });
    expect(normalizeTaskMonitoringCollapseState({ team: true })).toEqual({
      my: true,
      team: true,
    });
    expect(normalizeTaskMonitoringCollapseState({})).toEqual(DEFAULT_TASK_MONITORING_COLLAPSE_STATE);
    expect(normalizeTaskMonitoringCollapseState(null)).toEqual(DEFAULT_TASK_MONITORING_COLLAPSE_STATE);
    expect(normalizeTaskMonitoringCollapseState({ my: 'yes' })).toEqual(DEFAULT_TASK_MONITORING_COLLAPSE_STATE);
  });

  it('parses persisted JSON safely and falls back when the payload is corrupt', () => {
    expect(parseTaskMonitoringCollapseState(null)).toEqual(DEFAULT_TASK_MONITORING_COLLAPSE_STATE);
    expect(parseTaskMonitoringCollapseState('{"my":false,"team":true}')).toEqual({
      my: false,
      team: true,
    });
    expect(parseTaskMonitoringCollapseState('not json')).toEqual(DEFAULT_TASK_MONITORING_COLLAPSE_STATE);
  });

  it('serializes normalized state for durable round-tripping', () => {
    expect(serializeTaskMonitoringCollapseState({ my: false, team: true })).toBe('{"my":false,"team":true}');
    expect(serializeTaskMonitoringCollapseState({ my: false, team: true, extra: true } as never)).toBe('{"my":false,"team":true}');
  });
});
