/**
 * BUG-040 regression — psychologist prescribing barrier (AHPRA-compliant
 * two-layer defence).
 *
 * Layer A (app): medicationService.create + update call
 *   authGuards.requirePrescribingDiscipline before persisting.
 * Layer B (DB): BEFORE INSERT + BEFORE UPDATE OF prescribed_by_staff_id
 *   triggers on patient_medications raise 'prescriber discipline "%" not
 *   authorised to prescribe (BUG-040)' when staff.discipline is not in
 *   the allow-list function is_prescribing_eligible_discipline(text).
 *
 * Coverage matrix (17 tests):
 *
 *   T1 — Psychiatrist INSERT via dbAdmin succeeds (happy path).
 *   T2 — Nurse-practitioner INSERT succeeds.
 *   T3 — GP INSERT succeeds.
 *   T4 — Internal-Medicine INSERT succeeds.
 *   T5 — Endocrinology INSERT succeeds.
 *   T6 — Paediatrics INSERT succeeds.
 *   T7 — Obstetrics & Gynaecology INSERT succeeds.
 *   T8 — General-Surgery INSERT succeeds.
 *   T9 — Medical-Oncology INSERT succeeds.
 *   T10 — Clinical-psychologist INSERT raises canonical BUG-040 error.
 *   T11 — Registered-nurse INSERT raises.
 *   T12 — UPDATE swapping prescribed_by_staff_id to psychologist raises.
 *   T13 — NULL prescribed_by_staff_id INSERT succeeds (legacy path).
 *   T14 — App layer: medicationService.create raises 403
 *        PRESCRIBING_DISCIPLINE_REQUIRED when caller is a psychologist,
 *        before the DB trigger fires.
 *   T15 — App layer: internal-medicine passes requirePrescribingDiscipline.
 *   T16 — NULL-discipline INSERT fails closed.
 *   T17 — DB round-trip for prescribed/recorded prescriber columns.
 *
 * Red-first: pre-migration non-mental specialist cases fail for T4–T9.
 * Post-fix all cases PASS.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

describe.skipIf(!(await isIntegrationReady()))('BUG-040 prescriber discipline barrier', () => {
  let clinicId: string;
  let patientId: string;
  let psychiatristId: string;
  let npId: string;
  let gpId: string;
  let internalMedicineId: string;
  let endocrinologyId: string;
  let paediatricsId: string;
  let obstetricsGynId: string;
  let generalSurgeryId: string;
  let medicalOncologyId: string;
  let psychologistId: string;
  let nurseId: string;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    clinicId = session.clinicId;

    const { dbAdmin } = await import('../../src/db/db');

    const p = await dbAdmin('patients').where({ clinic_id: clinicId }).first();
    if (!p) throw new Error('BUG-040: no seeded patient');
    patientId = p.id as string;

    // Seed 5 staff rows, one per discipline we need, so the trigger
    // has real staff.discipline values to look up.
    const mkStaff = async (discipline: string, emailPrefix: string) => {
      const id = randomUUID();
      await dbAdmin('staff').insert({
        id,
        clinic_id: clinicId,
        given_name: `BUG040-${emailPrefix}`,
        family_name: 'Test',
        email: `bug040-${emailPrefix}-${id.slice(0, 8)}@signacare.local`,
        password_hash: 'x',
        role: 'clinician',
        discipline,
      });
      return id;
    };
    psychiatristId = await mkStaff('psychiatry', 'psychi');
    npId = await mkStaff('nurse-practitioner', 'np');
    gpId = await mkStaff('general-practice', 'gp');
    internalMedicineId = await mkStaff('Internal Medicine', 'im');
    endocrinologyId = await mkStaff('Endocrinology', 'endo');
    paediatricsId = await mkStaff('Paediatrics', 'paeds');
    obstetricsGynId = await mkStaff('Obstetrics & Gynaecology', 'obgyn');
    generalSurgeryId = await mkStaff('General Surgery', 'surg');
    medicalOncologyId = await mkStaff('Medical Oncology', 'onc');
    psychologistId = await mkStaff('clinical-psychology', 'psych');
    nurseId = await mkStaff('registered-nursing', 'rn');
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Delete test medications first (FK -> staff).
    await dbAdmin('patient_medications')
      .where({ clinic_id: clinicId })
      .whereLike('drug_label', 'BUG040-%')
      .del()
      .catch(() => undefined);
    // Then seed staff rows.
    await dbAdmin('staff')
      .whereIn('id', [
        psychiatristId,
        npId,
        gpId,
        internalMedicineId,
        endocrinologyId,
        paediatricsId,
        obstetricsGynId,
        generalSurgeryId,
        medicalOncologyId,
        psychologistId,
        nurseId,
      ])
      .del()
      .catch(() => undefined);
  });

  const insertMed = async (prescriberId: string | null, label: string) => {
    const { dbAdmin } = await import('../../src/db/db');
    return dbAdmin('patient_medications').insert({
      id: randomUUID(),
      clinic_id: clinicId,
      patient_id: patientId,
      drug_label: label,
      generic_name: 'Test Generic',
      dose: '10mg',
      frequency: 'BD',
      route: 'oral',
      status: 'active',
      start_date: new Date().toISOString().slice(0, 10),
      prescribed_by_staff_id: prescriberId,
      source: 'manual',
      created_at: new Date(),
      updated_at: new Date(),
    });
  };

  it('T1 — psychiatrist INSERT succeeds (happy path)', async () => {
    await expect(insertMed(psychiatristId, 'BUG040-T1-psychiatrist')).resolves.toBeDefined();
  });

  it('T2 — nurse-practitioner INSERT succeeds', async () => {
    await expect(insertMed(npId, 'BUG040-T2-np')).resolves.toBeDefined();
  });

  it('T3 — GP INSERT succeeds', async () => {
    await expect(insertMed(gpId, 'BUG040-T3-gp')).resolves.toBeDefined();
  });

  it('T4 — internal-medicine INSERT succeeds', async () => {
    await expect(insertMed(internalMedicineId, 'BUG040-T4-im')).resolves.toBeDefined();
  });

  it('T5 — endocrinology INSERT succeeds', async () => {
    await expect(insertMed(endocrinologyId, 'BUG040-T5-endo')).resolves.toBeDefined();
  });

  it('T6 — paediatrics INSERT succeeds', async () => {
    await expect(insertMed(paediatricsId, 'BUG040-T6-paeds')).resolves.toBeDefined();
  });

  it('T7 — obstetrics & gynaecology INSERT succeeds', async () => {
    await expect(insertMed(obstetricsGynId, 'BUG040-T7-obgyn')).resolves.toBeDefined();
  });

  it('T8 — general-surgery INSERT succeeds', async () => {
    await expect(insertMed(generalSurgeryId, 'BUG040-T8-surg')).resolves.toBeDefined();
  });

  it('T9 — medical-oncology INSERT succeeds', async () => {
    await expect(insertMed(medicalOncologyId, 'BUG040-T9-onc')).resolves.toBeDefined();
  });

  it('T10 — clinical-psychologist INSERT raises canonical BUG-040 error', async () => {
    await expect(insertMed(psychologistId, 'BUG040-T10-psychologist')).rejects.toThrow(
      /prescriber discipline "clinical-psychology" not authorised to prescribe \(BUG-040\)/,
    );
  });

  it('T11 — registered-nurse INSERT raises canonical BUG-040 error', async () => {
    await expect(insertMed(nurseId, 'BUG040-T11-rn')).rejects.toThrow(
      /prescriber discipline "registered-nursing" not authorised to prescribe \(BUG-040\)/,
    );
  });

  it('T12 — UPDATE swapping prescribed_by_staff_id to psychologist raises', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Start with a valid prescriber, then swap to psychologist.
    await insertMed(psychiatristId, 'BUG040-T6-initial');
    await expect(
      dbAdmin('patient_medications')
        .where({ clinic_id: clinicId, drug_label: 'BUG040-T6-initial' })
        .update({ prescribed_by_staff_id: psychologistId }),
    ).rejects.toThrow(/prescriber discipline "clinical-psychology" not authorised to prescribe/);
  });

  it('T13 — NULL prescribed_by_staff_id INSERT succeeds (legacy/transient path)', async () => {
    await expect(insertMed(null, 'BUG040-T13-null-prescriber')).resolves.toBeDefined();
  });

  it('T14 — app-layer requirePrescribingDiscipline rejects psychologist with 403', async () => {
    const { requirePrescribingDiscipline } = await import('../../src/shared/authGuards');
    const authCtx = {
      staffId: psychologistId,
      clinicId,
      role: 'clinician',
      permissions: ['medication:create'],
    };
    await expect(requirePrescribingDiscipline(authCtx as never)).rejects.toMatchObject({
      status: 403,
      code: 'PRESCRIBING_DISCIPLINE_REQUIRED',
    });

    // Happy path: psychiatrist resolves without error.
    const psychiatristCtx = { ...authCtx, staffId: psychiatristId };
    await expect(requirePrescribingDiscipline(psychiatristCtx as never)).resolves.toBeUndefined();
  });

  it('T15 — app-layer requirePrescribingDiscipline accepts internal-medicine', async () => {
    const { requirePrescribingDiscipline } = await import('../../src/shared/authGuards');
    const authCtx = {
      staffId: internalMedicineId,
      clinicId,
      role: 'clinician',
      permissions: ['medication:create'],
    };
    await expect(requirePrescribingDiscipline(authCtx as never)).resolves.toBeUndefined();
  });

  // BUG-040 L4 absorption — trigger must fail-closed when staff.discipline
  // is NULL (legacy seed row with unset discipline). Prevents a
  // mis-configured staff row from silently bypassing AHPRA enforcement.
  it('T16 — INSERT with NULL-discipline staff raises canonical BUG-040 error (fail-closed)', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const staffId = randomUUID();
    await dbAdmin('staff').insert({
      id: staffId,
      clinic_id: clinicId,
      given_name: 'BUG040-NullDisc',
      family_name: 'Test',
      email: `bug040-null-${staffId.slice(0, 8)}@signacare.local`,
      password_hash: 'x',
      role: 'clinician',
      discipline: null,
    });
    try {
      await expect(insertMed(staffId, 'BUG040-T9-null-discipline')).rejects.toThrow(
        /prescriber staff\.discipline is NULL or unset/,
      );
    } finally {
      await dbAdmin('staff').where({ id: staffId }).del().catch(() => undefined);
    }
  });

  // BUG-040 L4 absorption — verify the DB accepts the post-fix column
  // set (with prescribed_by_staff_id + recorded_by_staff_id populated).
  // The repository code change is: DTO fields → insert object literal
  // → column values. T1-T7 already prove the INSERT with these columns
  // + valid prescriber succeeds. This T10 pins that (a) the columns
  // round-trip correctly; (b) the recorder column is also persisted.
  // Full HTTP E2E (service → repo → trigger) is tracked as BUG-292 —
  // requires clinician-role session + RLS middleware wiring that the
  // current test harness doesn't set up.
  it('T17 — DB round-trips prescribed_by_staff_id + recorded_by_staff_id (post-fix column set)', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const medId = randomUUID();
    await dbAdmin('patient_medications').insert({
      id: medId,
      clinic_id: clinicId,
      patient_id: patientId,
      drug_label: 'BUG040-T10-full-columns',
      generic_name: null,
      dose: '5mg',
      frequency: 'OD',
      route: 'oral',
      status: 'active',
      is_lai: false,
      start_date: new Date().toISOString().slice(0, 10),
      indication: null,
      prescribed_by_staff_id: psychiatristId,
      recorded_by_staff_id: psychiatristId,
      prescribed_by_specialty_code: null,
      category: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const persisted = await dbAdmin('patient_medications').where({ id: medId }).first();
    expect(persisted).toBeDefined();
    expect(persisted.prescribed_by_staff_id).toBe(psychiatristId);
    expect(persisted.recorded_by_staff_id).toBe(psychiatristId);
  });
});
