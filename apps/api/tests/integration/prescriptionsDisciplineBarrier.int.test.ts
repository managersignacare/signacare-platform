/**
 * BUG-292 regression — AHPRA prescriber-discipline barrier extended to
 * the `prescriptions` (eScript) table. Mirrors BUG-040's 8-test shape
 * applied to the new trigger `prescriptions_prescriber_discipline_check`.
 *
 * Layer A (app): prescriptionService.create / runSafeScriptCheck /
 *   submitErx / cancel call requirePrescribingDiscipline(auth)
 *   before any repository write.
 * Layer B (DB): BEFORE INSERT + BEFORE UPDATE triggers on
 *   `prescriptions` call the SSoT SQL function
 *   is_prescribing_eligible_discipline(slug) from BUG-040's migration
 *   and raise the canonical 'prescriber discipline "%" not authorised
 *   to prescribe (BUG-040)' error.
 *
 * Coverage matrix (9 tests):
 *   T1 — Psychiatrist direct INSERT succeeds (happy path).
 *   T2 — NP direct INSERT succeeds.
 *   T3 — GP direct INSERT succeeds.
 *   T4 — Psychologist direct INSERT raises canonical error.
 *   T5 — RN direct INSERT raises canonical error.
 *   T6 — UPDATE swapping prescribed_by_staff_id → psychologist raises.
 *   T7 — NULL prescribed_by_staff_id INSERT succeeds (legacy path).
 *   T8 — App-layer prescriptionService.create with psychologist auth
 *        raises 403 PRESCRIBING_DISCIPLINE_REQUIRED BEFORE trigger.
 *   T9 — App-layer prescriptionService.cancel with psychologist auth
 *        raises 403 PRESCRIBING_DISCIPLINE_REQUIRED (state-transition
 *        path is also gated).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { AppError } from '../../src/shared/errors';

describe.skipIf(!(await isIntegrationReady()))('BUG-292 prescriptions prescriber discipline barrier', () => {
  let clinicId: string;
  let patientId: string;
  let psychiatristId: string;
  let npId: string;
  let gpId: string;
  let psychologistId: string;
  let nurseId: string;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    clinicId = session.clinicId;

    const { dbAdmin } = await import('../../src/db/db');
    const p = await dbAdmin('patients').where({ clinic_id: clinicId }).first();
    if (!p) throw new Error('BUG-292: no seeded patient');
    patientId = p.id as string;

    const mkStaff = async (discipline: string, emailPrefix: string) => {
      const id = randomUUID();
      await dbAdmin('staff').insert({
        id,
        clinic_id: clinicId,
        given_name: `BUG292-${emailPrefix}`,
        family_name: 'Test',
        email: `bug292-${emailPrefix}-${id.slice(0, 8)}@signacare.local`,
        password_hash: 'x',
        role: 'clinician',
        discipline,
      });
      return id;
    };
    psychiatristId = await mkStaff('psychiatry', 'psychi');
    npId = await mkStaff('nurse-practitioner', 'np');
    gpId = await mkStaff('general-practice', 'gp');
    psychologistId = await mkStaff('clinical-psychology', 'psych');
    nurseId = await mkStaff('registered-nursing', 'rn');
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('prescriptions')
      .where({ clinic_id: clinicId })
      .whereLike('generic_name', 'BUG292-%')
      .del()
      .catch(() => undefined);
    await dbAdmin('staff')
      .whereIn('id', [psychiatristId, npId, gpId, psychologistId, nurseId])
      .del()
      .catch(() => undefined);
  });

  const insertRx = async (prescriberId: string | null, label: string) => {
    const { dbAdmin } = await import('../../src/db/db');
    return dbAdmin('prescriptions').insert({
      id: randomUUID(),
      clinic_id: clinicId,
      patient_id: patientId,
      prescribed_by_staff_id: prescriberId,
      generic_name: label,
      dose: '10mg',
      route: 'oral',
      frequency: 'BD',
      quantity: 28,
      repeats: 0,
      prescribed_date: new Date().toISOString().slice(0, 10),
      is_electronic: false,
    } as never);
  };

  it('T1 — psychiatrist INSERT succeeds (happy path)', async () => {
    await expect(insertRx(psychiatristId, 'BUG292-T1-psychiatrist')).resolves.toBeDefined();
  });

  it('T2 — nurse-practitioner INSERT succeeds', async () => {
    await expect(insertRx(npId, 'BUG292-T2-np')).resolves.toBeDefined();
  });

  it('T3 — GP INSERT succeeds', async () => {
    await expect(insertRx(gpId, 'BUG292-T3-gp')).resolves.toBeDefined();
  });

  it('T4 — clinical-psychologist INSERT raises canonical BUG-040 error', async () => {
    await expect(insertRx(psychologistId, 'BUG292-T4-psychologist')).rejects.toThrow(
      /prescriber discipline "clinical-psychology" not authorised to prescribe \(BUG-040\)/,
    );
  });

  it('T5 — registered-nurse INSERT raises canonical BUG-040 error', async () => {
    await expect(insertRx(nurseId, 'BUG292-T5-rn')).rejects.toThrow(
      /prescriber discipline "registered-nursing" not authorised to prescribe \(BUG-040\)/,
    );
  });

  it('T6 — UPDATE swapping prescribed_by_staff_id to psychologist raises', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await insertRx(psychiatristId, 'BUG292-T6-initial');
    await expect(
      dbAdmin('prescriptions')
        .where({ clinic_id: clinicId, generic_name: 'BUG292-T6-initial' })
        .update({ prescribed_by_staff_id: psychologistId }),
    ).rejects.toThrow(/prescriber discipline "clinical-psychology" not authorised to prescribe/);
  });

  it('T7 — NULL prescribed_by_staff_id INSERT: rejected by NOT NULL constraint (column is NOT NULL on prescriptions)', async () => {
    // Unlike patient_medications (BUG-040 T7), prescriptions schema
    // declares prescribed_by_staff_id NOT NULL. So the "legacy path"
    // test here verifies that the NOT NULL constraint fires, NOT the
    // discipline trigger (which is short-circuited on NULL). Either
    // way, an attempt without a valid prescriber is blocked.
    await expect(insertRx(null, 'BUG292-T7-null')).rejects.toThrow(/null value/);
  });

  it('T8 — app-layer prescriptionService.create with psychologist auth raises 403 PRESCRIBING_DISCIPLINE_REQUIRED', async () => {
    const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
    const auth = {
      staffId: psychologistId,
      clinicId,
      role: 'clinician',
      permissions: ['medication:create', 'prescription:create'],
      patientId,
      requestId: randomUUID(),
    };
    await expect(
      prescriptionService.create(auth, {
        patientId,
        genericName: 'BUG292-T8-blocked',
        dose: '10mg',
        route: 'oral',
        frequency: 'BD',
        quantity: 28,
        repeats: 0,
        prescribedDate: new Date().toISOString().slice(0, 10),
        isElectronic: false,
      } as never),
    ).rejects.toMatchObject({ code: 'PRESCRIBING_DISCIPLINE_REQUIRED', status: 403 });
  });

  it('T9 — app-layer prescriptionService.cancel with psychologist auth raises 403 (state-transition gate)', async () => {
    const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
    // Seed a row via dbAdmin so psychologist can attempt to cancel it.
    const { dbAdmin } = await import('../../src/db/db');
    const rxId = randomUUID();
    await dbAdmin('prescriptions').insert({
      id: rxId,
      clinic_id: clinicId,
      patient_id: patientId,
      prescribed_by_staff_id: psychiatristId,
      generic_name: 'BUG292-T9-seed',
      dose: '10mg',
      route: 'oral',
      frequency: 'BD',
      quantity: 28,
      repeats: 0,
      prescribed_date: new Date().toISOString().slice(0, 10),
      is_electronic: false,
    } as never);

    const auth = {
      staffId: psychologistId,
      clinicId,
      role: 'clinician',
      permissions: ['prescription:cancel'],
      patientId,
      requestId: randomUUID(),
    };
    // BUG-553 — cancel signature now requires expectedLockVersion + reason.
    // Discipline barrier still rejects before the lock-version check, so
    // the test asserts the discipline-barrier rejection regardless of the
    // additional args.
    await expect(prescriptionService.cancel(auth, rxId, 1, 'test cancel')).rejects.toMatchObject({
      code: 'PRESCRIBING_DISCIPLINE_REQUIRED',
      status: 403,
    });
  });

  // silence unused-import warning for AppError (kept for clarity in reader context)
  void AppError;
  void vi;
});
