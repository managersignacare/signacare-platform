export const SETTINGS_TAB_IDS = [
  'my-profile',
  'security',
  'appearance',
  'signature',
  'sidebar',
  'async-ai-jobs',
] as const;

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

export const SETTINGS_ASYNC_AI_JOBS_PATH = '/settings?tab=async-ai-jobs';
export const SETTINGS_DASHBOARD_OPTIONS_PATH = '/settings?tab=sidebar';

const SETTINGS_TAB_ID_SET = new Set<string>(SETTINGS_TAB_IDS);

export function isSettingsTabId(value: string | null | undefined): value is SettingsTabId {
  return !!value && SETTINGS_TAB_ID_SET.has(value);
}

export function readSettingsTabId(
  value: string | null | undefined,
  fallback: SettingsTabId,
): SettingsTabId {
  return isSettingsTabId(value) ? value : fallback;
}

export function buildSettingsAsyncAiJobsPath(patientId?: string | null): string {
  if (!patientId) {
    return SETTINGS_ASYNC_AI_JOBS_PATH;
  }

  const searchParams = new URLSearchParams({
    tab: 'async-ai-jobs',
    patientId,
  });

  return `/settings?${searchParams.toString()}`;
}
