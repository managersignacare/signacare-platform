import { describe, expect, it } from 'vitest';
import { buildNavGroups } from './Sidebar';

describe('buildNavGroups', () => {
  it('keeps Dashboard Options inside Settings only, not as a separate sidebar item for clinic users', () => {
    const groups = buildNavGroups('clinician');
    const settingsGroup = groups.find((group) => group.group === 'Settings');
    const rootGroup = groups.find((group) => group.group === '');
    const settingsPaths = settingsGroup?.items.map((item) => item.path) ?? [];
    const rootPaths = rootGroup?.items.map((item) => item.path) ?? [];

    expect(rootPaths).toContain('dashboard');
    expect(rootPaths).not.toContain('settings?tab=dashboard-options');
    expect(settingsPaths).toContain('settings');
    expect(settingsPaths).not.toContain('settings?tab=dashboard-options');
  });

  it('does not expose Dashboard Options as a separate sidebar item for superadmin settings-only navigation', () => {
    const groups = buildNavGroups('superadmin');
    const paths = groups.flatMap((group) => group.items.map((item) => item.path));

    expect(paths).toContain('settings');
    expect(paths).not.toContain('settings?tab=dashboard-options');
  });

  it('keeps AI Assistant and Medical Scribe together in the root group for clinical users', () => {
    const groups = buildNavGroups('clinician');
    const rootGroup = groups.find((group) => group.group === '');
    const rootPaths = rootGroup?.items.map((item) => item.path) ?? [];

    expect(rootPaths).toContain('ai-agent');
    expect(rootPaths).toContain('agentic-scribe');

    const allPaths = groups.flatMap((g) => g.items.map((i) => i.path));
    expect(allPaths).toContain('agentic-scribe');
  });

  it('uses My Calendar as the only workspace calendar entry', () => {
    const groups = buildNavGroups('clinician');
    const workspaceGroup = groups.find((group) => group.group === 'Workspace');
    const workspacePaths = workspaceGroup?.items.map((item) => item.path) ?? [];

    expect(workspacePaths).toContain('calendar');
    expect(workspacePaths).not.toContain('appointments');
  });
});
