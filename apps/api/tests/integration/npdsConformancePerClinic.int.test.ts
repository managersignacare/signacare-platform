/**
 * BUG-302 regression — NPDS conformance ID per-clinic.
 *
 * Pre-fix: NPDS_CONFORMANCE_ID was a single env var at
 * npdsClient.ts:87, so every clinic on a multi-tenant Signacare
 * instance submitted eScripts under the same identity. ADHA
 * conformance requires per-clinic attribution.
 *
 * Post-fix:
 *   (1) Migration 20260701000034 adds clinics.npds_conformance_id
 *       + clinics.erx_etp1_site_id columns (both NULLABLE).
 *   (2) npdsClient.resolveNpdsConformanceId(clinicId) reads from
 *       clinics table first; falls back to env var with WARN log;
 *       throws 503 ERX_NOT_CONFIGURED if both missing.
 *   (3) submitToNpds / queryActiveScriptList / cancelOnNpds all
 *       require clinicId parameter.
 *   (4) escriptService passes auth.clinicId through.
 *   (5) Boot assertion Check 7.6 WARN-mode via STRICT_NPDS_CONFORMANCE.
 *
 * Coverage (7 tests):
 *   T1 — column exists + NULLABLE.
 *   T2 — resolveNpdsConformanceId returns per-clinic value.
 *   T3 — resolveNpdsConformanceId falls back to env var with WARN.
 *   T4 — resolveNpdsConformanceId throws ERX_NOT_CONFIGURED when both
 *         per-clinic AND env absent.
 *   T5 — per-clinic value takes precedence over env var.
 *   T6 — submitToNpds requires clinicId parameter (stub mode when
 *         NPDS_API_URL absent returns NOT_CONFIGURED without resolve).
 *   T7 — empty-string per-clinic value falls through to env fallback.
 *   T8 — BUG-340: missing conformance on source clinic resolves via
 *         live sibling clinic with same HPI-O.
 *   T9 — BUG-340: ambiguous sibling conformance IDs falls back to env.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import {
  resolveNpdsConformanceId,
  submitToNpds,
} from '../../src/integrations/escript/npdsClient';

const READY = await isIntegrationReady();

function testHpio(seed: number): string {
  return `800362${String(seed).padStart(10, '0')}`;
}

describe.skipIf(!READY)('BUG-302 NPDS conformance per-clinic (live DB)', () => {
  let baselineClinicId: string;
  const seededClinicIds: string[] = [];
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    const session = await loginAsAdmin();
    baselineClinicId = session.clinicId;
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    if (seededClinicIds.length > 0) {
      await dbAdmin('clinics').whereIn('id', seededClinicIds).del().catch(() => undefined);
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('T1 — npds_conformance_id column exists + is NULLABLE', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const row = await dbAdmin.raw<{ rows: Array<{ is_nullable: string }> }>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name='clinics' AND column_name='npds_conformance_id'`,
    );
    expect(row.rows?.[0]?.is_nullable).toBe('YES');
  });

  it('T2 — resolveNpdsConformanceId returns per-clinic value', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const id = randomUUID();
    seededClinicIds.push(id);
    await dbAdmin('clinics').insert({
      id,
      name: 'BUG-302 T2',
      hpio: testHpio(1),
      npds_conformance_id: 'BUG302-T2-ABCDEF',
    } as never);
    delete process.env.NPDS_CONFORMANCE_ID;
    const result = await resolveNpdsConformanceId(id);
    expect(result).toBe('BUG302-T2-ABCDEF');
  });

  it('T3 — resolveNpdsConformanceId falls back to env var for NULL clinic', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const id = randomUUID();
    seededClinicIds.push(id);
    await dbAdmin('clinics').insert({
      id,
      name: 'BUG-302 T3 (null conformance)',
      hpio: testHpio(2),
      // npds_conformance_id: null
    } as never);
    process.env.NPDS_CONFORMANCE_ID = 'T3_ENV_FALLBACK';
    const result = await resolveNpdsConformanceId(id);
    expect(result).toBe('T3_ENV_FALLBACK');
  });

  it('T4 — resolveNpdsConformanceId throws ERX_NOT_CONFIGURED when both absent', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const id = randomUUID();
    seededClinicIds.push(id);
    await dbAdmin('clinics').insert({
      id,
      name: 'BUG-302 T4 (no fallback)',
      hpio: testHpio(3),
    } as never);
    delete process.env.NPDS_CONFORMANCE_ID;
    try {
      await resolveNpdsConformanceId(id);
      throw new Error('expected throw');
    } catch (err) {
      const e = err as { code?: string; status?: number };
      expect(e.code).toBe('ERX_NOT_CONFIGURED');
      expect(e.status).toBe(503);
    }
  });

  it('T5 — per-clinic value takes precedence over env var', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const id = randomUUID();
    seededClinicIds.push(id);
    await dbAdmin('clinics').insert({
      id,
      name: 'BUG-302 T5',
      hpio: testHpio(4),
      npds_conformance_id: 'PER_CLINIC_WINS',
    } as never);
    process.env.NPDS_CONFORMANCE_ID = 'ENV_LOSES';
    const result = await resolveNpdsConformanceId(id);
    expect(result).toBe('PER_CLINIC_WINS');
  });

  it('T6 — submitToNpds returns NOT_CONFIGURED when NPDS_API_URL absent', async () => {
    delete process.env.NPDS_API_URL;
    delete process.env.ADHA_CERT_PATH;
    const result = await submitToNpds({}, baselineClinicId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/NPDS not configured/);
  });

  it('T7 — empty-string per-clinic value falls through to env fallback', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const id = randomUUID();
    seededClinicIds.push(id);
    await dbAdmin('clinics').insert({
      id,
      name: 'BUG-302 T7 (empty str)',
      hpio: testHpio(5),
      npds_conformance_id: '   ', // whitespace-only
    } as never);
    process.env.NPDS_CONFORMANCE_ID = 'T7_ENV_FALLBACK';
    const result = await resolveNpdsConformanceId(id);
    expect(result).toBe('T7_ENV_FALLBACK');
  });

  it('T8 — BUG-340 resolves via live sibling clinic with shared HPI-O', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const sharedHpio = testHpio(601);
    const sourceClinicId = randomUUID();
    const siblingClinicId = randomUUID();
    seededClinicIds.push(sourceClinicId, siblingClinicId);
    await dbAdmin('clinics').insert([
      {
        id: sourceClinicId,
        name: 'BUG-340 T8 source',
        hpio: sharedHpio,
        npds_conformance_id: null,
      },
      {
        id: siblingClinicId,
        name: 'BUG-340 T8 sibling',
        hpio: sharedHpio,
        npds_conformance_id: 'BUG340-T8-SIBLING',
      },
    ] as never);
    delete process.env.NPDS_CONFORMANCE_ID;
    const result = await resolveNpdsConformanceId(sourceClinicId);
    expect(result).toBe('BUG340-T8-SIBLING');
  });

  it('T9 — BUG-340 ambiguous sibling conformance IDs falls back to env', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const sharedHpio = testHpio(602);
    const sourceClinicId = randomUUID();
    const siblingAId = randomUUID();
    const siblingBId = randomUUID();
    seededClinicIds.push(sourceClinicId, siblingAId, siblingBId);
    await dbAdmin('clinics').insert([
      {
        id: sourceClinicId,
        name: 'BUG-340 T9 source',
        hpio: sharedHpio,
        npds_conformance_id: null,
      },
      {
        id: siblingAId,
        name: 'BUG-340 T9 sibling A',
        hpio: sharedHpio,
        npds_conformance_id: 'BUG340-T9-A',
      },
      {
        id: siblingBId,
        name: 'BUG-340 T9 sibling B',
        hpio: sharedHpio,
        npds_conformance_id: 'BUG340-T9-B',
      },
    ] as never);
    process.env.NPDS_CONFORMANCE_ID = 'BUG340-T9-ENV';
    const result = await resolveNpdsConformanceId(sourceClinicId);
    expect(result).toBe('BUG340-T9-ENV');
  });
});
