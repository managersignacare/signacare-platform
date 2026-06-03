/**
 * BUG-553 regression — prescription cancellation persists reason + actor
 * + timestamp; service returns dspRevocation tri-state; audit_log captures
 * the forensic snapshot.
 *
 * Coverage (11 scenarios across 9 tests):
 *   T1 — repository.cancelWithReason persists all 3 audit columns
 *   T2 — repository.cancelWithReason flips status='cancelled' atomically
 *   T3 — service.cancel returns dspRevocation='not-applicable' for paper script
 *   T4 — service.cancel returns 'not-applicable' for electronic script with no token
 *   T5 — service.cancel returns 'revoked' when escriptService.cancelToken succeeds
 *   T6 — service.cancel returns 'pending' + emits ERX_CANCEL_DSP_FAILED warn when DSP fails
 *   T7 — service.cancel writes self-contained forensic snapshot to audit_log
 *   T8 — service.cancel marks erx_tokens.status='cancelled' on DSP success
 *   T9 — service.cancel rejects 409 when prescription already cancelled (idempotency)
 *   T10 — service.cancel rejects 409 when token lifecycle is dispensed
 *   T11 — service.cancel rejects 409 when token lifecycle is locked-for-amend
 *
 * Mocking strategy: escriptService.cancelToken is mocked via vi.spyOn so
 * we can deterministically test the success/failure DSP paths without a
 * live NPDS endpoint. logger.warn is spied to verify ERX_CANCEL_DSP_FAILED
 * structured field. All other code paths hit the real test Postgres.
 */

import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';
import type { AuthContext } from '@signacare/shared';

