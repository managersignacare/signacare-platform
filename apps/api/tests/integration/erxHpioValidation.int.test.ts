/**
 * BUG-295 regression — clinics.hpio column + erxRestPayloads hard-error
 * + WARN-mode boot assertion.
 *
 * Pre-fix:
 *   (1) clinics table had no hpio column.
 *   (2) apps/api/src/integrations/escript/erxRestPayloads.ts line 258
 *       serialised `<PrescriberHPIO>${c.hpio || ''}</PrescriberHPIO>`,
 *       emitting an EMPTY STRING for every eRx submission — instant
 *       eRx accreditation failure.
 *   (3) escriptService.ts didn't even propagate payload.prescriberHpio
 *       onto the clinician object it passed to erxRestPayloads.
 *
 * Post-fix (this commit):
 *   (1) Migration 20260701000033 adds clinics.hpio varchar(16) NULL
 *       with CHECK clinics_hpio_format_check (hpio IS NULL OR
 *       hpio ~ '^800362[0-9]{10}$').
 *   (2) erxRestPayloads.buildFullPrescriptionXml hard-throws 503
 *       ERX_NOT_CONFIGURED on missing or malformed HPI-O.
 *   (3) escriptService.ts propagates payload.prescriberHpio →
 *       clinician.hpio.
 *   (4) assertProductionIntegrationsConfigured Check 7.5 logs WARN
 *       for clinics with NULL hpio (STRICT_ERX_HPIO=true flips to
 *       fail-boot).
 *
 * Coverage (10 tests):
 *   T1 — buildErx001Xml with valid HPI-O succeeds.
 *   T2 — buildErx001Xml with missing HPI-O throws ERX_NOT_CONFIGURED.
 *   T3 — buildErx001Xml with empty-string HPI-O throws
 *         ERX_NOT_CONFIGURED.
 *   T4 — buildErx001Xml with HPI-O wrong prefix (800360 IHI) throws.
 *   T5 — buildErx001Xml with HPI-O wrong length (15 digits) throws.
 *   T6 — buildErx001Xml with HPI-O non-numeric chars throws.
 *   T6b — buildErx001Xml with HPI-O bad Luhn checksum throws.
 *   T7 — CHECK constraint: INSERT clinic with valid HPI-O succeeds.
 *   T8 — CHECK constraint: INSERT clinic with malformed HPI-O raises.
 *   T9 — NOT NULL contract: INSERT clinic with NULL HPI-O is rejected
 *         (BUG-334 Phase C enforcement).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import {
  buildErx001Xml,
  type ErxPrescriptionPayload,
} from '../../src/integrations/escript/erxRestPayloads';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-295 clinics.hpio + eRx payload HPI-O hard-error', () => {
  let clinicId: string;
  const seededClinicIds: string[] = [];

  beforeAll(async () => {
    const session = await loginAsAdmin();
    clinicId = session.clinicId;
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    if (seededClinicIds.length > 0) {
      await dbAdmin('clinics').whereIn('id', seededClinicIds).del().catch(() => undefined);
    }
  });

  function basePayload(hpio?: string): ErxPrescriptionPayload {
    return {
      scid: '2' + '0'.repeat(14),
      guid: randomUUID(),
      conformanceId: 'Signacare|1.0.0',
      patient: {
        familyName: 'Test',
        givenName: 'Patient',
        dob: '1985-01-01',
        gender: 'F',
      },
      clinician: {
        prescriberNumber: '1234567A',
        providerNumber: '1234567A',
        givenName: 'Doctor',
        familyName: 'McTestface',
        practiceName: 'Signacare EMR',
        hpio,
      },
      item: {
        prescriptionDate: '2026-04-22',
        tradeName: 'Panadol',
        genericName: 'Paracetamol',
        genericIntention: 'G',
        quantity: 20,
        repeats: 0,
        directions: 'Take one as needed',
      },
    } as ErxPrescriptionPayload;
  }

  it('T1 — buildErx001Xml with valid HPI-O succeeds', () => {
    const xml = buildErx001Xml(basePayload('8003620000000005'));
    expect(xml).toContain('<PrescriberHPIO>8003620000000005</PrescriberHPIO>');
  });

  it('T2 — buildErx001Xml with missing HPI-O throws ERX_NOT_CONFIGURED', () => {
    try {
      buildErx001Xml(basePayload(undefined));
      throw new Error('expected throw');
    } catch (err) {
      const e = err as { code?: string; status?: number };
      expect(e.code).toBe('ERX_NOT_CONFIGURED');
      expect(e.status).toBe(503);
    }
  });

  it('T3 — buildErx001Xml with empty-string HPI-O throws ERX_NOT_CONFIGURED', () => {
    try {
      buildErx001Xml(basePayload(''));
      throw new Error('expected throw');
    } catch (err) {
      const e = err as { code?: string };
      expect(e.code).toBe('ERX_NOT_CONFIGURED');
    }
  });

  it('T4 — buildErx001Xml with HPI-O wrong prefix (800360 IHI) throws', () => {
    try {
      buildErx001Xml(basePayload('8003600000000000'));
      throw new Error('expected throw');
    } catch (err) {
      const e = err as { code?: string };
      expect(e.code).toBe('ERX_NOT_CONFIGURED');
    }
  });

  it('T5 — buildErx001Xml with HPI-O wrong length throws', () => {
    try {
      buildErx001Xml(basePayload('800362000000000'));
      throw new Error('expected throw');
    } catch (err) {
      const e = err as { code?: string };
      expect(e.code).toBe('ERX_NOT_CONFIGURED');
    }
  });

  it('T6 — buildErx001Xml with HPI-O non-numeric characters throws', () => {
    try {
      buildErx001Xml(basePayload('800362ABCD000000'));
      throw new Error('expected throw');
    } catch (err) {
      const e = err as { code?: string };
      expect(e.code).toBe('ERX_NOT_CONFIGURED');
    }
  });

  it('T6b — buildErx001Xml with HPI-O bad Luhn checksum throws', () => {
    try {
      // Same prefix/length shape as valid HPI-O, checksum intentionally bad.
      buildErx001Xml(basePayload('8003620000000069'));
      throw new Error('expected throw');
    } catch (err) {
      const e = err as { code?: string };
      expect(e.code).toBe('ERX_NOT_CONFIGURED');
    }
  });

  it('T7 — CHECK constraint: INSERT clinic with valid HPI-O succeeds', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const id = randomUUID();
    seededClinicIds.push(id);
    await expect(
      dbAdmin('clinics').insert({
        id,
        name: 'BUG-295 T7',
        hpio: '8003620000000005',
      } as never),
    ).resolves.toBeDefined();
  });

  it('T8 — CHECK constraint: INSERT clinic with malformed HPI-O raises', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await expect(
      dbAdmin('clinics').insert({
        id: randomUUID(),
        name: 'BUG-295 T8',
        hpio: '8003600000000000', // 800360 IHI prefix, not 800362 HPI-O
      } as never),
    ).rejects.toThrow(/clinics_hpio_format_check/);
  });

  it('T9 — NOT NULL contract: INSERT clinic with NULL HPI-O is rejected', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await expect(
      dbAdmin('clinics').insert({
        id: randomUUID(),
        name: 'BUG-295 T9',
        // hpio intentionally omitted
      } as never),
    ).rejects.toThrow(/null value in column "hpio"/i);
    // Verify clinicId param is referenced so it isn't pruned.
    expect(clinicId).toBeTruthy();
  });
});
