import { describe, expect, it } from 'vitest';
import {
  getVisibleDashboardCards,
  setDashboardCardHidden,
  setDashboardViewEnabled,
} from './dashboardPreferenceUtils';

describe('dashboardPreferenceUtils', () => {
  it('does not hide safety-critical cards from user preferences', () => {
    const next = setDashboardCardHidden(null, 'my_dashboard', 'my-next-unsafe-thing', true);
    const visible = getVisibleDashboardCards(next, 'my_dashboard').map((card) => card.id);
    expect(visible).toContain('my-next-unsafe-thing');
  });

  it('allows optional cards to be hidden and restored', () => {
    const hidden = setDashboardCardHidden(null, 'my_dashboard', 'my-task-list', true);
    expect(getVisibleDashboardCards(hidden, 'my_dashboard').map((card) => card.id))
      .not.toContain('my-task-list');

    const restored = setDashboardCardHidden(hidden, 'my_dashboard', 'my-task-list', false);
    expect(getVisibleDashboardCards(restored, 'my_dashboard').map((card) => card.id))
      .toContain('my-task-list');
  });

  it('keeps at least one dashboard option enabled', () => {
    const next = setDashboardViewEnabled({ version: 1, density: 'comfortable', enabledViews: ['manager'], viewPreferences: {} }, 'manager', false);
    expect(next.enabledViews.length).toBe(1);
  });
});
