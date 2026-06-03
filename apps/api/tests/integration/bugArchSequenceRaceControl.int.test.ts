import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { dbAdmin } from '../../src/db/db';
import {
  generateEpisodeNumber,
  generateInvoiceNumber,
  generatePatientNumber,
  generateReferralNumber,
} from '../../src/shared/utils/numberGenerator';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-ARCH-SEQUENCE-RACE-CONTROL', () => {
  let clinicId = '';

  beforeAll(async () => {
    const session = await loginAsAdmin();
    clinicId = session.clinicId;
  });

  afterAll(async () => {
    if (!READY) return;
    await dbAdmin('clinic_sequences')
      .where({ clinic_id: clinicId })
      .andWhere((qb) => {
        qb.whereLike('scope_key', 'patient_number')
          .orWhereLike('scope_key', 'episode_number')
          .orWhereLike('scope_key', 'referral_number:%')
          .orWhereLike('scope_key', 'invoice_number:%');
      })
      .del();
  });

  it('issues unique referral and invoice numbers under parallel contention', async () => {
    const [referrals, invoices] = await Promise.all([
      Promise.all(Array.from({ length: 20 }, () => generateReferralNumber(clinicId, dbAdmin as never))),
      Promise.all(Array.from({ length: 20 }, () => generateInvoiceNumber(clinicId, dbAdmin as never))),
    ]);

    expect(new Set(referrals).size).toBe(referrals.length);
    expect(new Set(invoices).size).toBe(invoices.length);
    expect(referrals.every((n) => /^REF-\d{4}-\d{6}$/.test(n))).toBe(true);
    expect(invoices.every((n) => /^INV-\d{8}-\d{6}$/.test(n))).toBe(true);
  });

  it('issues unique patient and episode numbers under parallel contention', async () => {
    const [patients, episodes] = await Promise.all([
      Promise.all(Array.from({ length: 20 }, () => generatePatientNumber(clinicId, dbAdmin as never))),
      Promise.all(Array.from({ length: 20 }, () => generateEpisodeNumber(clinicId, dbAdmin as never))),
    ]);

    expect(new Set(patients).size).toBe(patients.length);
    expect(new Set(episodes).size).toBe(episodes.length);
    expect(patients.every((n) => /^P\d{6}$/.test(n))).toBe(true);
    expect(episodes.every((n) => /^E\d{6}$/.test(n))).toBe(true);
  });
});
