import { describe, expect, it } from 'vitest';
import {
  isAcceptedReferralStatus,
  isActiveIntakeReferralStatus,
  isRejectedReferralStatus,
} from './referralsUiHelpers';

describe('referralsUiHelpers intake status partition', () => {
  it('keeps newly created and in-flight intake referrals in active bucket', () => {
    expect(isActiveIntakeReferralStatus('received')).toBe(true);
    expect(isActiveIntakeReferralStatus('under_review')).toBe(true);
    expect(isActiveIntakeReferralStatus('pending_broadcast')).toBe(true);
    expect(isActiveIntakeReferralStatus('pending_clinician_review')).toBe(true);
  });

  it('moves accepted terminal states out of active bucket', () => {
    expect(isAcceptedReferralStatus('accepted')).toBe(true);
    expect(isAcceptedReferralStatus('appointment_booked')).toBe(true);
    expect(isActiveIntakeReferralStatus('accepted')).toBe(false);
    expect(isActiveIntakeReferralStatus('appointment_booked')).toBe(false);
  });

  it('moves declined terminal states out of active bucket', () => {
    expect(isRejectedReferralStatus('rejected')).toBe(true);
    expect(isRejectedReferralStatus('redirected')).toBe(true);
    expect(isRejectedReferralStatus('expired')).toBe(true);
    expect(isActiveIntakeReferralStatus('rejected')).toBe(false);
    expect(isActiveIntakeReferralStatus('redirected')).toBe(false);
    expect(isActiveIntakeReferralStatus('expired')).toBe(false);
  });
});
