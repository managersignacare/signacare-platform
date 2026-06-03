import { AppError } from '../../shared/errors';

type PathwayStatus = 'active' | 'paused' | 'completed' | 'discontinued';

const ALLOWED_TRANSITIONS: Record<PathwayStatus, ReadonlySet<PathwayStatus>> = {
  active: new Set(['paused', 'completed', 'discontinued']),
  paused: new Set(['active', 'completed', 'discontinued']),
  completed: new Set(),
  discontinued: new Set(),
};

function normalizeStatus(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function asKnownStatus(value: string): PathwayStatus | null {
  if (value === 'active' || value === 'paused' || value === 'completed' || value === 'discontinued') {
    return value;
  }
  return null;
}

export function assertPathwayStatusTransition(
  fromStatus: string | null | undefined,
  toStatus: string | null | undefined,
): void {
  const from = asKnownStatus(normalizeStatus(fromStatus));
  const to = asKnownStatus(normalizeStatus(toStatus));

  if (!from || !to) return;
  if (from === to) return;

  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.has(to)) {
    throw new AppError(
      `Treatment pathway cannot transition from '${fromStatus}' to '${toStatus}'`,
      422,
      'INVALID_STATE_TRANSITION',
      {
        fromStatus: from,
        toStatus: to,
      },
    );
  }
}

