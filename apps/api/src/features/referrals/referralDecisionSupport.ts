import type { ReferralDecisionDTO } from '@signacare/shared';

export function canonicalizeDecision(
  decision: ReferralDecisionDTO['decision'],
): 'accepted' | 'rejected' | 'redirected' | 'info_requested' {
  return decision === 'declined' ? 'rejected' : decision;
}

export function buildDecisionReason(dto: ReferralDecisionDTO): string | null {
  const category = dto.decisionReasonCategory?.trim();
  const detail = (dto.declineReason ?? dto.rejectionReason ?? dto.notes ?? '').trim();
  if (category && detail) return `[${category}] ${detail}`;
  if (category) return `[${category}]`;
  if (detail) return detail;
  return null;
}

