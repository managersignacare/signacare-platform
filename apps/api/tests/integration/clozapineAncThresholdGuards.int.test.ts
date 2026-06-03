/**
 * BUG-403 cycle-2 (L4 BLOCK absorb 2026-05-03) — clinical-safety guards
 * on clozapine ANC threshold configuration.
 *
 * The pre-cycle-2 implementation accepted ANY numeric value for the
 * clozapine_anc_*_threshold keys, which would allow a clinic admin to
 * configure red=0.5 and silently re-classify ANC 0.8 (severe
 * neutropenia / agranulocytosis territory) as 'normal'. Direct AHPRA
 * Standard 1 + TGA-PI non-compliance.
 *
 * Cycle-2 introduces 3 service-level guards (Layer A):
 *   1. Key whitelist — unknown keys reject with UNKNOWN_THRESHOLD_KEY
 *   2. Floor / ceiling per key — clozapine_anc_red_threshold ∈ [1.5, 5.0]
 *      and clozapine_anc_amber_threshold ∈ [2.0, 5.0]
 *   3. Relational ordering — red < amber strictly
 *
 * Plus controller-level (Layer 0) Zod refinement (.finite()) and bulk
 * pre-validation of the FINAL paired-state.
 *
 * Layer B (DB CHECK constraint) tracked under
 * BUG-403-FOLLOWUP-DB-CHECK-CONSTRAINT.
 *
 * fix-registry anchors pinned by this file:
 *   - R-FIX-BUG-403-CYCLE2-FLOOR-ENFORCED
 *   - R-FIX-BUG-403-CYCLE2-CEILING-ENFORCED
 *   - R-FIX-BUG-403-CYCLE2-RELATIONAL-ENFORCED
 *   - R-FIX-BUG-403-CYCLE2-UNKNOWN-KEY-REJECTED
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import app from '../../src/server';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-403 cycle-2 — clozapine ANC threshold guards', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Capture pre-test rows so we can restore the seeded clinic to its
  // original state in afterAll (sibling-applicable property #3).
  const originalRows: Record<string, number> = {};
  const touchedKeys = [
    'clozapine_anc_red_threshold',
    'clozapine_anc_amber_threshold',
  ];

  beforeAll(async () => {
    if (!ready) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));

    for (const key of touchedKeys) {
      const row = await dbAdmin('clinic_thresholds')
        .where({ clinic_id: session.clinicId, threshold_key: key })
        .first('threshold_value');
      if (row) originalRows[key] = Number(row.threshold_value);
    }
  });

  afterAll(async () => {
    if (!ready || !session) return;
    // Restore originals; delete any rows we created.
    for (const key of touchedKeys) {
      if (key in originalRows) {
        await dbAdmin('clinic_thresholds')
          .where({ clinic_id: session.clinicId, threshold_key: key })
          .update({ threshold_value: originalRows[key], updated_at: new Date() });
      } else {
        await dbAdmin('clinic_thresholds')
          .where({ clinic_id: session.clinicId, threshold_key: key })
          .del();
      }
    }
  });

  describe('TP-CLZ-THR-403-1: floor enforcement', () => {
    it('rejects clozapine_anc_red_threshold below CPMS floor (1.5)', async () => {
      const res = await request(app)
        .put('/api/v1/settings/thresholds')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({ key: 'clozapine_anc_red_threshold', value: 0.5 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('THRESHOLD_BELOW_FLOOR');
    });

    it('rejects clozapine_anc_amber_threshold below CPMS floor (2.0)', async () => {
      const res = await request(app)
        .put('/api/v1/settings/thresholds')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({ key: 'clozapine_anc_amber_threshold', value: 1.0 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('THRESHOLD_BELOW_FLOOR');
    });
  });

  describe('TP-CLZ-THR-403-2: ceiling enforcement (typo defence)', () => {
    it('rejects clozapine_anc_red_threshold above 5.0 (typo defence: 15.0 instead of 1.5)', async () => {
      const res = await request(app)
        .put('/api/v1/settings/thresholds')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({ key: 'clozapine_anc_red_threshold', value: 15.0 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('THRESHOLD_ABOVE_CEILING');
    });
  });

  describe('TP-CLZ-THR-403-3: relational ordering enforcement', () => {
    it('rejects clozapine_anc_red_threshold >= clozapine_anc_amber_threshold via single set', async () => {
      // First, ensure amber is at canonical default 2.0 (re-set it).
      await request(app)
        .put('/api/v1/settings/thresholds')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({ key: 'clozapine_anc_amber_threshold', value: 2.0 });
      // Now try to set red >= amber.
      const res = await request(app)
        .put('/api/v1/settings/thresholds')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({ key: 'clozapine_anc_red_threshold', value: 2.5 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('THRESHOLD_ORDERING_VIOLATED');
    });

    it('rejects bulk paired update where final red >= final amber', async () => {
      const res = await request(app)
        .put('/api/v1/settings/thresholds/bulk')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({
          thresholds: {
            clozapine_anc_red_threshold: 2.5,
            clozapine_anc_amber_threshold: 2.5,
          },
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('THRESHOLD_ORDERING_VIOLATED');
    });

    it('accepts bulk paired update where final red < final amber (both stricter)', async () => {
      const res = await request(app)
        .put('/api/v1/settings/thresholds/bulk')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({
          thresholds: {
            clozapine_anc_red_threshold: 1.7,
            clozapine_anc_amber_threshold: 2.5,
          },
        });
      expect(res.status).toBe(200);
      // Verify both rows persisted.
      const red = await dbAdmin('clinic_thresholds')
        .where({ clinic_id: session.clinicId, threshold_key: 'clozapine_anc_red_threshold' })
        .first('threshold_value');
      const amber = await dbAdmin('clinic_thresholds')
        .where({ clinic_id: session.clinicId, threshold_key: 'clozapine_anc_amber_threshold' })
        .first('threshold_value');
      expect(Number(red.threshold_value)).toBe(1.7);
      expect(Number(amber.threshold_value)).toBe(2.5);
    });
  });

  describe('TP-CLZ-THR-403-4: unknown key rejection (typo defence)', () => {
    it('rejects unknown threshold key', async () => {
      const res = await request(app)
        .put('/api/v1/settings/thresholds')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({ key: 'clozapine_anc_red', value: 1.5 }); // typo: missing _threshold suffix
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('UNKNOWN_THRESHOLD_KEY');
    });
  });
});
