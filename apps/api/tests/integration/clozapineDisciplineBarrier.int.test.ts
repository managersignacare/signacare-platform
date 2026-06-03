/**
 * BUG-293 regression — AHPRA prescriber-discipline barrier extended to
 * the clozapine tables (`clozapine_titration_days.prescribed_by_staff_id`
 * and `clozapine_registrations.prescriber_staff_id`). Mirrors BUG-040
 * and BUG-292 shape.
 *
 * Layer A (app): clozapineService.createRegistration / .updateRegistration
 *   / .upsertTitrationDay call requirePrescribingDiscipline(auth) before
 *   any repository write. recordBloodResult is deliberately NOT gated
 *   (monitoring, not prescribing).
 *
 * Layer B (DB): BEFORE INSERT + BEFORE UPDATE OF <prescriber-col>
 *   triggers on both tables call the SSoT SQL function
 *   is_prescribing_eligible_discipline(slug) from BUG-040's migration
 *   and raise the canonical 'prescriber discipline "%" not authorised
 *   to prescribe (BUG-040)' error.
 *
 * Coverage matrix (14 tests):
 *   T1  — Psychiatrist INSERT into titration_days succeeds.
 *   T2  — NP INSERT into titration_days succeeds.
 *   T3  — GP INSERT into titration_days succeeds.
 *   T4  — Psychologist INSERT into titration_days raises canonical error.
 *   T5  — RN INSERT into titration_days raises canonical error.
 *   T6  — UPDATE titration_days.prescribed_by_staff_id → psychologist raises.
 *   T7  — NULL prescribed_by_staff_id INSERT into titration_days succeeds
 *         (legacy path; column is NULLABLE, trigger short-circuits).
 *   T8  — Psychiatrist INSERT into registrations succeeds.
 *   T9  — Psychologist INSERT into registrations raises canonical error
 *         (column `prescriber_staff_id`, same trigger semantics).
 *   T10 — App-layer clozapineService.upsertTitrationDay with
 *         psychologist auth raises 403 PRESCRIBING_DISCIPLINE_REQUIRED
 *         BEFORE trigger.
 *   T11 — App-layer clozapineService.createRegistration with psychologist
 *         auth raises 403 PRESCRIBING_DISCIPLINE_REQUIRED.
 *   T13 — App-layer clozapineService.upsertTitrationDay with prescribing
 *         discipline but NULL HPI-I raises 403 PRESCRIBER_HPII_INVALID.
 *   T14 — App-layer clozapineService.createRegistration with prescribing
 *         discipline but NULL HPI-I raises 403 PRESCRIBER_HPII_INVALID.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { AppError } from '../../src/shared/errors';
import { luhnCheck } from '../../src/shared/hiNumbers';

describe.skipIf(!(await isIntegrationReady()))('BUG-293 clozapine prescriber discipline barrier', () => {
  let clinicId: string;
  let patientId: string;
  let psychiatristId: string;
  let npId: string;
  let gpId: string;
  let psychologistId: string;
  let nurseId: string;
  let registrationId: string;
  let createdPatientId: string | null = null;
  const extraStaffIds: string[] = [];

  const buildValidHpii = (): string => {
    const base = '800361000000000';
    for (let d = 0; d < 10; d += 1) {
      const candidate = `${base}${d}`;
      if (luhnCheck(candidate)) return candidate;
    }
    throw new Error('BUG-293: failed to synthesize a valid HPI-I');
  };

  beforeAll(async () => {
    const session = await loginAsAdmin();
    clinicId = session.clinicId;

    const { dbAdmin } = await import('../../src/db/db');
    const withClinicAdmin = async <T>(fn: (trx: import('knex').Knex.Transaction) => Promise<T>): Promise<T> =>
      dbAdmin.transaction(async (trx) => {
        await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
        return fn(trx);
      });
    const p = await dbAdmin('patients').where({ clinic_id: clinicId }).first();
    if (p) {
      patientId = p.id as string;
    } else {
      const syntheticPatientId = randomUUID();
      await withClinicAdmin(async (trx) => {
        await trx('patients').insert({
          id: syntheticPatientId,
          clinic_id: clinicId,
          given_name: 'BUG293',
          family_name: 'SyntheticPatient',
          date_of_birth: '1990-01-01',
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        });
      });
      patientId = syntheticPatientId;
      createdPatientId = syntheticPatientId;
    }

    const mkStaff = async (discipline: string, emailPrefix: string) => {
      const id = randomUUID();
      await dbAdmin('staff').insert({
        id,
        clinic_id: clinicId,
        given_name: `BUG293-${emailPrefix}`,
        family_name: 'Test',
        email: `bug293-${emailPrefix}-${id.slice(0, 8)}@signacare.local`,
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
    // Prescribing-eligible discipline with a valid HPI-I is required to keep
    // the legacy DB-trigger-only test cases deterministic (T1/T2/T3/T8).
    await dbAdmin('staff')
      .where({ id: psychiatristId, clinic_id: clinicId })
      .update({ hpii: buildValidHpii() });

    // Seed a registration attributed to a psychiatrist so T1..T7 can
    // insert titration_days against a valid FK registration_id.
    registrationId = randomUUID();
    await withClinicAdmin(async (trx) => {
      await trx('clozapine_registrations').insert({
        id: registrationId,
        clinic_id: clinicId,
        patient_id: patientId,
        prescriber_staff_id: psychiatristId,
        registration_date: new Date().toISOString().slice(0, 10),
        titration_phase: 'initiation',
        monitoring_frequency: 'weekly',
        anc_status: 'unknown',
      } as never);
    });
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const withClinicAdmin = async <T>(fn: (trx: import('knex').Knex.Transaction) => Promise<T>): Promise<T> =>
      dbAdmin.transaction(async (trx) => {
        await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
        return fn(trx);
      });
    await withClinicAdmin(async (trx) => {
      await trx('clozapine_titration_days')
        .where({ clinic_id: clinicId, registration_id: registrationId })
        .del();
      await trx('clozapine_registrations')
        .where({ clinic_id: clinicId, id: registrationId })
        .del();
    }).catch(() => undefined);
    await dbAdmin('staff')
      .whereIn('id', [psychiatristId, npId, gpId, psychologistId, nurseId])
      .update({ is_active: false, deleted_at: new Date(), updated_at: new Date() })
      .catch(() => undefined);
    if (extraStaffIds.length > 0) {
      await dbAdmin('staff')
        .whereIn('id', extraStaffIds)
        .update({ is_active: false, deleted_at: new Date(), updated_at: new Date() })
        .catch(() => undefined);
    }
    if (createdPatientId) {
      await withClinicAdmin(async (trx) => {
        await trx('patients').where({ id: createdPatientId, clinic_id: clinicId }).del();
      }).catch(() => undefined);
    }
  });

  const insertTitrationDay = async (
    prescriberId: string | null,
    dayNumber: number,
  ): Promise<string> => {
    const { dbAdmin } = await import('../../src/db/db');
    const id = randomUUID();
    await dbAdmin.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
      await trx('clozapine_titration_days').insert({
        id,
        clinic_id: clinicId,
        registration_id: registrationId,
        day_number: dayNumber,
        titration_date: new Date().toISOString().slice(0, 10),
        morning_dose_mg: 12.5,
        evening_dose_mg: 12.5,
        prescribed_by_staff_id: prescriberId,
      } as never);
    });
    return id;
  };

  it('T1 — psychiatrist INSERT into titration_days succeeds', async () => {
    await expect(insertTitrationDay(psychiatristId, 1)).resolves.toBeDefined();
  });

  it('T2 — nurse-practitioner INSERT into titration_days succeeds', async () => {
    await expect(insertTitrationDay(npId, 2)).resolves.toBeDefined();
  });

  it('T3 — GP INSERT into titration_days succeeds', async () => {
    await expect(insertTitrationDay(gpId, 3)).resolves.toBeDefined();
  });

  it('T4 — clinical-psychologist INSERT into titration_days raises canonical BUG-040 error', async () => {
    await expect(insertTitrationDay(psychologistId, 4)).rejects.toThrow(
      /prescriber discipline "clinical-psychology" not authorised to prescribe \(BUG-040\)/,
    );
  });

  it('T5 — registered-nurse INSERT into titration_days raises canonical BUG-040 error', async () => {
    await expect(insertTitrationDay(nurseId, 5)).rejects.toThrow(
      /prescriber discipline "registered-nursing" not authorised to prescribe \(BUG-040\)/,
    );
  });

  it('T6 — UPDATE titration_days.prescribed_by_staff_id to psychologist raises', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const id = await insertTitrationDay(psychiatristId, 6);
    await expect(
      dbAdmin.transaction(async (trx) => {
        await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
        await trx('clozapine_titration_days')
          .where({ clinic_id: clinicId, id })
          .update({ prescribed_by_staff_id: psychologistId });
      }),
    ).rejects.toThrow(/prescriber discipline "clinical-psychology" not authorised to prescribe/);
  });

  it('T7 — NULL prescribed_by_staff_id INSERT succeeds (column NULLABLE, trigger short-circuits)', async () => {
    // clozapine_titration_days.prescribed_by_staff_id is NULLABLE.
    // Trigger short-circuits on NULL — legacy / transient paths allowed
    // so the DB layer never silently lies about attribution; app layer
    // is authoritative.
    await expect(insertTitrationDay(null, 7)).resolves.toBeDefined();
  });

  it('T8 — psychiatrist INSERT into registrations succeeds (prescriber_staff_id column)', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const id = randomUUID();
    await expect(
      dbAdmin.transaction(async (trx) => {
        await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
        await trx('clozapine_registrations').insert({
          id,
          clinic_id: clinicId,
          patient_id: patientId,
          prescriber_staff_id: psychiatristId,
          registration_date: new Date().toISOString().slice(0, 10),
          titration_phase: 'initiation',
          monitoring_frequency: 'weekly',
          anc_status: 'unknown',
        } as never);
      }),
    ).resolves.toBeUndefined();
    await dbAdmin.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
      await trx('clozapine_registrations').where({ id }).del();
    }).catch(() => undefined);
  });

  it('T9 — psychologist INSERT into registrations raises canonical BUG-040 error', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const id = randomUUID();
    await expect(
      dbAdmin.transaction(async (trx) => {
        await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
        await trx('clozapine_registrations').insert({
          id,
          clinic_id: clinicId,
          patient_id: patientId,
          prescriber_staff_id: psychologistId,
          registration_date: new Date().toISOString().slice(0, 10),
          titration_phase: 'initiation',
          monitoring_frequency: 'weekly',
          anc_status: 'unknown',
        } as never);
      }),
    ).rejects.toThrow(/prescriber discipline "clinical-psychology" not authorised to prescribe/);
  });

  it('T10 — app-layer clozapineService.upsertTitrationDay with psychologist auth raises 403', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const { clozapineService } = await import('../../src/features/clozapine/clozapineService');
    const auth = {
      staffId: psychologistId,
      clinicId,
      role: 'clinician',
      permissions: ['prescription:create'],
      patientId,
      requestId: randomUUID(),
    };
    await expect(
      clozapineService.upsertTitrationDay(auth, {
        registrationId,
        dayNumber: 90,
        titrationDate: new Date().toISOString().slice(0, 10),
        morningDoseMg: 25,
        eveningDoseMg: 25,
      } as never),
    ).rejects.toMatchObject({ code: 'PRESCRIBING_DISCIPLINE_REQUIRED', status: 403 });

    const denied = await dbAdmin.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
      return trx('audit_log')
        .where({
          clinic_id: clinicId,
          staff_id: psychologistId,
          table_name: 'clozapine_titration_days',
          record_id: registrationId,
          operation: 'FORBIDDEN_ACCESS',
        })
        .orderBy('created_at', 'desc')
        .first('new_data');
    });
    expect(denied).toBeDefined();
    const newData = typeof denied.new_data === 'string' ? JSON.parse(denied.new_data) : denied.new_data;
    expect(newData).toMatchObject({
      guard: 'requirePrescribingDiscipline',
      code: 'PRESCRIBING_DISCIPLINE_REQUIRED',
      surface: 'upsertTitrationDay',
    });
  });

  it('T11 — app-layer clozapineService.createRegistration with psychologist auth raises 403', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const { clozapineService } = await import('../../src/features/clozapine/clozapineService');
    const auth = {
      staffId: psychologistId,
      clinicId,
      role: 'clinician',
      permissions: ['prescription:create'],
      patientId,
      requestId: randomUUID(),
    };
    await expect(
      clozapineService.createRegistration(auth, {
        patientId,
        registrationDate: new Date().toISOString().slice(0, 10),
        titrationPhase: 'initiation',
        monitoringFrequency: 'weekly',
      } as never),
    ).rejects.toMatchObject({ code: 'PRESCRIBING_DISCIPLINE_REQUIRED', status: 403 });

    const denied = await dbAdmin.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
      return trx('audit_log')
        .where({
          clinic_id: clinicId,
          staff_id: psychologistId,
          table_name: 'clozapine_registrations',
          record_id: patientId,
          operation: 'FORBIDDEN_ACCESS',
        })
        .orderBy('created_at', 'desc')
        .first('new_data');
    });
    expect(denied).toBeDefined();
    const newData = typeof denied.new_data === 'string' ? JSON.parse(denied.new_data) : denied.new_data;
    expect(newData).toMatchObject({
      guard: 'requirePrescribingDiscipline',
      code: 'PRESCRIBING_DISCIPLINE_REQUIRED',
      surface: 'createRegistration',
    });
  });

  it('T12 — source-level: non-prescribing clozapine handlers are routed through service (BUG-323)', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'clozapine', 'clozapineController.ts'),
      'utf-8',
    );

    expect(src).toMatch(/clozapineService\.listTitrationDays/);
    expect(src).toMatch(/clozapineService\.listAdministrations/);
    expect(src).toMatch(/clozapineService\.createAdministration/);
    expect(src).toMatch(/clozapineService\.listObservations/);
    expect(src).toMatch(/clozapineService\.createObservation/);
    expect(src).toMatch(/clozapineService\.listMonitoringChecks/);
    expect(src).toMatch(/clozapineService\.upsertMonitoringCheck/);
    expect(src).not.toMatch(/clozapineRepository\./);
  });

  it('T13 — app-layer upsertTitrationDay with NULL HPI-I prescriber raises 403 PRESCRIBER_HPII_INVALID', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const { clozapineService } = await import('../../src/features/clozapine/clozapineService');
    const noHpiiPrescriberId = randomUUID();
    extraStaffIds.push(noHpiiPrescriberId);
    await dbAdmin('staff').insert({
      id: noHpiiPrescriberId,
      clinic_id: clinicId,
      given_name: 'BUG293NoHpii',
      family_name: 'Test',
      email: `bug293-nohpii-${noHpiiPrescriberId.slice(0, 8)}@signacare.local`,
      password_hash: 'x',
      role: 'clinician',
      discipline: 'psychiatry',
      hpii: null,
    });
    const auth = {
      staffId: noHpiiPrescriberId,
      clinicId,
      role: 'clinician',
      permissions: ['prescription:create'],
      patientId,
      requestId: randomUUID(),
    };

    await expect(
      clozapineService.upsertTitrationDay(auth, {
        registrationId,
        dayNumber: 91,
        titrationDate: new Date().toISOString().slice(0, 10),
        morningDoseMg: 25,
        eveningDoseMg: 25,
      } as never),
    ).rejects.toMatchObject({ code: 'PRESCRIBER_HPII_INVALID', status: 403 });

    const denied = await dbAdmin.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
      return trx('audit_log')
        .where({
          clinic_id: clinicId,
          staff_id: noHpiiPrescriberId,
          table_name: 'clozapine_titration_days',
          record_id: registrationId,
          operation: 'FORBIDDEN_ACCESS',
        })
        .orderBy('created_at', 'desc')
        .first('new_data');
    });
    expect(denied).toBeDefined();
    const newData = typeof denied.new_data === 'string' ? JSON.parse(denied.new_data) : denied.new_data;
    expect(newData).toMatchObject({
      guard: 'requireValidHpii',
      code: 'PRESCRIBER_HPII_INVALID',
      surface: 'upsertTitrationDay',
    });
  });

  it('T14 — app-layer createRegistration with NULL HPI-I prescriber raises 403 PRESCRIBER_HPII_INVALID', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const { clozapineService } = await import('../../src/features/clozapine/clozapineService');
    const noHpiiPrescriberId = randomUUID();
    extraStaffIds.push(noHpiiPrescriberId);
    await dbAdmin('staff').insert({
      id: noHpiiPrescriberId,
      clinic_id: clinicId,
      given_name: 'BUG293NoHpii2',
      family_name: 'Test',
      email: `bug293-nohpii2-${noHpiiPrescriberId.slice(0, 8)}@signacare.local`,
      password_hash: 'x',
      role: 'clinician',
      discipline: 'psychiatry',
      hpii: null,
    });
    const auth = {
      staffId: noHpiiPrescriberId,
      clinicId,
      role: 'clinician',
      permissions: ['prescription:create'],
      patientId,
      requestId: randomUUID(),
    };

    await expect(
      clozapineService.createRegistration(auth, {
        patientId,
        registrationDate: new Date().toISOString().slice(0, 10),
        titrationPhase: 'initiation',
        monitoringFrequency: 'weekly',
      } as never),
    ).rejects.toMatchObject({ code: 'PRESCRIBER_HPII_INVALID', status: 403 });

    const denied = await dbAdmin.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
      return trx('audit_log')
        .where({
          clinic_id: clinicId,
          staff_id: noHpiiPrescriberId,
          table_name: 'clozapine_registrations',
          record_id: patientId,
          operation: 'FORBIDDEN_ACCESS',
        })
        .orderBy('created_at', 'desc')
        .first('new_data');
    });
    expect(denied).toBeDefined();
    const newData = typeof denied.new_data === 'string' ? JSON.parse(denied.new_data) : denied.new_data;
    expect(newData).toMatchObject({
      guard: 'requireValidHpii',
      code: 'PRESCRIBER_HPII_INVALID',
      surface: 'createRegistration',
    });
  });

  void AppError;
  void vi;
});
