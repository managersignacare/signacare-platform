/**
 * BUG-592-FOLLOWUP-THRESHOLD-FLOOR (legacy name) + BUG-592-FOLLOWUP-PHENYTOIN
 * integration proof.
 *
 * Service-level threshold guards must prevent clinics from setting
 * therapeutic monitoring windows so high that surveillance is effectively
 * disabled (e.g. lithium every 365 days). This suite verifies upper-bound
 * enforcement on all therapeutic-level keys plus the new phenytoin key.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import app from '../../src/server';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-592 followups — therapeutic threshold guardrails', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const touchedKeys = [
    'therapeutic_level_lithium_days',
    'therapeutic_level_valproate_days',
    'therapeutic_level_carbamazepine_days',
    'therapeutic_level_warfarin_days',
    'therapeutic_level_phenytoin_days',
  ] as const;
  const originalRows: Partial<Record<(typeof touchedKeys)[number], number>> = {};

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

  async function putThreshold(key: string, value: number) {
    return request(app)
      .put('/api/v1/settings/thresholds')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-CSRF-Token', 'test')
      .send({ key, value });
  }

  it('TP-TL-THR-592-1: rejects lithium threshold above 180 days', async () => {
    const res = await putThreshold('therapeutic_level_lithium_days', 365);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('THRESHOLD_ABOVE_CEILING');
  });

  it('TP-TL-THR-592-2: rejects warfarin threshold above 28 days', async () => {
    const res = await putThreshold('therapeutic_level_warfarin_days', 60);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('THRESHOLD_ABOVE_CEILING');
  });

  it('TP-TL-THR-592-3: rejects phenytoin threshold above 180 days', async () => {
    const res = await putThreshold('therapeutic_level_phenytoin_days', 365);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('THRESHOLD_ABOVE_CEILING');
  });

  it('TP-TL-THR-592-4: rejects zero-day phenytoin threshold', async () => {
    const res = await putThreshold('therapeutic_level_phenytoin_days', 0);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('THRESHOLD_BELOW_FLOOR');
  });

  it('TP-TL-THR-592-5: accepts boundary values (lithium=180, warfarin=28, phenytoin=180)', async () => {
    const res = await request(app)
      .put('/api/v1/settings/thresholds/bulk')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-CSRF-Token', 'test')
      .send({
        thresholds: {
          therapeutic_level_lithium_days: 180,
          therapeutic_level_warfarin_days: 28,
          therapeutic_level_phenytoin_days: 180,
        },
      });
    expect(res.status).toBe(200);
    const rows = await dbAdmin('clinic_thresholds')
      .where({ clinic_id: session.clinicId })
      .whereIn('threshold_key', [
        'therapeutic_level_lithium_days',
        'therapeutic_level_warfarin_days',
        'therapeutic_level_phenytoin_days',
      ])
      .select('threshold_key', 'threshold_value');
    const map = new Map(rows.map((r: { threshold_key: string; threshold_value: string }) => [
      r.threshold_key,
      Number(r.threshold_value),
    ]));
    expect(map.get('therapeutic_level_lithium_days')).toBe(180);
    expect(map.get('therapeutic_level_warfarin_days')).toBe(28);
    expect(map.get('therapeutic_level_phenytoin_days')).toBe(180);
  });
});
