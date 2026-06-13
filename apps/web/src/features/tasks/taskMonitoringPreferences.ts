export type TaskMonitoringScope = 'my' | 'team';

export interface TaskMonitoringCollapseState {
  my: boolean;
  team: boolean;
}

export const TASK_MONITORING_COLLAPSE_KEY = 'tasks-monitoring-collapsed';

export const DEFAULT_TASK_MONITORING_COLLAPSE_STATE: TaskMonitoringCollapseState = {
  my: true,
  team: false,
};

function isBooleanRecord(value: unknown): value is Partial<Record<TaskMonitoringScope, boolean>> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return ['my', 'team'].every((scope) => {
    const nextValue = candidate[scope];
    return nextValue === undefined || typeof nextValue === 'boolean';
  });
}

export function normalizeTaskMonitoringCollapseState(value: unknown): TaskMonitoringCollapseState {
  if (!isBooleanRecord(value)) {
    return { ...DEFAULT_TASK_MONITORING_COLLAPSE_STATE };
  }

  return {
    my: value.my ?? DEFAULT_TASK_MONITORING_COLLAPSE_STATE.my,
    team: value.team ?? DEFAULT_TASK_MONITORING_COLLAPSE_STATE.team,
  };
}

export function parseTaskMonitoringCollapseState(raw: string | null): TaskMonitoringCollapseState {
  if (!raw) {
    return { ...DEFAULT_TASK_MONITORING_COLLAPSE_STATE };
  }

  try {
    return normalizeTaskMonitoringCollapseState(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TASK_MONITORING_COLLAPSE_STATE };
  }
}

export function serializeTaskMonitoringCollapseState(state: TaskMonitoringCollapseState): string {
  return JSON.stringify(normalizeTaskMonitoringCollapseState(state));
}
