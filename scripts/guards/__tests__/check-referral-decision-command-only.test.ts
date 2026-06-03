import { describe, expect, it } from 'vitest';
import { scanSource } from '../check-referral-decision-command-only';

describe('check-referral-decision-command-only', () => {
  it('passes when referral PATCH only moves non-decision statuses', () => {
    const src = `
      const update = () => apiClient.patch(\`referrals/\${id}\`, { status: 'under_review' });
    `;
    expect(scanSource(src)).toBe(false);
  });

  it('fails when referral PATCH sets terminal decision status', () => {
    const src = `
      const update = () => apiClient.patch(\`referrals/\${id}\`, { status: 'accepted' });
    `;
    expect(scanSource(src)).toBe(true);
  });

  it('passes when decision endpoint is used for accept/decline', () => {
    const src = `
      const accept = () => apiClient.post(\`referrals/\${id}/decision\`, { decision: 'accepted', confirmDecision: true });
      const decline = () => apiClient.post(\`referrals/\${id}/decision\`, { decision: 'declined', confirmDecision: true, declineReason: 'x' });
    `;
    expect(scanSource(src)).toBe(false);
  });
});

