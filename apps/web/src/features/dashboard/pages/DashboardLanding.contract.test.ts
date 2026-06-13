import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('dashboard landing source contract', () => {
  const dashboardPage = readFileSync(resolve(__dirname, './DashboardPage.tsx'), 'utf8');
  const preferencesPanel = readFileSync(resolve(__dirname, '../components/DashboardPreferencesPanel.tsx'), 'utf8');

  it('hydrates the /dashboard landing view from saved dashboard preferences', () => {
    expect(dashboardPage).toContain('useDashboardPreferences');
    expect(dashboardPage).toContain('readDashboardPreferences');
    expect(dashboardPage).toContain('dashboardPreferences.defaultView');
    expect(dashboardPage).toContain('enabledRoles');
  });

  it('keeps dashboard switching available via toggle chips on the page', () => {
    expect(dashboardPage).toContain('userChangedViewRef.current = true');
    expect(dashboardPage).toContain('variant={isActive ? \'filled\' : \'outlined\'}');
  });

  it('describes dashboard options as replacing the default landing dashboard', () => {
    expect(preferencesPanel).toContain('replaces the default <code>/dashboard</code> landing view');
    expect(preferencesPanel).toContain('Open selected default dashboard');
    expect(preferencesPanel).toContain("navigate('/dashboard')");
    expect(preferencesPanel).toContain('defaultView: checked');
    expect(preferencesPanel).toContain('Use as default');
  });
});
