/**
 * BUG-456 L3 absorb-2 — unit test for `toResponseListSafe` list-fragility
 * helper.
 *
 * The original BUG-456 absorb-1 added an integration test (S6) that
 * tried to seed a row with `status='discontinued'` to exercise the
 * skip-bad-row code path. The DB CHECK constraint at
 * `apps/api/migrations/20260701000000_baseline.ts:2154-2155` rejects
 * any value outside the allowed enum (`active, ceased,
 * ceased_discontinued, paused, draft`), so the seed was rejected and
 * the integration test soft-skipped — the regression class went
 * unverified.
 *
 * absorb-2 reconciles the SSoT enum with the DB CHECK (UNION of both
 * sets, 8 values), so any DB-allowed value now passes the SSoT parse.
 * The list-fragility code path (per-row safeParse + skip + warn) still
 * needs a regression test — that's this file. We hand-craft a bad
 * `MedicationRow` (e.g. with `is_lai: 'not-a-boolean'` or a missing
 * `id` field) and call `toResponseListSafe` directly to verify the
 * skip+warn behaviour.
 *
 * Pre-fix RED gate: imports `toResponseListSafe` which did not exist
 * pre-absorb-1. RED-gate is module-not-found. Post-absorb-1 + 2: the
 * helper is exported and the test exercises it.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config', () => ({
  config: {
    jwt: { accessSecret: 'unit-secret', refreshSecret: 'unit-refresh', accessTtlMinutes: 60, refreshTtlDays: 7 },
    database: { host: 'localhost', port: 5432, user: 't', password: 't', name: 't', ssl: false, poolMax: 10 },
  },
}));
vi.mock('../../src/db/db', () => ({ db: vi.fn(), dbAdmin: vi.fn(), dbRead: vi.fn() }));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from '../../src/utils/logger';
import { toResponseListSafe } from '../../src/features/medications/medicationService';
import type { MedicationRow } from '../../src/features/medications/medicationRepository';

const validRow: MedicationRow = {
  id: '00000000-0000-0000-0000-000000000001',
  clinic_id: '11111111-1111-1111-1111-111111111111',
  patient_id: '22222222-2222-2222-2222-222222222222',
  episode_id: null,
  drug_product_id: null,
  drug_code: null,
  drug_label: 'Sertraline',
  generic_name: 'sertraline',
  brand_name: null,
  dose: '50',
  dose_unit: 'mg',
  route: 'oral',
  frequency: 'daily',
  instructions: null,
  indication: null,
  start_date: '2026-04-25',
  end_date: null,
  status: 'active',
  reason_for_cessation: null,
  is_regular: true,
  is_prn: false,
  is_lai: false,
  taper_schedule: null,
  source: 'manual',
  prescribed_by_staff_id: '33333333-3333-3333-3333-333333333333',
  recorded_by_staff_id: '33333333-3333-3333-3333-333333333333',
  notes: null,
  created_at: new Date('2026-04-25T00:00:00Z'),
  updated_at: new Date('2026-04-25T00:00:00Z'),
  deleted_at: null,
  prescribed_by_specialty_code: null,
  category: null,
  lock_version: 1,
} as unknown as MedicationRow;

describe('BUG-456 absorb-2 — toResponseListSafe list-fragility', () => {
  it('passes through valid rows and parses each via the SSoT', () => {
    const out = toResponseListSafe([validRow]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe(validRow.id);
    expect(out[0]?.medicationName).toBe('Sertraline'); // derived alias
    expect(out[0]?.isClozapine).toBe(false);
    expect(out[0]?.isS8).toBe(false);
  });

  it('skips a malformed row, logs structured pino warn, and ships the rest', () => {
    vi.mocked(logger.warn).mockClear();

    // A row whose `is_lai` is a string instead of a boolean. The DB
    // type is `boolean NOT NULL DEFAULT false` so this can't happen
    // naturally, but the SSoT parse will reject it — exercising the
    // safeguard against a future schema/SSoT drift class.
    const badRow = {
      ...validRow,
      id: '00000000-0000-0000-0000-000000000002',
      is_lai: 'oops-not-a-boolean' as unknown as boolean,
    } as MedicationRow;

    const out = toResponseListSafe([validRow, badRow, { ...validRow, id: '00000000-0000-0000-0000-000000000003' }]);

    // Bad row dropped; both good rows survive.
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.id)).toEqual([
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
    ]);

    // Structured warn fired with the BUG-456 kind tag.
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
    const call = vi.mocked(logger.warn).mock.calls.find((c) => {
      const payload = c[0] as Record<string, unknown> | undefined;
      return payload && payload['kind'] === 'medication_response_shape_skip';
    });
    expect(call).toBeDefined();
    const payload = call![0] as Record<string, unknown>;
    expect(payload['medicationId']).toBe('00000000-0000-0000-0000-000000000002');
    expect(payload['patientId']).toBe(validRow.patient_id);
    expect(payload['clinicId']).toBe(validRow.clinic_id);
  });

  it('returns an empty array when given an empty input (no throws on edges)', () => {
    expect(toResponseListSafe([])).toEqual([]);
  });
});
