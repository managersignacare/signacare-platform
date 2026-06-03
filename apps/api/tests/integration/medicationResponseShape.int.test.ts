/**
 * BUG-456 — Medication response shape ↔ shared SSoT alignment.
 *
 * Pre-fix: backend redeclares its own `interface MedicationResponse` at
 * `apps/api/src/features/medications/medicationService.ts:10-36` with
 * 12 fields missing vs the canonical `MedicationResponseSchema` from
 * `@signacare/shared` and 9 extra legacy fields (medicationName,
 * isClozapine, isS8, lai_*, prescribedAt, prescriber, ...). The mapper
 * `toResponse(r)` returns the backend-local shape; controllers
 * `res.json(...)` it back. Frontend imports the SSoT type but reads
 * `m.brandName`, `m.startDate` from a wire that doesn't carry them →
 * blank UI cells.
 *
 * Post-fix: backend imports `MedicationResponseSchema` and `parse()`s
 * the mapper output; redeclaration is deleted; every SSoT field is
 * populated from `MedicationRow` directly.
 *
 * Pre-fix RED gate: every case fails with concrete Zod-parse issues
 * naming the missing fields, OR with `expect.toHaveProperty(...)` on
 * the missing fields. Post-fix all 5 pass.
 *
 * Test design: seeds the medication directly via `dbAdmin('patient_medications')`
 * to bypass the BUG-040 prescribing-discipline trigger (admin staff
 * are blocked at the DB layer regardless of service-level BYPASS_ROLES).
 * The test exercises the READ path only, which is what BUG-456 governs.
 * The mismatched controller create-body Zod (medicationController.ts:21-38
 * requires `medicationName`/`drugName` instead of shared `drugLabel`) is
 * a sibling drift, filed separately and out of scope here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { MedicationResponseSchema } from '@signacare/shared';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

const TEST_LABEL = `BUG-456-${Date.now()}`;

let token = '';
let clinicId = '';
let patientId = '';
let medicationId = '';
let prescriberStaffId = '';

const auth = (): {
  get: (path: string) => request.Test;
} => ({
  get: (path) =>
    request(app)
      .get(path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test'),
});

describe.skipIf(!READY)('BUG-456 — Medication response ↔ @signacare/shared SSoT', () => {
  beforeAll(async () => {
    const sess = await loginAsAdmin();
    token = sess.token;
    clinicId = sess.clinicId;

    // Use an existing seeded clinician with `discipline = 'psychiatry'`
    // so the BUG-040 DB trigger accepts the prescriber. Admin staff
    // (the seed user) is bypassed at the service layer but blocked at
    // the DB trigger, so we need a real prescriber row.
    const clinician = await dbAdmin('staff')
      .where({ clinic_id: clinicId, discipline: 'psychiatry' })
      .select('id')
      .first();
    if (!clinician) throw new Error('No psychiatry clinician seeded — fixture broken');
    prescriberStaffId = clinician.id as string;

    // Seed the patient.
    patientId = randomUUID();
    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: clinicId,
      given_name: 'BUG456',
      family_name: 'Subject',
      emr_number: TEST_LABEL,
      date_of_birth: '1980-01-01',
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Seed a medication directly. All 32 columns set so the
    // mapper has every field to populate. Pre-fix: 12 of these
    // never reach the wire. Post-fix: all do.
    medicationId = randomUUID();
    await dbAdmin('patient_medications').insert({
      id: medicationId,
      clinic_id: clinicId,
      patient_id: patientId,
      drug_label: 'Sertraline',
      generic_name: 'sertraline',
      brand_name: 'Zoloft',
      dose: '50',
      dose_unit: 'mg',
      route: 'oral',
      frequency: 'daily',
      instructions: 'with food',
      indication: 'depression',
      start_date: '2026-04-25',
      status: 'active',
      is_regular: true,
      is_prn: false,
      is_lai: false,
      source: 'manual',
      prescribed_by_staff_id: prescriberStaffId,
      recorded_by_staff_id: prescriberStaffId,
      notes: `${TEST_LABEL}-roundtrip`,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }, 60_000);

  afterAll(async () => {
    if (!READY) return;
    try {
      if (medicationId) {
        await dbAdmin('patient_medications').where({ id: medicationId }).delete();
      }
      if (patientId) {
        await dbAdmin('patients').where({ id: patientId }).delete();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[BUG-456 cleanup]', err instanceof Error ? err.message : err);
    }
  }, 60_000);

  // ────────────────────────────────────────────────────────────────────────
  // S1 — GET /medications/:id response satisfies MedicationResponseSchema.
  // Pre-fix: 12+ Zod issues naming the missing fields.
  // Post-fix: parse succeeds.
  // ────────────────────────────────────────────────────────────────────────
  it('S1 GET /medications/:id returns a body that satisfies MedicationResponseSchema', async () => {
    const res = await auth().get(`/api/v1/medications/${medicationId}`);
    expect(res.status).toBe(200);
    const parsed = MedicationResponseSchema.safeParse(res.body);
    if (!parsed.success) {
      // eslint-disable-next-line no-console
      console.error('Zod parse issues:', JSON.stringify(parsed.error.issues, null, 2));
    }
    expect(parsed.success).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────
  // S2 — Every SSoT-required field is present (or explicitly null) on
  // the wire. Per-property positive checks.
  // ────────────────────────────────────────────────────────────────────────
  it('S2 GET /medications/:id has all 13 historically-missing SSoT fields', async () => {
    const res = await auth().get(`/api/v1/medications/${medicationId}`);
    expect(res.status).toBe(200);
    const m = res.body as Record<string, unknown>;

    expect(m).toHaveProperty('drugProductId');
    expect(m).toHaveProperty('drugCode');
    expect(m).toHaveProperty('brandName', 'Zoloft');
    expect(m).toHaveProperty('instructions', 'with food');
    expect(m).toHaveProperty('startDate');
    expect(m).toHaveProperty('endDate');
    expect(m).toHaveProperty('reasonForCessation');
    expect(m).toHaveProperty('isRegular', true);
    expect(m).toHaveProperty('isPrn', false);
    expect(m).toHaveProperty('taperSchedule');
    expect(m).toHaveProperty('source', 'manual');
    expect(m).toHaveProperty('prescribedByStaffId', prescriberStaffId);
    expect(m).toHaveProperty('notes', `${TEST_LABEL}-roundtrip`);
  });

  // ────────────────────────────────────────────────────────────────────────
  // S3 — Clinical-safety surface fields are present on the wire.
  // L3+L4 absorb-1: these fields were dropped pre-fix, breaking the
  // Clozapine sub-tab filter, S8 SafeScript banner, printed-prescription
  // warnings, and Clinical Review icon coloring. Restored to SSoT as
  // derived booleans (computed from `category`).
  // ────────────────────────────────────────────────────────────────────────
  it('S3 GET /medications/:id includes derived clinical-safety surface fields', async () => {
    const res = await auth().get(`/api/v1/medications/${medicationId}`);
    const m = res.body as Record<string, unknown>;

    // Clozapine + S8 derived booleans (frontend Clozapine sub-tab,
    // SafeScript banner, printed-prescription warnings depend on these).
    expect(m).toHaveProperty('isClozapine');
    expect(m).toHaveProperty('isS8');
    // Default seed is non-cloz/non-s8 (drug_label = 'Sertraline').
    expect((m as { isClozapine: boolean }).isClozapine).toBe(false);
    expect((m as { isS8: boolean }).isS8).toBe(false);
    // medicationName = derived alias for drugLabel (frontend reads
    // m.medicationName directly without `??` fallback in many sites).
    expect(m).toHaveProperty('medicationName', 'Sertraline');
    // prescribedAt = derived alias for startDate (PatientDetailLayout
    // supply-low alert reads m.prescribedAt).
    expect(m).toHaveProperty('prescribedAt');
    // category = passthrough (noteMacros.ts /meds macro reads m.category).
    expect(m).toHaveProperty('category');
    // LAI ghost-fields: present-on-wire as null until LAI integration
    // ships (sched lives in lai_schedules). Frontend already coalesces.
    expect(m).toHaveProperty('laiFrequency', null);
    expect(m).toHaveProperty('laiNextDue', null);
    expect(m).toHaveProperty('laiLastAdmin', null);
    expect(m).toHaveProperty('prescriber', null);
    expect(m).toHaveProperty('prescribedBySpecialty');
  });

  // ────────────────────────────────────────────────────────────────────────
  // S4 — Status is one of the SSoT enum values.
  // ────────────────────────────────────────────────────────────────────────
  it('S4 status field is one of the SSoT enum values', async () => {
    const res = await auth().get(`/api/v1/medications/${medicationId}`);
    const status = (res.body as { status: string }).status;
    expect(['active', 'tapering', 'ceased', 'suspended', 'on_hold']).toContain(status);
  });

  // ────────────────────────────────────────────────────────────────────────
  // S5 — List-by-patient also satisfies the schema.
  // ────────────────────────────────────────────────────────────────────────
  it('S5 GET /patients/:id/medications — every row satisfies MedicationResponseSchema', async () => {
    // Router mount is `/api/v1/medications`, the listByPatient route is
    // declared as `/patients/:patientId/medications` inside the router,
    // so the full path is the awkward `/medications/patients/:id/medications`.
    const res = await auth().get(`/api/v1/medications/patients/${patientId}/medications`);
    expect(res.status).toBe(200);
    const arr = Array.isArray(res.body)
      ? res.body
      : ((res.body as { medications?: unknown[] }).medications ?? []);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThan(0);
    for (const row of arr) {
      const parsed = MedicationResponseSchema.safeParse(row);
      if (!parsed.success) {
        // eslint-disable-next-line no-console
        console.error('Zod issues:', JSON.stringify(parsed.error.issues, null, 2));
      }
      expect(parsed.success).toBe(true);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // S6 list-fragility regression-test moved to:
  //   apps/api/tests/unit/medicationListFragility.test.ts
  // The integration test path is constrained by the DB CHECK + NOT NULL
  // constraints (the bad-row seed can't pass insert validation), so
  // the unit test directly drives the helper with a hand-crafted bad
  // MedicationRow. Decision documented in BUG-456 absorb-2 commit body.
  //
  // ────────────────────────────────────────────────────────────────────────
  // S7 — L4 absorb-1 — clozapine derivation. The frontend Clozapine
  // sub-tab filter at MedicationsTab.tsx:124 reads `m.isClozapine`.
  // ────────────────────────────────────────────────────────────────────────
  it('S7 medication with category="clozapine" surfaces isClozapine: true', async () => {
    const clozId = randomUUID();
    await dbAdmin('patient_medications').insert({
      id: clozId,
      clinic_id: clinicId,
      patient_id: patientId,
      drug_label: 'Clozaril',
      generic_name: 'clozapine',
      dose: '100',
      route: 'oral',
      frequency: 'BD',
      status: 'active',
      is_lai: false,
      category: 'clozapine',
      source: 'manual',
      prescribed_by_staff_id: prescriberStaffId,
      recorded_by_staff_id: prescriberStaffId,
      created_at: new Date(),
      updated_at: new Date(),
    });
    try {
      const res = await auth().get(`/api/v1/medications/${clozId}`);
      expect(res.status).toBe(200);
      expect(res.body.isClozapine).toBe(true);
      expect(res.body.isS8).toBe(false);
      expect(res.body.category).toBe('clozapine');
    } finally {
      await dbAdmin('patient_medications').where({ id: clozId }).delete().catch(() => null);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // S8 — L4 absorb-1 — Schedule 8 derivation. The frontend SafeScript
  // banner at MedicationsTab.tsx:227-228 reads `m.isS8`.
  // ────────────────────────────────────────────────────────────────────────
  it('S8 medication with category="s8" surfaces isS8: true', async () => {
    const s8Id = randomUUID();
    await dbAdmin('patient_medications').insert({
      id: s8Id,
      clinic_id: clinicId,
      patient_id: patientId,
      drug_label: 'Methylphenidate',
      generic_name: 'methylphenidate',
      dose: '10',
      route: 'oral',
      frequency: 'BD',
      status: 'active',
      is_lai: false,
      category: 's8',
      source: 'manual',
      prescribed_by_staff_id: prescriberStaffId,
      recorded_by_staff_id: prescriberStaffId,
      created_at: new Date(),
      updated_at: new Date(),
    });
    try {
      const res = await auth().get(`/api/v1/medications/${s8Id}`);
      expect(res.status).toBe(200);
      expect(res.body.isClozapine).toBe(false);
      expect(res.body.isS8).toBe(true);
      expect(res.body.category).toBe('s8');
    } finally {
      await dbAdmin('patient_medications').where({ id: s8Id }).delete().catch(() => null);
    }
  });
});
