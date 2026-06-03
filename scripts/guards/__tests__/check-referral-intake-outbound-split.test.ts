import { describe, expect, it } from 'vitest';
import { scanSources } from '../check-referral-intake-outbound-split';

describe('check-referral-intake-outbound-split', () => {
  it('passes when intake/outbound split invariants are present', () => {
    const violations = scanSources({
      intakePageSource: `
        const q = useReferrals({ direction: 'intake' });
        await create({ direction: 'intake', receivedDate, reason: 'x' });
        <TextField label="Received Date" />
      `,
      referralOutPageSource: `
        const filters = { direction: 'outbound' as const };
        apiClient.post('referrals', { direction: 'outbound', source: OUTBOUND_REFERRAL_SOURCE });
      `,
      sidebarSource: `{ label: 'Referral Out', path: 'referrals/queue' }`,
    });
    expect(violations).toHaveLength(0);
  });

  it('fails when intake direction filter is missing', () => {
    const violations = scanSources({
      intakePageSource: `const q = useReferrals({ page: 1 });`,
      referralOutPageSource: `const filters = { direction: 'outbound' as const }; source: OUTBOUND_REFERRAL_SOURCE`,
      sidebarSource: `{ label: 'Referral Out', path: 'referrals/queue' }`,
    });
    expect(violations.some((v) => v.reason.includes("direction: 'intake'"))).toBe(true);
  });

  it('fails when referral-out source stamp is missing', () => {
    const violations = scanSources({
      intakePageSource: `
        const q = useReferrals({ direction: 'intake' });
        await create({ direction: 'intake', receivedDate, reason: 'x' });
        <TextField label="Received Date" />
      `,
      referralOutPageSource: `const filters = { direction: 'outbound' as const };`,
      sidebarSource: `{ label: 'Referral Out', path: 'referrals/queue' }`,
    });
    expect(violations.some((v) => v.reason.includes('OUTBOUND_REFERRAL_SOURCE'))).toBe(true);
  });

  it('fails when intake create does not pass receivedDate', () => {
    const violations = scanSources({
      intakePageSource: `
        const q = useReferrals({ direction: 'intake' });
        await create({ direction: 'intake', reason: 'x' });
        <TextField label="Received Date" />
      `,
      referralOutPageSource: `
        const filters = { direction: 'outbound' as const };
        apiClient.post('referrals', { direction: 'outbound', source: OUTBOUND_REFERRAL_SOURCE });
      `,
      sidebarSource: `{ label: 'Referral Out', path: 'referrals/queue' }`,
    });
    expect(violations.some((v) => v.reason.includes('receivedDate'))).toBe(true);
  });

  it('fails when intake dialog does not expose Received Date field', () => {
    const violations = scanSources({
      intakePageSource: `
        const q = useReferrals({ direction: 'intake' });
        await create({ direction: 'intake', receivedDate, reason: 'x' });
      `,
      referralOutPageSource: `
        const filters = { direction: 'outbound' as const };
        apiClient.post('referrals', { direction: 'outbound', source: OUTBOUND_REFERRAL_SOURCE });
      `,
      sidebarSource: `{ label: 'Referral Out', path: 'referrals/queue' }`,
    });
    expect(violations.some((v) => v.reason.includes('Received Date'))).toBe(true);
  });
});
