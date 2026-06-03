import { describe, expect, it } from 'vitest';
import { assertReferralStatusTransition } from '../../src/features/referrals/referralStatusStateMachine';

describe('referralStatusStateMachine', () => {
  it('allows no-op transitions', () => {
    expect(() => assertReferralStatusTransition('under_review', 'under_review')).not.toThrow();
  });

  it('allows forward transitions', () => {
    expect(() => assertReferralStatusTransition('received', 'under_review')).not.toThrow();
    expect(() => assertReferralStatusTransition('accepted', 'appointment_booked')).not.toThrow();
  });

  it('normalizes legacy labels before transition checks', () => {
    expect(() => assertReferralStatusTransition('draft', 'sent')).not.toThrow();
  });

  it('rejects terminal regressions', () => {
    expect(() => assertReferralStatusTransition('accepted', 'under_review')).toThrow(/INVALID_STATE_TRANSITION|cannot transition/i);
    expect(() => assertReferralStatusTransition('closed_no_response', 'pending_broadcast')).toThrow(/INVALID_STATE_TRANSITION|cannot transition/i);
  });

  it('rejects unknown source states', () => {
    expect(() => assertReferralStatusTransition('mystery_status', 'under_review')).toThrow(/not recognized|INVALID_STATE_TRANSITION/i);
  });
});

