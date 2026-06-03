import { AppError } from '../../shared/errors';

const LEGACY_TO_CANONICAL_STATUS: Record<string, string> = {
  draft: 'received',
  sent: 'pending_broadcast',
  pending: 'received',
  acknowledged: 'under_review',
  in_review: 'under_review',
  closed: 'closed_no_response',
  completed: 'appointment_booked',
};

const ALLOWED_FORWARD_TRANSITIONS: Record<string, Set<string>> = {
  received: new Set([
    'under_review',
    'discussed',
    'info_requested',
    'awaiting_clinician_confirmation',
    'pending_clinician_review',
    'pending_broadcast',
    'accepted',
    'rejected',
    'redirected',
    'expired',
  ]),
  under_review: new Set([
    'discussed',
    'info_requested',
    'awaiting_clinician_confirmation',
    'pending_clinician_review',
    'pending_broadcast',
    'accepted',
    'rejected',
    'redirected',
    'expired',
  ]),
  discussed: new Set([
    'info_requested',
    'awaiting_clinician_confirmation',
    'pending_clinician_review',
    'pending_broadcast',
    'accepted',
    'rejected',
    'redirected',
    'expired',
  ]),
  info_requested: new Set([
    'under_review',
    'awaiting_clinician_confirmation',
    'pending_clinician_review',
    'pending_broadcast',
    'accepted',
    'rejected',
    'redirected',
    'expired',
  ]),
  awaiting_clinician_confirmation: new Set([
    'under_review',
    'info_requested',
    'pending_clinician_review',
    'pending_broadcast',
    'accepted',
    'rejected',
    'redirected',
    'expired',
  ]),
  pending_clinician_review: new Set([
    'pending_broadcast',
    'accepted',
    'rejected',
    'redirected',
    'info_requested',
    'expired',
  ]),
  pending_broadcast: new Set([
    'accepted',
    'rejected',
    'redirected',
    'info_requested',
    'closed_no_response',
    'expired',
  ]),
  accepted: new Set(['appointment_booked']),
  rejected: new Set(),
  redirected: new Set(),
  closed_no_response: new Set(),
  expired: new Set(),
  appointment_booked: new Set(),
};

function normalizeReferralStatus(status: string | null | undefined): string {
  const normalized = (status ?? '').trim().toLowerCase();
  return LEGACY_TO_CANONICAL_STATUS[normalized] ?? normalized;
}

export function assertReferralStatusTransition(
  fromStatus: string | null | undefined,
  toStatus: string | null | undefined,
): void {
  const from = normalizeReferralStatus(fromStatus);
  const to = normalizeReferralStatus(toStatus);

  if (!from || !to) return;
  if (from === to) return;

  const allowedNext = ALLOWED_FORWARD_TRANSITIONS[from];
  if (!allowedNext) {
    throw new AppError(
      `Referral status '${fromStatus ?? 'unknown'}' is not recognized by the state machine`,
      422,
      'INVALID_STATE_TRANSITION',
    );
  }

  if (!allowedNext.has(to)) {
    throw new AppError(
      `Referral cannot transition from '${fromStatus}' to '${toStatus}'`,
      422,
      'INVALID_STATE_TRANSITION',
    );
  }
}

