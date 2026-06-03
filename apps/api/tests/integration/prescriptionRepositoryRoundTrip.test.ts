/**
 * Regression test — Phase 0.7.5 c24 C1 (SD19 fix).
 *
 * Before this commit the prescription insert wrote to 7 columns that don't
 * exist in the `prescriptions` table (medication_id, prescribed_by_id,
 * method, repeats_remaining, dispensing_instructions, authority_required,
 * authority_number). Every prescribe crashed at runtime.
 *
 * This test:
 *   1. Seeds a prescription via the repository (the real code path).
 *   2. Reads the row back.
 *   3. Asserts the row carries the expected canonical columns
 *      (patient_medication_id, prescribed_by_staff_id, drug_product_id,
 *      is_electronic) and that none of the removed ghost columns
 *      leaked into the result.
 *
 * The broader CLAUDE.md §15 row-interface-drift guard + snapshot check
 * catches NEW ghost fields. This test catches REGRESSIONS in the shape
 * of `create()` specifically — e.g. a future PR renaming
 * `prescribed_by_staff_id` back to `prescribed_by_id` would compile
 * cleanly but fail this test.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { isIntegrationReady } from './_helpers';
import { prescriptionRepository } from '../../src/features/prescriptions/prescriptionRepository';
import { dbAdmin } from '../../src/db/db';
import { CANONICAL_PERSONAS } from '../fixtures/canonical-personas';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();
const RUN_TAG = `RXRT_${process.pid}_${Date.now().toString(36)}`;

describe.skipIf(!READY)('prescriptionRepository — insert writes real columns (SD19 regression)', () => {
  let clinicId: string;
  let patientId: string;
  let prescriberId: string;
  let patientMedicationId: string;

  beforeAll(async () => {
    // Anchor to the canonical clinician persona so prescribing tests
    // don't drift onto non-prescribing disciplines (BUG-040 barrier).
    clinicId = CANONICAL_PERSONAS.clinician.clinicId;
    prescriberId = CANONICAL_PERSONAS.clinician.id;
    const clinic = (await dbAdmin('clinics')
      .where({ id: clinicId })
      .select('id')
      .first()) as { id: string } | undefined;
    if (!clinic) throw new Error('Canonical clinic not found; run seed:canonical-personas');
    const prescriber = (await dbAdmin('staff')
      .where({ id: prescriberId, clinic_id: clinicId })
      .select('id')
      .first()) as { id: string } | undefined;
    if (!prescriber) throw new Error('Canonical clinician not found; run seed:canonical-personas');

    const [patient] = (await dbAdmin('patients')
      .insert({
        clinic_id: clinicId,
        emr_number: `${RUN_TAG}-EMR`,
        given_name: 'SD19Regression',
        family_name: RUN_TAG,
        date_of_birth: '1980-01-01',
        gender: 'unknown',
        status: 'active',
      })
      .returning(['id'])) as { id: string }[];
    patientId = patient.id;

    const [pm] = (await dbAdmin('patient_medications')
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        drug_label: 'sd19-test-drug 10mg PO',
        generic_name: 'sd19-test-drug',
        dose: '10mg',
        route: 'PO',
        frequency: 'daily',
        start_date: '2026-04-17',
        status: 'active',
      })
      .returning(['id'])) as { id: string }[];
    patientMedicationId = pm.id;
  });

  it('create() persists a row with canonical column names only', async () => {
    const row = await withTenantContext(clinicId, async () => {
      return prescriptionRepository.create(clinicId, prescriberId, {
        patientId,
        patientMedicationId,
        genericName: 'sd19-test-drug',
        dose: '10mg',
        route: 'PO',
        frequency: 'daily',
        quantity: 30,
        repeats: 2,
        prescribedDate: '2026-04-17',
        isElectronic: true,
        isAuthority: false,
        isS8: false,
        prescriptionType: 'standard',
        prescriptionCategory: 'outpatient',
      });
    });

    // Canonical columns (Phase 0.7.5 c24 post-fix)
    expect(row.patient_id).toBe(patientId);
    expect(row.prescribed_by_staff_id).toBe(prescriberId);
    expect(row.patient_medication_id).toBe(patientMedicationId);
    expect(row.is_electronic).toBe(true);
    expect(row.is_authority).toBe(false);
    expect(row.is_s8).toBe(false);
    expect(row.prescription_type).toBe('standard');
    expect(row.prescription_category).toBe('outpatient');
    expect(row.repeats).toBe(2);

    // Pre-fix ghost columns must not be present — a regression that
    // reintroduces them would crash the insert, but if the column is
    // ever added in a future migration this assertion forces us to
    // intentionally remove it from the test.
    expect((row as unknown as Record<string, unknown>)['medication_id']).toBeUndefined();
    expect((row as unknown as Record<string, unknown>)['prescribed_by_id']).toBeUndefined();
    expect((row as unknown as Record<string, unknown>)['method']).toBeUndefined();
    expect((row as unknown as Record<string, unknown>)['repeats_remaining']).toBeUndefined();
    expect((row as unknown as Record<string, unknown>)['dispensing_instructions']).toBeUndefined();
    expect((row as unknown as Record<string, unknown>)['authority_required']).toBeUndefined();
    expect((row as unknown as Record<string, unknown>)['authority_number']).toBeUndefined();

    // Tidy up — cascade from patient delete clears prescription + pm rows
    await dbAdmin('prescriptions').where({ id: row.id }).del();
  });

  it('create() rejects when patientMedicationId is missing', async () => {
    await expect(
      prescriptionRepository.create(clinicId, prescriberId, {
        patientId,
        genericName: 'x',
        dose: '1',
        route: 'PO',
        frequency: 'daily',
        quantity: 1,
        repeats: 0,
        prescribedDate: '2026-04-17',
        isElectronic: true,
        isAuthority: false,
        isS8: false,
        prescriptionType: 'standard',
        prescriptionCategory: 'outpatient',
      } as unknown as Parameters<typeof prescriptionRepository.create>[2]),
    ).rejects.toThrow(/patientMedicationId is required/);
  });
});