describe.skipIf(!(await isIntegrationReady()))('BUG-553 prescription cancellation reason persistence', () => {
  let clinicId: string;
  let patientId: string;
  let prescriberId: string;
  let patientMedicationId: string;
  let auth: AuthContext;

  beforeAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Pin to the canonical seed clinic that has patients + staff (sibling
    // pattern of prescriptionsDisciplineBarrier.int.test.ts which uses
    // loginAsAdmin → clinicId, but we want a clinic guaranteed to have a
    // patient population for the cancel flow).
    const clinic = (await dbAdmin('clinics')
      .where({ id: '11111111-1111-1111-1111-111111111111' })
      .select('id')
      .first()) as { id: string } | undefined;
    if (!clinic) throw new Error('BUG-553 test: canonical seed clinic not found — run npm run seed first');
    clinicId = clinic.id;
    // Seed a psychiatrist (eligible prescribing discipline per BUG-292)
    const prescriberRow = (await dbAdmin('staff')
      .where({ clinic_id: clinicId, discipline: 'psychiatry' })
      .select('id')
      .first()) as { id: string } | undefined;
    if (prescriberRow) {
      prescriberId = prescriberRow.id;
    } else {
      const id = randomUUID();
      await dbAdmin('staff').insert({
        id,
        clinic_id: clinicId,
        given_name: 'BUG553',
        family_name: 'Prescriber',
        email: `bug553-${id.slice(0, 8)}@signacare.local`,
        password_hash: 'x',
        role: 'clinician',
        discipline: 'psychiatry',
        is_active: true,
      });
      prescriberId = id;
    }
    const p = (await dbAdmin('patients')
      .where({ clinic_id: clinicId })
      .select('id')
      .first()) as { id: string };
    patientId = p.id;
    auth = {
      staffId: prescriberId,
      clinicId,
      role: 'clinician',
      permissions: ['prescription:cancel'],
      patientId,
      requestId: randomUUID(),
    } as AuthContext;
  });

  beforeEach(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const [pm] = (await dbAdmin('patient_medications')
      .insert({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: patientId,
        drug_label: 'bug553-drug 10mg PO',
        generic_name: 'bug553-drug',
        dose: '10mg',
        route: 'PO',
        frequency: 'daily',
        start_date: '2026-05-01',
        status: 'active',
      })
      .returning(['id'])) as { id: string }[];
    patientMedicationId = pm.id;
  });

  afterEach(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('erx_tokens').where({ clinic_id: clinicId }).whereLike('token_value', 'BUG553-%').del();
    if (patientMedicationId) {
      await dbAdmin('prescriptions').where({ patient_medication_id: patientMedicationId }).del();
      await dbAdmin('patient_medications').where({ id: patientMedicationId }).del();
    }
    vi.restoreAllMocks();
  });

  // ── T1, T2 ──
  it('T1+T2: repository.cancelWithReason persists reason + actor + timestamp + flips status', async () => {
    await withTenantContext(clinicId, async () => {
      const { prescriptionRepository } = await import('../../src/features/prescriptions/prescriptionRepository');
      const created = await prescriptionRepository.create(clinicId, prescriberId, {
        patientId,
        patientMedicationId,
        genericName: 'bug553-drug',
        dose: '10mg',
        route: 'PO',
        frequency: 'daily',
        quantity: 30,
        repeats: 0,
        prescribedDate: '2026-05-01',
        isElectronic: false,
        isAuthority: false,
        isS8: false,
        prescriptionType: 'standard',
        prescriptionCategory: 'outpatient',
      });
      const before = Date.now();
      const cancelled = await prescriptionRepository.cancelWithReason(
        created.id,
        clinicId,
        'Prescriber error — wrong dose',
        prescriberId,
        created.lock_version,
      );
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.cancellation_reason).toBe('Prescriber error — wrong dose');
      expect(cancelled.cancelled_by_staff_id).toBe(prescriberId);
      expect(cancelled.cancelled_at).toBeTruthy();
      const cancelledAtMs = new Date(cancelled.cancelled_at!).getTime();
      expect(cancelledAtMs).toBeGreaterThanOrEqual(before - 1000);
      expect(cancelledAtMs).toBeLessThanOrEqual(Date.now() + 1000);
      expect(cancelled.lock_version).toBe(created.lock_version + 1);
    });
  });

  // ── T3 ──
  it('T3: service.cancel returns dspRevocation=not-applicable for paper script', async () => {
    await withTenantContext(clinicId, async () => {
      const { prescriptionRepository } = await import('../../src/features/prescriptions/prescriptionRepository');
      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      const created = await prescriptionRepository.create(clinicId, prescriberId, {
        patientId,
        patientMedicationId,
        genericName: 'bug553-drug',
        dose: '10mg',
        route: 'PO',
        frequency: 'daily',
        quantity: 30,
        repeats: 0,
        prescribedDate: '2026-05-01',
        isElectronic: false,
        isAuthority: false,
        isS8: false,
        prescriptionType: 'standard',
        prescriptionCategory: 'outpatient',
      });
      const result = await prescriptionService.cancel(auth, created.id, created.lock_version, 'reason');
      expect(result.dspRevocation).toBe('not-applicable');
      expect(result.prescription.status).toBe('cancelled');
    });
  });

  // ── T4 ──
  it('T4: service.cancel returns not-applicable for electronic script with no active token', async () => {
    await withTenantContext(clinicId, async () => {
      const { prescriptionRepository } = await import('../../src/features/prescriptions/prescriptionRepository');
      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      const created = await prescriptionRepository.create(clinicId, prescriberId, {
        patientId,
        patientMedicationId,
        genericName: 'bug553-drug',
        dose: '10mg',
        route: 'PO',
        frequency: 'daily',
        quantity: 30,
        repeats: 0,
        prescribedDate: '2026-05-01',
        isElectronic: true,
        isAuthority: false,
        isS8: false,
        prescriptionType: 'standard',
        prescriptionCategory: 'outpatient',
      });
      const result = await prescriptionService.cancel(auth, created.id, created.lock_version, 'reason');
      expect(result.dspRevocation).toBe('not-applicable');
    });
  });

  // ── T5, T8 ──
  it('T5+T8: service.cancel returns revoked + flips erx_tokens.status when DSP succeeds', async () => {
    const escriptModule = await import('../../src/integrations/escript/escriptService');
    const spy = vi
      .spyOn(escriptModule.escriptService, 'cancelToken')
      .mockResolvedValue({ success: true });
    let observedTokenStatus = '';
    await withTenantContext(clinicId, async () => {
      const { prescriptionRepository } = await import('../../src/features/prescriptions/prescriptionRepository');
      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      const { db } = await import('../../src/db/db');
      const created = await prescriptionRepository.create(clinicId, prescriberId, {
        patientId,
        patientMedicationId,
        genericName: 'bug553-drug',
        dose: '10mg',
        route: 'PO',
        frequency: 'daily',
        quantity: 30,
        repeats: 0,
        prescribedDate: '2026-05-01',
        isElectronic: true,
        isAuthority: false,
        isS8: false,
        prescriptionType: 'standard',
        prescriptionCategory: 'outpatient',
      });
      await db('prescriptions').where({ id: created.id }).update({ erx_token: 'BUG553-TKN-OK' });
      const tokenId = randomUUID();
      await db('erx_tokens').insert({
        id: tokenId,
        clinic_id: clinicId,
        prescription_id: created.id,
        token_value: 'BUG553-TKN-OK',
        dsp_id: 'DSP-1',
        npds_reference: 'NPDS-123',
        status: 'issued',
        issued_at: new Date(),
      });
      const fresh = (await db('prescriptions').where({ id: created.id }).select('lock_version').first()) as { lock_version: number };
      const result = await prescriptionService.cancel(auth, created.id, fresh.lock_version, 'DSP success path');
      expect(result.dspRevocation).toBe('revoked');
      const tokenAfter = (await db('erx_tokens').where({ id: tokenId }).select('status').first()) as { status: string };
      observedTokenStatus = tokenAfter.status;
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      clinicId,
      prescriberId,
      'BUG553-TKN-OK',
      'DSP success path',
      expect.objectContaining({ scid: 'DSP-1' }),
    );
    expect(observedTokenStatus).toBe('cancelled');
  });

  // ── T6 ──
  it('T6: service.cancel returns pending + emits ERX_CANCEL_DSP_FAILED when DSP fails', async () => {
    const escriptModule = await import('../../src/integrations/escript/escriptService');
    const loggerModule = await import('../../src/utils/logger');
    vi.spyOn(escriptModule.escriptService, 'cancelToken').mockResolvedValue({
      success: false,
      error: 'NPDS 502 Bad Gateway',
    });
    const warnSpy = vi.spyOn(loggerModule.logger, 'warn');
    let observedTokenStatus = '';
    await withTenantContext(clinicId, async () => {
      const { prescriptionRepository } = await import('../../src/features/prescriptions/prescriptionRepository');
      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      const { db } = await import('../../src/db/db');
      const created = await prescriptionRepository.create(clinicId, prescriberId, {
        patientId,
        patientMedicationId,
        genericName: 'bug553-drug',
        dose: '10mg',
        route: 'PO',
        frequency: 'daily',
        quantity: 30,
        repeats: 0,
        prescribedDate: '2026-05-01',
        isElectronic: true,
        isAuthority: false,
        isS8: false,
        prescriptionType: 'standard',
        prescriptionCategory: 'outpatient',
      });
      await db('prescriptions').where({ id: created.id }).update({ erx_token: 'BUG553-TKN-FAIL' });
      const tokenId = randomUUID();
      await db('erx_tokens').insert({
        id: tokenId,
        clinic_id: clinicId,
        prescription_id: created.id,
        token_value: 'BUG553-TKN-FAIL',
        dsp_id: 'DSP-1',
        npds_reference: 'NPDS-456',
        status: 'issued',
        issued_at: new Date(),
      });
      const fresh = (await db('prescriptions').where({ id: created.id }).select('lock_version').first()) as { lock_version: number };
      const result = await prescriptionService.cancel(auth, created.id, fresh.lock_version, 'DSP failure path');
      expect(result.dspRevocation).toBe('pending');
      const tokenAfter = (await db('erx_tokens').where({ id: tokenId }).select('status').first()) as { status: string };
      observedTokenStatus = tokenAfter.status;
    });
    expect(observedTokenStatus).toBe('issued');
    const warnCall = warnSpy.mock.calls.find((c) => {
      const ctx = c[0] as Record<string, unknown> | undefined;
      return ctx && ctx['kind'] === 'ERX_CANCEL_DSP_FAILED';
    });
    expect(warnCall).toBeTruthy();
  });

  // ── T7 ──
  it('T7: service.cancel writes self-contained forensic snapshot to audit_log', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    let createdId = '';
    await withTenantContext(clinicId, async () => {
      const { prescriptionRepository } = await import('../../src/features/prescriptions/prescriptionRepository');
      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      const { markStepUpVerified } = await import('../../src/shared/stepUpAuth');
      const created = await prescriptionRepository.create(clinicId, prescriberId, {
        patientId,
        patientMedicationId,
        genericName: 'forensic-test-drug',
        dose: '50mg',
        route: 'PO',
        frequency: 'BD',
        quantity: 30,
        repeats: 0,
        prescribedDate: '2026-05-01',
        isElectronic: false,
        isAuthority: false,
        isS8: true,
        prescriptionType: 'standard',
        prescriptionCategory: 'outpatient',
      });
      createdId = created.id;
      // S8 cancellation now enforces explicit step-up (PRES-7 / DH-4155).
      // Prime the step-up key to exercise the audit-write path.
      await markStepUpVerified(auth.staffId);
      await prescriptionService.cancel(auth, created.id, created.lock_version, 'forensic test reason');
    });
    // audit_log uses `operation` column (v2 schema) for action; the legacy
    // `action` column is lowercased. Filter by table_name + record_id only;
    // most-recent row is the cancel UPDATE.
    const auditRow = (await dbAdmin('audit_log')
      .where({ table_name: 'prescriptions', record_id: createdId })
      .orderBy('created_at', 'desc')
      .first()) as { old_data: Record<string, unknown>; new_data: Record<string, unknown> } | undefined;
    expect(auditRow).toBeTruthy();
    const oldData = auditRow!.old_data;
    expect(oldData['genericName']).toBe('forensic-test-drug');
    expect(oldData['dose']).toBe('50mg');
    expect(oldData['isS8']).toBe(true);
    expect(oldData['prescriptionCategory']).toBe('outpatient');
    expect(oldData['prescribedDate']).toBe('2026-05-01');
    expect(auditRow!.new_data['cancellationReason']).toBe('forensic test reason');
    expect(auditRow!.new_data['operation']).toBe('cancel');
    expect(auditRow!.new_data['guid']).toBe(createdId);
    expect(typeof auditRow!.new_data['timezone']).toBe('string');
    expect(auditRow!.new_data['auditSpec']).toBe('dh3945-2B-dh4155-4');
  });

  // ── T9 ──
  it('T9: service.cancel rejects 409 when already cancelled (idempotency guard)', async () => {
    await withTenantContext(clinicId, async () => {
      const { prescriptionRepository } = await import('../../src/features/prescriptions/prescriptionRepository');
      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      const created = await prescriptionRepository.create(clinicId, prescriberId, {
        patientId,
        patientMedicationId,
        genericName: 'bug553-drug',
        dose: '10mg',
        route: 'PO',
        frequency: 'daily',
        quantity: 30,
        repeats: 0,
        prescribedDate: '2026-05-01',
        isElectronic: false,
        isAuthority: false,
        isS8: false,
        prescriptionType: 'standard',
        prescriptionCategory: 'outpatient',
      });
      const r1 = await prescriptionService.cancel(auth, created.id, created.lock_version, 'first');
      expect(r1.prescription.status).toBe('cancelled');
      await expect(
        prescriptionService.cancel(auth, created.id, r1.prescription.lockVersion, 'second'),
      ).rejects.toMatchObject({ code: 'ALREADY_CANCELLED', status: 409 });
    });
  });

  // ── T10 ──
  it('T10: service.cancel rejects 409 when token lifecycle is dispensed', async () => {
    await withTenantContext(clinicId, async () => {
      const { prescriptionRepository } = await import('../../src/features/prescriptions/prescriptionRepository');
      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      const { db } = await import('../../src/db/db');
      const created = await prescriptionRepository.create(clinicId, prescriberId, {
        patientId,
        patientMedicationId,
        genericName: 'bug553-drug',
        dose: '10mg',
        route: 'PO',
        frequency: 'daily',
        quantity: 30,
        repeats: 0,
        prescribedDate: '2026-05-01',
        isElectronic: true,
        isAuthority: false,
        isS8: false,
        prescriptionType: 'standard',
        prescriptionCategory: 'outpatient',
      });
      await db('prescriptions').where({ id: created.id }).update({ erx_token: 'BUG553-TKN-DISPENSED' });
      await db('erx_tokens').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        prescription_id: created.id,
        token_value: 'BUG553-TKN-DISPENSED',
        dsp_id: 'DSP-1',
        npds_reference: 'NPDS-789',
        status: 'dispensed',
        issued_at: new Date(),
        dispensed_at: new Date(),
      });

      await expect(
        prescriptionService.cancel(auth, created.id, created.lock_version, 'should-block-dispensed'),
      ).rejects.toMatchObject({ code: 'ERX_CANCEL_BLOCKED_DISPENSED', status: 409 });
    });
  });

  // ── T11 ──
  it('T11: service.cancel rejects 409 when token lifecycle is locked-for-amend', async () => {
    await withTenantContext(clinicId, async () => {
      const { prescriptionRepository } = await import('../../src/features/prescriptions/prescriptionRepository');
      const { prescriptionService } = await import('../../src/features/prescriptions/prescriptionService');
      const { db } = await import('../../src/db/db');
      const created = await prescriptionRepository.create(clinicId, prescriberId, {
        patientId,
        patientMedicationId,
        genericName: 'bug553-drug',
        dose: '10mg',
        route: 'PO',
        frequency: 'daily',
        quantity: 30,
        repeats: 0,
        prescribedDate: '2026-05-01',
        isElectronic: true,
        isAuthority: false,
        isS8: false,
        prescriptionType: 'standard',
        prescriptionCategory: 'outpatient',
      });
      await db('prescriptions').where({ id: created.id }).update({ erx_token: 'BUG553-TKN-LOCKED' });
      await db('erx_tokens').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        prescription_id: created.id,
        token_value: 'BUG553-TKN-LOCKED',
        dsp_id: 'DSP-1',
        npds_reference: 'NPDS-790',
        status: 'locked',
        issued_at: new Date(),
      });

      await expect(
        prescriptionService.cancel(auth, created.id, created.lock_version, 'should-block-locked'),
      ).rejects.toMatchObject({ code: 'ERX_CANCEL_BLOCKED_LOCKED', status: 409 });
    });
  });
});
