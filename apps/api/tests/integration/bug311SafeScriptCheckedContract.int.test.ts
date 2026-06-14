/**
 * BUG-311 regression — SafeScript `.checked` type-level + persistence contract.
 *
 * Root issue pre-fix:
 *   prescriptionRepository.updateSafescriptResult was a no-op stub, so
 *   `POST /prescriptions/:id/safescript-check` returned stale
 *   `safescriptChecked=false` and never persisted `safescript_result`.
 *
 * Required behavior:
 *   - SafeScript result is persisted to `prescriptions` (`checked`,
 *     `checked_at`, `result`) with typed contract enforcement.
 *   - Malformed result payloads fail closed (422/VALIDATION_ERROR) and do
 *     not mutate prescription SafeScript state.
 */

import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsClinician } from './_helpers';
import { safeScriptService } from '../../src/integrations/safeScript/safeScriptService';
import { CANONICAL_PASSWORD, CANONICAL_PERSONAS } from '../fixtures/canonical-personas';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-311 SafeScript checked contract', () => {
  let token = '';
  let clinicId = '';
  let patientId = '';
  let prescriberId = '';
  let prescriptionId = '';
  let originalRole: string | null = null;
  let originalHpii: string | null = null;

  beforeAll(async () => {
    const session = await loginAsClinician();
    clinicId = session.clinicId;
    prescriberId = session.userId;

    const current = await dbAdmin('staff')
      .where({ id: prescriberId, clinic_id: clinicId })
      .select('role', 'hpii')
      .first();
    originalRole = (current?.role as string | null | undefined) ?? null;
    originalHpii = (current?.hpii as string | null | undefined) ?? null;

    await dbAdmin('staff')
      .where({ id: prescriberId, clinic_id: clinicId })
      .update({
        role: 'prescriber_consultant',
        hpii: '8003611234567893',
        updated_at: new Date(),
      });

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({
        email: CANONICAL_PERSONAS.clinician.email,
        password: CANONICAL_PASSWORD,
      });
    if (loginRes.status !== 200) {
      throw new Error(`BUG-311 prescriber relogin failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
    }
    token = String(loginRes.body?.accessToken ?? '');

    patientId = randomUUID();
    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: clinicId,
      given_name: 'BUG311',
      family_name: 'SafeScript',
      emr_number: `BUG311-${Date.now()}`,
      date_of_birth: '1988-01-01',
      created_at: new Date(),
      updated_at: new Date(),
    });

    prescriptionId = randomUUID();
    await dbAdmin('prescriptions').insert({
      id: prescriptionId,
      clinic_id: clinicId,
      patient_id: patientId,
      prescribed_by_staff_id: prescriberId,
      generic_name: 'Buprenorphine',
      dose: '2mg',
      route: 'oral',
      frequency: 'daily',
      quantity: 14,
      repeats: 0,
      is_s8: true,
      prescribed_date: new Date().toISOString().slice(0, 10),
      is_electronic: false,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  afterAll(async () => {
    await dbAdmin('prescriptions').where({ id: prescriptionId }).del().catch(() => undefined);
    await dbAdmin('patients').where({ id: patientId }).del().catch(() => undefined);
    if (prescriberId) {
      await dbAdmin('staff')
        .where({ id: prescriberId, clinic_id: clinicId })
        .update({
          role: originalRole,
          hpii: originalHpii,
          updated_at: new Date(),
        })
        .catch(() => undefined);
    }
  });

  it('persists checked=true result to prescription row and response', async () => {
    const checkedAt = new Date().toISOString();
    const spy = vi.spyOn(safeScriptService, 'checkPatient').mockResolvedValue({
      checked: true,
      checkedAt,
      patientFound: true,
      supplies: [
        {
          medicationName: 'Buprenorphine',
          dose: '2mg',
          quantity: 28,
          repeatsSupplied: 0,
          dispensingPharmacy: 'BUG311 Pharmacy',
          supplyDate: '2026-05-10',
          prescribedBy: 'Dr BUG311',
        },
      ],
      riskIndicators: [],
    });

    try {
      const res = await request(app)
        .post(`/api/v1/prescriptions/${prescriptionId}/safescript-check`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Client', 'mobile')
        .set('X-CSRF-Token', 'test')
        .send({
          givenName: 'BUG311',
          familyName: 'SafeScript',
          dateOfBirth: '1988-01-01',
          medicareNumber: '21234567890',
          medicareIrn: '1',
        });

      expect(res.status).toBe(200);
      expect(res.body?.safescriptChecked).toBe(true);
      expect(res.body?.safescriptCheckedAt).toBe(checkedAt);
      expect(res.body?.safescriptResult?.checked).toBe(true);
      expect(Array.isArray(res.body?.safescriptResult?.supplies)).toBe(true);

      const row = await dbAdmin('prescriptions')
        .where({ id: prescriptionId, clinic_id: clinicId })
        .select('safescript_checked', 'safescript_checked_at', 'safescript_result')
        .first();

      expect(row?.safescript_checked).toBe(true);
      expect(new Date(row?.safescript_checked_at as string).toISOString()).toBe(checkedAt);
      expect((row?.safescript_result as { checked?: boolean })?.checked).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('fails closed on malformed SafeScript payload and keeps persisted state unchanged', async () => {
    const before = await dbAdmin('prescriptions')
      .where({ id: prescriptionId, clinic_id: clinicId })
      .select('safescript_checked', 'safescript_checked_at', 'safescript_result')
      .first();

    const spy = vi.spyOn(safeScriptService, 'checkPatient').mockResolvedValue({
      checked: 'yes',
      checkedAt: 'not-an-iso-time',
      patientFound: true,
      supplies: [],
      riskIndicators: [],
    } as unknown as Awaited<ReturnType<typeof safeScriptService.checkPatient>>);

    try {
      const res = await request(app)
        .post(`/api/v1/prescriptions/${prescriptionId}/safescript-check`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Client', 'mobile')
        .set('X-CSRF-Token', 'test')
        .send({
          givenName: 'BUG311',
          familyName: 'SafeScript',
          dateOfBirth: '1988-01-01',
          medicareNumber: '21234567890',
          medicareIrn: '1',
        });

      expect(res.status).toBe(422);
      expect(res.body?.code).toBe('VALIDATION_ERROR');

      const after = await dbAdmin('prescriptions')
        .where({ id: prescriptionId, clinic_id: clinicId })
        .select('safescript_checked', 'safescript_checked_at', 'safescript_result')
        .first();

      expect(after?.safescript_checked).toBe(before?.safescript_checked);
      expect(
        after?.safescript_checked_at
          ? new Date(after.safescript_checked_at as string).toISOString()
          : null,
      ).toBe(
        before?.safescript_checked_at
          ? new Date(before.safescript_checked_at as string).toISOString()
          : null,
      );
      expect(after?.safescript_result).toEqual(before?.safescript_result);
    } finally {
      spy.mockRestore();
    }
  });
});
