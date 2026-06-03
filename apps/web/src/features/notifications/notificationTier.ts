import type { NotificationResponse } from '@signacare/shared';

export interface NotificationTierBadge {
  tier: number;
  label: string;
  color: 'error' | 'warning';
}

function parseTierValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value >= 1 ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
  }
  return null;
}

export function getNotificationTierBadge(
  payload: NotificationResponse['payload'],
): NotificationTierBadge | null {
  if (!payload) return null;
  const tier = parseTierValue(payload.tier);
  if (!tier || tier <= 1) return null;
  if (tier === 2) {
    return { tier, label: 'Escalation', color: 'error' };
  }
  return { tier, label: `Escalation T${tier}`, color: 'warning' };
}
