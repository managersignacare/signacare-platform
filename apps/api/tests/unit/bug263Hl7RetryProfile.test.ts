import { describe, expect, it } from 'vitest';
import { getHl7OutboundRetryProfile } from '../../src/integrations/hl7/hl7OutboundRetryProfile';

describe('BUG-263 — HL7 outbound urgency retry profile', () => {
  it('keeps routine/urgent on 5 attempts with 30s exponential backoff and no early alert', () => {
    const routine = getHl7OutboundRetryProfile('routine');
    const urgent = getHl7OutboundRetryProfile('urgent');

    expect(routine).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      alertAtAttempt: null,
    });
    expect(urgent).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      alertAtAttempt: null,
    });
  });

  it('uses tighter STAT profile (3 attempts, 10s exponential) with early alert at attempt 2', () => {
    const stat = getHl7OutboundRetryProfile('stat');
    expect(stat).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      alertAtAttempt: 2,
    });
  });
});

