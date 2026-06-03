import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';
import type { AuthContext } from '@signacare/shared';

describe.skipIf(!(await isIntegrationReady()))(
  'BUG-WF81-DISPENSE-FLOW-MISSING — apply ERX005 dispense notifications',
  () => {
    let clinicId: string;
    let staffId: string;
    let prescriberId: string;
    let patientId: string;
    let seededPatientForSuite = false;
    let auth: AuthContext;

    const createdPrescriptionIds: string[] = [];
    const createdMedicationIds: string[] = [];
    const createdTokenIds: string[] = [];

    beforeAll(async () => {
      const { dbAdmin } = await import('../../src/db/db');
      const session = await loginAsAdmin();
      clinicId = session.clinicId;
      staffId = session.userId;
      const prescriberSeed = await withTenantContext(clinicId, async () =>
        dbAdmin('staff')
          .where({ clinic_id: clinicId, discipline: 'psychiatry' })
          .whereNull('deleted_at')
          .select('id')
          .first(),
      ) as { id: string } | undefined;
      if (prescriberSeed) {
        prescriberId = prescriberSeed.id;
      } else {
        prescriberId = randomUUID();
        await withTenantContext(clinicId, async () => {
          await dbAdmin('staff').insert({
            id: prescriberId,
            clinic_id: clinicId,
            given_name: 'WF81',
            family_name: 'Prescriber',
            email: `wf81-prescriber-${prescriberId.slice(0, 8)}@demo.local`,
            password_hash: 'x',
            role: 'clinician',
            discipline: 'psychiatry',
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          });
        });
      }

      const patientSeed = await withTenantContext(clinicId, async () =>
        dbAdmin('patients')
          .where({ clinic_id: clinicId })
          .whereNull('deleted_at')
          .select('id')
          .first(),
      ) as { id: string } | undefined;
      if (patientSeed) {
        patientId = patientSeed.id;
      } else {
        patientId = randomUUID();
        seededPatientForSuite = true;
        await withTenantContext(clinicId, async () => {
          await dbAdmin('patients').insert({
            id: patientId,
            clinic_id: clinicId,
            given_name: 'WF81',
            family_name: 'DispensePatient',
            emr_number: `WF81-${patientId.slice(0, 8)}`,
            date_of_birth: '1990-01-01',
            created_at: new Date(),
            updated_at: new Date(),
          });
        });
      }

      auth = {
        staffId,
        clinicId,
        role: 'clinician',
        permissions: ['prescription:write'],
        requestId: randomUUID(),
        patientId,
      } as AuthContext;
    });

    afterEach(async () => {
      const { dbAdmin } = await import('../../src/db/db');
      await withTenantContext(clinicId, async () => {
        if (createdTokenIds.length) {
          await dbAdmin('erx_tokens').whereIn('id', createdTokenIds.splice(0)).del();
        }
        if (createdPrescriptionIds.length) {
          await dbAdmin('prescriptions').whereIn('id', createdPrescriptionIds.splice(0)).del();
        }
        if (createdMedicationIds.length) {
          await dbAdmin('patient_medications').whereIn('id', createdMedicationIds.splice(0)).del();
        }
      });
      vi.restoreAllMocks();
    });

    afterAll(async () => {
      if (!seededPatientForSuite) return;
      const { dbAdmin } = await import('../../src/db/db');
      await withTenantContext(clinicId, async () => {
        await dbAdmin('patients').where({ id: patientId, clinic_id: clinicId }).del();
      });
    });

    async function seedPrescriptionWithToken(scriptNumber: string) {
      return withTenantContext(clinicId, async () => {
        const { prescriptionRepository } = await import('../../src/features/prescriptions/prescriptionRepository');
        const medId = randomUUID();
        const { db } = await import('../../src/db/db');
        await db('patient_medications').insert({
          id: medId,
          clinic_id: clinicId,
          patient_id: patientId,
          drug_label: 'WF81 Example 10mg',
          generic_name: 'wf81-example',
          dose: '10mg',
          route: 'oral',
          frequency: 'daily',
          status: 'active',
          start_date: '2026-01-01',
          created_at: new Date(),
          updated_at: new Date(),
        });
        createdMedicationIds.push(medId);

        const prescription = await prescriptionRepository.create(clinicId, prescriberId, {
          patientId,
          patientMedicationId: medId,
          genericName: 'wf81-example',
          dose: '10mg',
          route: 'oral',
          frequency: 'daily',
          quantity: 30,
          repeats: 2,
          prescribedDate: '2026-01-01',
          isElectronic: true,
          isAuthority: false,
          isS8: false,
          prescriptionType: 'standard',
          prescriptionCategory: 'outpatient',
        });
        createdPrescriptionIds.push(prescription.id);

        const token = await prescriptionRepository.createErxToken(
          clinicId,
          prescription.id,
          `TOKEN-${scriptNumber}`,
          scriptNumber,
          null,
          null,
          { fixture: true },
        );
        createdTokenIds.push(token.id);
        return { prescriptionId: prescription.id, tokenId: token.id };
      });
    }

    it('T1: marks token + prescription as dispensed on matched notification', async () => {
      const scriptNumber = `SCRIPT-${randomUUID().slice(0, 8)}`;
      const seeded = await seedPrescriptionWithToken(scriptNumber);

      const erxAdapterModule = await import('../../src/integrations/escript/erxAdapterService');
      vi.spyOn(erxAdapterModule.erxAdapterService, 'pollDispenseNotifications').mockResolvedValue([
        {
          scriptNumber,
          prescriptionId: seeded.prescriptionId,
          dispensedDate: '2026-05-20T09:30:00.000Z',
          dispensedQuantity: 1,
          pharmacyName: 'WF81 Pharmacy',
        },
      ]);

      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      const out = await withTenantContext(clinicId, async () => prescriptionService.pollAndApplyDispenseNotifications(auth));

      expect(out.matched).toBe(1);
      expect(out.updated).toBe(1);
      expect(out.unmatched).toBe(0);
      expect(out.alreadyDispensed).toBe(0);
      expect(out.errors).toBe(0);

      const { db } = await import('../../src/db/db');
      const token = await withTenantContext(clinicId, async () =>
        db('erx_tokens').where({ id: seeded.tokenId, clinic_id: clinicId }).first(),
      );
      expect(token.status).toBe('dispensed');
      expect(token.dispensed_at).toBeTruthy();
      expect(token.dispensing_pharmacy).toBe('WF81 Pharmacy');

      const prescription = await withTenantContext(clinicId, async () =>
        db('prescriptions').where({ id: seeded.prescriptionId, clinic_id: clinicId }).first(),
      );
      expect(prescription.status).toBe('dispensed');
    });

    it('T2: second replay is idempotent and reports alreadyDispensed', async () => {
      const scriptNumber = `SCRIPT-${randomUUID().slice(0, 8)}`;
      const seeded = await seedPrescriptionWithToken(scriptNumber);

      const erxAdapterModule = await import('../../src/integrations/escript/erxAdapterService');
      vi.spyOn(erxAdapterModule.erxAdapterService, 'pollDispenseNotifications').mockResolvedValue([
        {
          scriptNumber,
          prescriptionId: seeded.prescriptionId,
          dispensedDate: '2026-05-20T09:30:00.000Z',
          dispensedQuantity: 1,
          pharmacyName: 'WF81 Pharmacy',
        },
      ]);

      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      await withTenantContext(clinicId, async () => prescriptionService.pollAndApplyDispenseNotifications(auth));
      const replay = await withTenantContext(clinicId, async () => prescriptionService.pollAndApplyDispenseNotifications(auth));

      expect(replay.matched).toBe(1);
      expect(replay.updated).toBe(0);
      expect(replay.alreadyDispensed).toBe(1);
      expect(replay.errors).toBe(0);
    });

    it('T3: unmatched notifications are fail-visible in summary counters', async () => {
      const erxAdapterModule = await import('../../src/integrations/escript/erxAdapterService');
      vi.spyOn(erxAdapterModule.erxAdapterService, 'pollDispenseNotifications').mockResolvedValue([
        {
          scriptNumber: `SCRIPT-${randomUUID().slice(0, 8)}`,
          dispensedDate: '2026-05-20T09:30:00.000Z',
          dispensedQuantity: 1,
          pharmacyName: 'WF81 Pharmacy',
        },
      ]);

      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      const out = await withTenantContext(clinicId, async () => prescriptionService.pollAndApplyDispenseNotifications(auth));
      expect(out.matched).toBe(0);
      expect(out.unmatched).toBe(1);
      expect(out.updated).toBe(0);
      expect(out.errors).toBe(0);
    });
  },
);
