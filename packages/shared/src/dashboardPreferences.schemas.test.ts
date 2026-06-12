import { describe, expect, it } from 'vitest';
import {
  getDashboardCardsForView,
  isSafetyCriticalDashboardCard,
  normalizeDashboardPreferences,
} from './dashboardPreferences.schemas';

describe('dashboard preferences', () => {
  it('defaults to all additive dashboard options enabled', () => {
    const prefs = normalizeDashboardPreferences(null);
    expect(prefs.enabledViews).toContain('my_dashboard');
    expect(prefs.enabledViews).toContain('team_dashboard');
    expect(prefs.enabledViews).toContain('manager');
  });

  it('prevents safety-critical dashboard cards from being hidden', () => {
    const safetyCard = getDashboardCardsForView('my_dashboard')
      .find((card) => card.safetyCritical);
    expect(safetyCard).toBeTruthy();
    expect(isSafetyCriticalDashboardCard(safetyCard!.id)).toBe(true);

    const prefs = normalizeDashboardPreferences({
      version: 1,
      density: 'comfortable',
      enabledViews: ['my_dashboard'],
      viewPreferences: {
        my_dashboard: {
          layoutMode: 'clinical_cockpit',
          hiddenCardIds: [safetyCard!.id],
          cardOrder: [safetyCard!.id],
        },
      },
    });

    expect(prefs.viewPreferences.my_dashboard.hiddenCardIds)
      .not.toContain(safetyCard!.id);
  });

  it('keeps at least one dashboard option enabled', () => {
    const prefs = normalizeDashboardPreferences({
      version: 1,
      enabledViews: [],
      viewPreferences: {},
    });
    expect(prefs.enabledViews.length).toBeGreaterThan(0);
  });
});
