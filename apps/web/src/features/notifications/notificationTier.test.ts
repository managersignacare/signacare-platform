import { describe, expect, it } from 'vitest';
import { getNotificationTierBadge } from './notificationTier';

describe('getNotificationTierBadge', () => {
  it('returns null when payload is null', () => {
    expect(getNotificationTierBadge(null)).toBeNull();
  });

  it('returns null for tier 1 (non-escalation)', () => {
    expect(getNotificationTierBadge({ tier: 1 })).toBeNull();
  });

  it('returns tier-2 escalation badge from numeric payload', () => {
    expect(getNotificationTierBadge({ tier: 2 })).toEqual({
      tier: 2,
      label: 'Escalation',
      color: 'error',
    });
  });

  it('parses string tier and renders higher-tier badge', () => {
    expect(getNotificationTierBadge({ tier: '3' })).toEqual({
      tier: 3,
      label: 'Escalation T3',
      color: 'warning',
    });
  });

  it('rejects invalid tier values', () => {
    expect(getNotificationTierBadge({ tier: 0 })).toBeNull();
    expect(getNotificationTierBadge({ tier: -2 })).toBeNull();
    expect(getNotificationTierBadge({ tier: 2.5 })).toBeNull();
    expect(getNotificationTierBadge({ tier: 'abc' })).toBeNull();
  });
});
