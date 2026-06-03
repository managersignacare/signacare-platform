import { describe, expect, it } from 'vitest';
import {
  CreateReferralSchema,
  ReferralDecisionSchema,
  ReferralListFiltersSchema,
  ReferralQueueFiltersSchema,
} from './referralSchemas';

describe('ReferralDecisionSchema', () => {
  it('requires confirmDecision for accepted/declined decisions', () => {
    const accepted = ReferralDecisionSchema.safeParse({
      decision: 'accepted',
      isExternalTarget: true,
    });
    expect(accepted.success).toBe(false);

    const declined = ReferralDecisionSchema.safeParse({
      decision: 'declined',
      declineReason: 'No capacity',
    });
    expect(declined.success).toBe(false);
  });

  it('accepts declined alias with confirmation and reason', () => {
    const parsed = ReferralDecisionSchema.safeParse({
      decision: 'declined',
      confirmDecision: true,
      declineReason: 'No psychiatrist capacity this week.',
      decisionReasonCategory: 'capacity',
    });
    expect(parsed.success).toBe(true);
  });

  it('requires redirect target for redirected decisions', () => {
    const parsed = ReferralDecisionSchema.safeParse({
      decision: 'redirected',
      confirmDecision: true,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('referral direction filters', () => {
  it('accepts intake/outbound on list filters', () => {
    expect(ReferralListFiltersSchema.safeParse({ direction: 'intake' }).success).toBe(true);
    expect(ReferralListFiltersSchema.safeParse({ direction: 'outbound' }).success).toBe(true);
  });

  it('accepts intake/outbound on queue filters', () => {
    expect(ReferralQueueFiltersSchema.safeParse({ direction: 'intake' }).success).toBe(true);
    expect(ReferralQueueFiltersSchema.safeParse({ direction: 'outbound' }).success).toBe(true);
  });
});

describe('CreateReferralSchema', () => {
  it('accepts optional receivedDate in YYYY-MM-DD format', () => {
    const parsed = CreateReferralSchema.safeParse({
      patientId: '11111111-1111-1111-1111-111111111111',
      referralDate: '2026-05-16',
      receivedDate: '2026-05-15',
      fromService: 'GP',
      reason: 'Manual intake',
      urgency: 'routine',
      direction: 'intake',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects malformed receivedDate', () => {
    const parsed = CreateReferralSchema.safeParse({
      patientId: '11111111-1111-1111-1111-111111111111',
      referralDate: '2026-05-16',
      receivedDate: '15-05-2026',
      fromService: 'GP',
      reason: 'Manual intake',
      urgency: 'routine',
      direction: 'intake',
    });
    expect(parsed.success).toBe(false);
  });
});
