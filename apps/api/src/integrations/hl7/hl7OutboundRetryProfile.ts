export type Hl7OutboundUrgency = 'routine' | 'urgent' | 'stat';

export interface Hl7OutboundRetryProfile {
  attempts: number;
  backoff: {
    type: 'exponential';
    delay: number;
  };
  /**
   * 1-based failed-attempt number that should trigger an early admin alert
   * before retry budget exhaustion. `null` disables early alerting.
   */
  alertAtAttempt: number | null;
}

const ROUTINE_OR_URGENT_PROFILE: Hl7OutboundRetryProfile = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  alertAtAttempt: null,
};

const STAT_PROFILE: Hl7OutboundRetryProfile = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  alertAtAttempt: 2,
};

/**
 * BUG-263 — preserve routine/urgent retry posture while making STAT dispatch
 * fail-visible earlier with a tighter retry budget.
 */
export function getHl7OutboundRetryProfile(
  urgency: Hl7OutboundUrgency,
): Hl7OutboundRetryProfile {
  return urgency === 'stat'
    ? { ...STAT_PROFILE, backoff: { ...STAT_PROFILE.backoff } }
    : {
        ...ROUTINE_OR_URGENT_PROFILE,
        backoff: { ...ROUTINE_OR_URGENT_PROFILE.backoff },
      };
}

