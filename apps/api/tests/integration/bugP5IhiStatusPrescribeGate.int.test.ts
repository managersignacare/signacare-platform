import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';
import type { AuthContext } from '@signacare/shared';
import { decryptPhi, encryptPhi } from '../../src/utils/phiEncryption';
import { computePatientBlindIndexes } from '../../src/shared/blindIndex';
import { luhnCheck } from '../../src/shared/hiNumbers';

describe.skipIf(!(await isIntegrationReady()))('BUG-P5 prescribe-time IHI status gate', () => {
  let clinicId: string;
  let prescriberId: string;
  let patientId: string;
  let patientMedicationId: string;
  let auth: AuthContext;
  let createdPatientId: string | null = null;
  let createdEpisodeId: string | null = null;
  let originalPrescriberHpii: string | null = null;
  let validPrescriberHpii: string;

  let canonicalIhi: string;

  function fixLuhn(fifteenDigits: string): string {
    for (let d = 0; d < 10; d++) {
      const candidate = `${fifteenDigits}${d}`;
      if (luhnCheck(candidate)) return candidate;
    }
    throw new Error('Unable to derive valid Luhn checksum for BUG-P5 fixture IHI');
  }

  function canonicalHpiiFromStaffId(staffId: string): string {
    const seedBody = staffId.replace(/-/g, '').replace(/\D/g, '').slice(0, 9).padEnd(9, '8');
    return fixLuhn(`800361${seedBody}`);
  }

  beforeAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const clinic = await dbAdmin('clinics')
      .where({ id: '11111111-1111-1111-1111-111111111111' })
      .select('id')
      .first() as { id: string } | undefined;
    if (!clinic) throw new Error('BUG-P5 test clinic not found');
    clinicId = clinic.id;

    const prescriberRow = await dbAdmin('staff')
      .where({ clinic_id: clinicId, discipline: 'psychiatry' })
      .select('id', 'hpii')
      .first() as { id: string; hpii: string | null } | undefined;
    if (!prescriberRow) throw new Error('BUG-P5 prescriber fixture not found');
    prescriberId = prescriberRow.id;
    originalPrescriberHpii = prescriberRow.hpii ?? null;
    validPrescriberHpii = canonicalHpiiFromStaffId(prescriberId);
    if (prescriberRow.hpii !== validPrescriberHpii) {
      await withTenantContext(clinicId, async () => {
        await dbAdmin('staff')
          .where({ id: prescriberId, clinic_id: clinicId })
          .update({ hpii: validPrescriberHpii, updated_at: new Date() });
      });
    }

    const patient = await dbAdmin('patients')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .whereNotNull('ihi_number')
      .select('id', 'ihi_number')
      .first() as { id: string; ihi_number: string | null } | undefined;
    if (!patient) {
      const seededPatientId = randomUUID();
      const seedBody = seededPatientId.replace(/-/g, '').replace(/\D/g, '').slice(0, 9).padEnd(9, '7');
      canonicalIhi = fixLuhn(`800360${seedBody}`);
      await withTenantContext(clinicId, async () => {
        await dbAdmin('patients').insert({
          id: seededPatientId,
          clinic_id: clinicId,
          given_name: 'BugP5',
          family_name: 'Fixture',
          date_of_birth: '1984-01-01',
          gender: 'male',
          ihi_number: encryptPhi(canonicalIhi),
          ihi_number_lookup: computePatientBlindIndexes({ ihiNumber: canonicalIhi }).ihi_number_lookup,
          ihi_record_status: 'verified',
          ihi_number_status: 'active',
          ihi_verified_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        } as never);
      });
      patientId = seededPatientId;
      createdPatientId = seededPatientId;
    } else {
      patientId = patient.id;
      const decrypted = decryptPhi(patient.ihi_number);
      if (
        decrypted
        && /^800360\d{10}$/.test(decrypted)
        && luhnCheck(decrypted)
      ) {
        canonicalIhi = decrypted;
      } else {
        const seedBody = patientId.replace(/-/g, '').replace(/\D/g, '').slice(0, 9).padEnd(9, '7');
        canonicalIhi = fixLuhn(`800360${seedBody}`);
      }
    }

    const relationship = await dbAdmin('episodes')
      .where({
        clinic_id: clinicId,
        patient_id: patientId,
        primary_clinician_id: prescriberId,
        status: 'active',
      })
      .first('id') as { id: string } | undefined;
    if (!relationship) {
      const id = randomUUID();
      await withTenantContext(clinicId, async () => {
        await dbAdmin('episodes').insert({
          id,
          clinic_id: clinicId,
          patient_id: patientId,
          primary_clinician_id: prescriberId,
          episode_type: 'community',
          status: 'active',
          start_date: new Date().toISOString().slice(0, 10),
          created_at: new Date(),
          updated_at: new Date(),
        } as never);
      });
      createdEpisodeId = id;
    }

    auth = {
      staffId: prescriberId,
      clinicId,
      role: 'clinician',
      permissions: ['prescription:create', 'prescription:update'],
      patientId,
      requestId: randomUUID(),
    } as AuthContext;
  });

  beforeEach(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await withTenantContext(clinicId, async () => {
      const lookup = computePatientBlindIndexes({ ihiNumber: canonicalIhi }).ihi_number_lookup;
      await dbAdmin('patients')
        .where({ id: patientId, clinic_id: clinicId })
        .update({
          ihi_number: encryptPhi(canonicalIhi),
          ihi_number_lookup: lookup,
          ihi_record_status: null,
          ihi_number_status: null,
          ihi_verified_at: null,
          updated_at: new Date(),
        });
      await dbAdmin('patient_ihis')
        .where({ clinic_id: clinicId, patient_id: patientId })
        .del();
      await dbAdmin('prescriptions')
        .where({ clinic_id: clinicId, patient_id: patientId })
        .whereLike('generic_name', 'bugp5-%')
        .del();
      await dbAdmin('patient_medications')
        .where({ clinic_id: clinicId, patient_id: patientId })
        .whereLike('generic_name', 'bugp5-%')
        .del();

      const pmId = randomUUID();
      await dbAdmin('patient_medications').insert({
        id: pmId,
        clinic_id: clinicId,
        patient_id: patientId,
        drug_label: 'bugp5-drug 10mg PO',
        generic_name: 'bugp5-drug',
        dose: '10mg',
        route: 'PO',
        frequency: 'daily',
        start_date: '2026-05-01',
        status: 'active',
      });
      patientMedicationId = pmId;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    if (createdEpisodeId) {
      await withTenantContext(clinicId, async () => {
        await dbAdmin('episodes').where({ id: createdEpisodeId }).del().catch(() => undefined);
      });
    }
    if (createdPatientId) {
      await withTenantContext(clinicId, async () => {
        await dbAdmin('patient_medications').where({ patient_id: createdPatientId }).del().catch(() => undefined);
        await dbAdmin('prescriptions').where({ patient_id: createdPatientId }).del().catch(() => undefined);
        await dbAdmin('patient_ihis').where({ patient_id: createdPatientId }).del().catch(() => undefined);
        await dbAdmin('patients').where({ id: createdPatientId }).del().catch(() => undefined);
      });
    }
    if (originalPrescriberHpii !== validPrescriberHpii) {
      await withTenantContext(clinicId, async () => {
        await dbAdmin('staff')
          .where({ id: prescriberId, clinic_id: clinicId })
          .update({ hpii: originalPrescriberHpii, updated_at: new Date() });
      });
    }
  });

  async function seedVerifiedIhiSnapshot(): Promise<void> {
    const { dbAdmin } = await import('../../src/db/db');
    await withTenantContext(clinicId, async () => {
      const lookup = computePatientBlindIndexes({ ihiNumber: canonicalIhi }).ihi_number_lookup;
      await dbAdmin('patient_ihis').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: patientId,
        ihi_value: encryptPhi(canonicalIhi),
        ihi_lookup: lookup,
        record_status: 'verified',
        number_status: 'active',
        source: 'hi_verify',
        created_by_staff_id: prescriberId,
        created_at: new Date(),
        hi_verified_at: new Date(),
      });
    });
  }

  async function createPrescriptionForSubmit(
    options?: {
      isAuthority?: boolean;
      authorityCode?: string;
      pbsItemCode?: string;
    },
  ): Promise<string> {
    const { prescriptionRepository } = await import('../../src/features/prescriptions/prescriptionRepository');
    const row = await prescriptionRepository.create(clinicId, prescriberId, {
      patientId,
      patientMedicationId,
      genericName: `bugp5-${Date.now()}`,
      dose: '10mg',
      route: 'oral',
      frequency: 'daily',
      quantity: 30,
      repeats: 1,
      pbsItemCode: options?.pbsItemCode ?? '1234X',
      isAuthority: options?.isAuthority ?? false,
      authorityCode: options?.authorityCode,
      isS8: false,
      prescriptionType: 'standard',
      prescriptionCategory: 'outpatient',
      prescribedDate: '2026-05-01',
      isElectronic: true,
    });
    return row.id;
  }

  it('T1 — blocks submit when no verified/active IHI status exists', async () => {
    await withTenantContext(clinicId, async () => {
      const id = await createPrescriptionForSubmit();
      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      await expect(
        prescriptionService.submitErx(auth, id, {
          prescriptionId: id,
          patientIhi: '8003600000000000',
          prescriberHpii: validPrescriberHpii,
          prescriberHpio: '8003628833357361',
          medicationName: 'bugp5-drug',
          dose: '10mg',
          route: 'oral',
          frequency: 'daily',
          quantity: 30,
          repeats: 1,
          isS8: false,
          prescribedDate: '2026-05-01',
        }),
      ).rejects.toMatchObject({ code: 'IHI_NOT_PRESCRIBABLE', status: 409 });
    });
  });

  it('T2 — blocks submit when latest IHI snapshot is unverified', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await withTenantContext(clinicId, async () => {
      const lookup = computePatientBlindIndexes({ ihiNumber: canonicalIhi }).ihi_number_lookup;
      await dbAdmin('patient_ihis').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: patientId,
        ihi_value: encryptPhi(canonicalIhi),
        ihi_lookup: lookup,
        record_status: 'unverified',
        number_status: 'active',
        source: 'hi_verify',
        created_by_staff_id: prescriberId,
        created_at: new Date(),
        hi_verified_at: new Date(),
      });
    });

    await withTenantContext(clinicId, async () => {
      const id = await createPrescriptionForSubmit();
      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      await expect(
        prescriptionService.submitErx(auth, id, {
          prescriptionId: id,
          patientIhi: '8003600000000000',
          prescriberHpii: validPrescriberHpii,
          prescriberHpio: '8003628833357361',
          medicationName: 'bugp5-drug',
          dose: '10mg',
          route: 'oral',
          frequency: 'daily',
          quantity: 30,
          repeats: 1,
          isS8: false,
          prescribedDate: '2026-05-01',
        }),
      ).rejects.toMatchObject({ code: 'IHI_NOT_PRESCRIBABLE', status: 409 });
    });
  });

  it('T3 — when eligible, submit uses canonical patient IHI from DB (not client payload)', async () => {
    await seedVerifiedIhiSnapshot();

    await withTenantContext(clinicId, async () => {
      const id = await createPrescriptionForSubmit();
      const escriptModule = await import('../../src/integrations/escript/escriptService');
      const spy = vi.spyOn(escriptModule.escriptService, 'submitPrescription').mockResolvedValue({
        success: false,
        pathway: 'offline',
        error: 'test offline path',
      });
      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      await prescriptionService.submitErx(auth, id, {
        prescriptionId: id,
        patientIhi: '8003600000000000',
        prescriberHpii: validPrescriberHpii,
        prescriberHpio: '8003628833357361',
        medicationName: 'bugp5-drug',
        dose: '10mg',
        route: 'oral',
        frequency: 'daily',
        quantity: 30,
        repeats: 1,
        isS8: false,
        prescribedDate: '2026-05-01',
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const calledPayload = spy.mock.calls.at(-1)?.[2] as { patientIhi?: string } | undefined;
      expect(calledPayload?.patientIhi).toBe(canonicalIhi);
    });
  });

  it('T4 — authority prescription submit derives authority fields from source prescription', async () => {
    await seedVerifiedIhiSnapshot();

    await withTenantContext(clinicId, async () => {
      const id = await createPrescriptionForSubmit({
        isAuthority: true,
        authorityCode: 'PBS-APPROVAL-42',
        pbsItemCode: '8200J',
      });
      const escriptModule = await import('../../src/integrations/escript/escriptService');
      const spy = vi.spyOn(escriptModule.escriptService, 'submitPrescription').mockResolvedValue({
        success: false,
        pathway: 'offline',
        error: 'test offline path',
      });
      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      await prescriptionService.submitErx(auth, id, {
        prescriptionId: id,
        patientIhi: '8003600000000000',
        prescriberHpii: validPrescriberHpii,
        prescriberHpio: '8003628833357361',
        medicationName: 'bugp5-drug',
        dose: '10mg',
        route: 'oral',
        frequency: 'daily',
        quantity: 30,
        repeats: 1,
        isS8: false,
        prescribedDate: '2026-05-01',
      });
      const calledPayload = spy.mock.calls.at(-1)?.[2] as {
        pbsItemCode?: string;
        authorityMode?: string;
        authorityApprovalNumber?: string;
      } | undefined;
      expect(calledPayload?.pbsItemCode).toBe('8200J');
      expect(calledPayload?.authorityMode).toBe('written');
      expect(calledPayload?.authorityApprovalNumber).toBe('PBS-APPROVAL-42');
    });
  });

  it('T5 — authority prescription cannot be forced into private mode', async () => {
    await seedVerifiedIhiSnapshot();

    await withTenantContext(clinicId, async () => {
      const id = await createPrescriptionForSubmit({
        isAuthority: true,
        authorityCode: 'PBS-APPROVAL-99',
        pbsItemCode: '9500X',
      });
      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      await expect(
        prescriptionService.submitErx(auth, id, {
          prescriptionId: id,
          patientIhi: '8003600000000000',
          prescriberHpii: validPrescriberHpii,
          prescriberHpio: '8003628833357361',
          medicationName: 'bugp5-drug',
          dose: '10mg',
          route: 'oral',
          frequency: 'daily',
          quantity: 30,
          repeats: 1,
          isS8: false,
          prescribedDate: '2026-05-01',
          authorityMode: 'private',
          isPrivateScript: true,
          privateScriptNumber: 'PRIV-1',
          privatePriceCents: 2000,
        }),
      ).rejects.toMatchObject({ code: 'PBS_AUTHORITY_MODE_INVALID', status: 409 });
    });
  });

  it('T6 — successful submit triggers MySL active-script sync', async () => {
    await seedVerifiedIhiSnapshot();

    await withTenantContext(clinicId, async () => {
      const id = await createPrescriptionForSubmit();
      const escriptModule = await import('../../src/integrations/escript/escriptService');
      vi.spyOn(escriptModule.escriptService, 'submitPrescription').mockResolvedValue({
        success: true,
        erxToken: 'WF81-SYNC-TOKEN',
        dspId: 'WF81-DSP',
        npdsReference: 'WF81-NPDS-REF',
        expiresAt: '2026-12-31T00:00:00.000Z',
        pathway: 'npds',
        fhirResource: {
          resourceType: 'MedicationRequest',
          intent: 'order',
          status: 'active',
          identifier: [{ system: 'urn:test', value: id }],
        },
      });
      const myslModule = await import('../../src/integrations/escript/myslClient');
      const myslSpy = vi.spyOn(myslModule, 'syncMedicationRequestFromPrescription').mockResolvedValue({
        success: true,
        action: 'created',
        medicationRequestId: 'mysl-med-1',
        patientFhirId: 'mysl-patient-1',
      });

      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      await prescriptionService.submitErx(auth, id, {
        prescriptionId: id,
        patientIhi: '8003600000000000',
        prescriberHpii: validPrescriberHpii,
        prescriberHpio: '8003628833357361',
        medicationName: 'bugp5-drug',
        dose: '10mg',
        route: 'oral',
        frequency: 'daily',
        quantity: 30,
        repeats: 1,
        isS8: false,
        prescribedDate: '2026-05-01',
      });

      expect(myslSpy).toHaveBeenCalledTimes(1);
      expect(myslSpy.mock.calls.at(-1)?.[0]).toMatchObject({
        patientIhi: canonicalIhi,
        prescriptionId: id,
        status: 'active',
        npdsReference: 'WF81-NPDS-REF',
        erxToken: 'WF81-SYNC-TOKEN',
      });
    });
  });

  it('T7 — cancellation triggers MySL update when active token exists', async () => {
    await withTenantContext(clinicId, async () => {
      const id = await createPrescriptionForSubmit();
      const { dbAdmin } = await import('../../src/db/db');
      await dbAdmin('prescriptions')
        .where({ id, clinic_id: clinicId })
        .update({
          erx_token: 'WF81-CANCEL-TOKEN',
          erx_submitted_at: new Date().toISOString(),
          updated_at: new Date(),
        });
      const row = await dbAdmin('prescriptions')
        .where({ id, clinic_id: clinicId })
        .select('lock_version')
        .first() as { lock_version: number } | undefined;
      expect(row).toBeTruthy();

      const myslModule = await import('../../src/integrations/escript/myslClient');
      const myslSpy = vi.spyOn(myslModule, 'syncMedicationRequestFromPrescription').mockResolvedValue({
        success: true,
        action: 'updated',
        medicationRequestId: 'mysl-med-cancel-1',
        patientFhirId: 'mysl-patient-cancel-1',
      });

      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      await prescriptionService.cancel(
        auth,
        id,
        row!.lock_version,
        'Patient preference',
      );

      expect(myslSpy).toHaveBeenCalledTimes(1);
      expect(myslSpy.mock.calls.at(-1)?.[0]).toMatchObject({
        prescriptionId: id,
        status: 'cancelled',
        erxToken: 'WF81-CANCEL-TOKEN',
      });
    });
  });
});
