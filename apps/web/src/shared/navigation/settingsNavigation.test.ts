import { describe, expect, it } from 'vitest';
import {
  buildSettingsAsyncAiJobsPath,
  isSettingsTabId,
  readSettingsTabId,
  SETTINGS_ASYNC_AI_JOBS_PATH,
  SETTINGS_DASHBOARD_OPTIONS_PATH,
} from './settingsNavigation';

describe('settingsNavigation', () => {
  it('accepts only known settings tab ids', () => {
    expect(isSettingsTabId('async-ai-jobs')).toBe(true);
    expect(isSettingsTabId('dashboard-options')).toBe(false);
    expect(isSettingsTabId('security')).toBe(true);
    expect(isSettingsTabId('dashboards')).toBe(false);
    expect(isSettingsTabId('nope')).toBe(false);
  });

  it('falls back to a safe settings tab for invalid inputs', () => {
    expect(readSettingsTabId('dashboard-options', 'security')).toBe('security');
    expect(readSettingsTabId('dashboards', 'security')).toBe('security');
    expect(readSettingsTabId(null, 'my-profile')).toBe('my-profile');
  });

  it('maps legacy dashboard options links into the sidebar settings panel', () => {
    expect(SETTINGS_DASHBOARD_OPTIONS_PATH).toBe('/settings?tab=sidebar');
  });

  it('pins and builds the canonical async ai jobs settings paths', () => {
    expect(SETTINGS_ASYNC_AI_JOBS_PATH).toBe('/settings?tab=async-ai-jobs');
    expect(buildSettingsAsyncAiJobsPath()).toBe('/settings?tab=async-ai-jobs');
    expect(buildSettingsAsyncAiJobsPath('patient-123')).toBe(
      '/settings?tab=async-ai-jobs&patientId=patient-123',
    );
  });
});
