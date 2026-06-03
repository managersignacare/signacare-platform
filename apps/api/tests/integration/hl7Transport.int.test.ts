/**
 * BUG-238 integration — HL7 outbound transport dispatch + audit.
 *
 * Exercises the full worker processor against real Postgres + real
 * Redis. The HL7 dispatcher (`dispatchHl7`) is mocked so tests drive
 * deterministic transport outcomes without opening real sockets.
 *
 * What this catches that the unit test does not:
 *   - Real pathology_orders row mutation with clinic_id (RLS scope).
 *   - Real audit_log row written by writeAuditLog helper.
 *   - NOT_CONFIGURED path triggering sendAdminAlert (spy-asserted).
 *   - BullMQ UnrecoverableError semantics for non-retryable errors.
 *
 * Skip behaviour: if Postgres or Redis unreachable, suite degrades to
 * "0 tests run, 0 failed" (same pattern as other .int tests).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Mock admin alert so the NOT_CONFIGURED test can assert it fired.
const adminAlertMock = vi.hoisted(() => ({
  sendAdminAlert: vi.fn(async () => undefined),
}));
vi.mock('../../src/features/patient-outreach/adminAlert', () => ({
  sendAdminAlert: adminAlertMock.sendAdminAlert,
}));

import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { dbAdmin } from '../../src/db/db';
import { processOutboundHl7Job, handleOutboundHl7JobFailure } from '../../src/jobs/workers/hl7Worker';
import { UnrecoverableError } from 'bullmq';
import { AppError } from '../../src/shared/errors';
import * as hl7Transport from '../../src/integrations/hl7/hl7Transport';

const READY = await isIntegrationReady();

let clinicId = '';
let staffId = '';
let dispatchSpy: ReturnType<typeof vi.spyOn<typeof hl7Transport, 'dispatchHl7'>>;

beforeAll(async () => {
  if (!READY) return;
  const session = await loginAsAdmin();
  clinicId = session.clinicId;
  staffId = session.userId;
});

beforeEach(async () => {
  dispatchSpy = vi.spyOn(hl7Transport, 'dispatchHl7');
  dispatchSpy.mockReset();
  adminAlertMock.sendAdminAlert.mockClear();
  if (!READY) return;
  // Clean any rows from prior tests.
  await dbAdmin('pathology_orders').where({ clinic_id: clinicId, panel_name: 'BUG-238-TEST' }).del();
  delete process.env['HL7_LAB_PROTOCOL'];
  delete process.env['HL7_LAB_HOST'];
  delete process.env['HL7_LAB_PORT'];
});

afterAll(async () => {
  if (!READY) return;
  await dbAdmin('pathology_orders').where({ clinic_id: clinicId, panel_name: 'BUG-238-TEST' }).del();
});

async function seedOrder(
  urgency: 'routine' | 'urgent' | 'stat' = 'routine',
): Promise<{ orderId: string; orderNumber: string; patientId: string }> {
  // pathology_orders requires a patient row under the same clinic.
  // Use the first seeded patient for this clinic; create a minimal
  // order against it.
  const patient = await dbAdmin('patients').where({ clinic_id: clinicId }).whereNull('deleted_at').first('id');
  if (!patient) throw new Error('No seeded patient available for integration test');
  const patientId = patient.id as string;

  const orderId = randomUUID();
  const orderNumber = `BUG-238-${Date.now()}`;
  await dbAdmin('pathology_orders').insert({
    id: orderId,
    clinic_id: clinicId,
    patient_id: patientId,
    ordered_by_id: staffId,
    order_number: orderNumber,
    panel_name: 'BUG-238-TEST',
    tests: ['CBC', 'LFT'],
    urgency,
    fasting: false,
    copy_to_gp: false,
    status: 'pending',
  });
  return { orderId, orderNumber, patientId };
}

describe.skipIf(!READY)('BUG-238 — HL7 outbound worker processor', () => {
  it('happy path: mllp + ACK → order status=sent, hl7_message stored, audit_log HL7_DISPATCH_SUCCESS', async () => {
    const { orderId, orderNumber } = await seedOrder();
    process.env['HL7_LAB_PROTOCOL'] = 'mllp';
    process.env['HL7_LAB_HOST'] = 'lab.test';
    process.env['HL7_LAB_PORT'] = '2575';
    dispatchSpy.mockResolvedValue({
      ack: `MSH|^~\\&|LAB||SIGNACARE_EMR||20260420||ACK^R01|ACK-${orderNumber}|P|2.5\rMSA|AA|${orderNumber}`,
      protocol: 'mllp',
      transmittedAt: new Date(),
    });

    await processOutboundHl7Job({ data: { orderId, clinicId, orderNumber } });

    const order = await dbAdmin('pathology_orders').where({ id: orderId }).first();
    expect(order.status).toBe('sent');
    expect(order.hl7_message).toContain('MSH|');
    expect(order.hl7_message).toContain('ORM^O01');
    expect(order.hl7_sent_at).not.toBeNull();

    const audit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, record_id: orderId, operation: 'HL7_DISPATCH_SUCCESS' })
      .first();
    expect(audit).toBeTruthy();
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(adminAlertMock.sendAdminAlert).not.toHaveBeenCalled();
  });

  it('NACK: mllp returns MSA|AE → processor throws, audit_log HL7_DISPATCH_FAILURE, order status stays pending', async () => {
    const { orderId, orderNumber } = await seedOrder();
    process.env['HL7_LAB_PROTOCOL'] = 'mllp';
    process.env['HL7_LAB_HOST'] = 'lab.test';
    process.env['HL7_LAB_PORT'] = '2575';
    dispatchSpy.mockRejectedValue(
      new AppError(
        `Lab rejected the message (NACK): panel-unknown`,
        502,
        'HL7_TRANSPORT_NACK',
      ),
    );

    await expect(
      processOutboundHl7Job({ data: { orderId, clinicId, orderNumber } }),
    ).rejects.toMatchObject({ code: 'HL7_TRANSPORT_NACK' });

    const order = await dbAdmin('pathology_orders').where({ id: orderId }).first();
    expect(order.status).toBe('pending');
    expect(order.hl7_sent_at).toBeNull();

    const audit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, record_id: orderId, operation: 'HL7_DISPATCH_FAILURE' })
      .first();
    expect(audit).toBeTruthy();
    expect(adminAlertMock.sendAdminAlert).not.toHaveBeenCalled();
  });

  it('BUG-263: STAT order raises early admin alert at failed attempt 2 while retries remain', async () => {
    const { orderId, orderNumber } = await seedOrder('stat');
    process.env['HL7_LAB_PROTOCOL'] = 'mllp';
    process.env['HL7_LAB_HOST'] = 'lab.test';
    process.env['HL7_LAB_PORT'] = '2575';
    dispatchSpy.mockRejectedValue(
      new AppError(
        'Lab rejected the message (NACK): panel-unknown',
        502,
        'HL7_TRANSPORT_NACK',
      ),
    );

    await expect(
      processOutboundHl7Job({ data: { orderId, clinicId, orderNumber, urgency: 'stat' } }),
    ).rejects.toMatchObject({ code: 'HL7_TRANSPORT_NACK' });

    await handleOutboundHl7JobFailure(
      {
        data: { orderId, clinicId, orderNumber, urgency: 'stat' },
        attemptsMade: 2,
        opts: { attempts: 3 },
      },
      new AppError(
        'Lab rejected the message (NACK): panel-unknown',
        502,
        'HL7_TRANSPORT_NACK',
      ),
    );

    const alertCalls = adminAlertMock.sendAdminAlert.mock.calls
      .map((c) => c[0])
      .filter((arg) => arg?.payload?.['retryProfile'] === 'stat');
    expect(alertCalls).toHaveLength(1);
    expect(alertCalls[0]).toMatchObject({
      clinicId,
      kind: 'integration_unreachable',
      payload: {
        retryProfile: 'stat',
        alertReason: 'retry-threshold-breached',
        attempts: 2,
        maxAttempts: 3,
      },
    });
  });

  it("NOT_CONFIGURED: no env vars → UnrecoverableError, audit_log HL7_DISPATCH_HELD_UNCONFIGURED, sendAdminAlert fired, order flipped to 'held' (L4 clinical-safety fix)", async () => {
    const { orderId, orderNumber } = await seedOrder();
    // env vars intentionally unset.
    dispatchSpy.mockRejectedValue(
      new AppError(
        'HL7 transport not configured — missing env',
        503,
        'HL7_TRANSPORT_NOT_CONFIGURED',
      ),
    );

    await expect(
      processOutboundHl7Job({ data: { orderId, clinicId, orderNumber } }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    // L4 clinical-safety fix: status MUST flip to 'held' so the
    // clinician-facing view reflects non-delivery. If status stays
    // 'pending', the clinician believes the order went through while
    // only the admin alert fires.
    const order = await dbAdmin('pathology_orders').where({ id: orderId }).first();
    expect(order.status).toBe('held');
    expect(order.hl7_sent_at).toBeNull();

    const audit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, record_id: orderId, operation: 'HL7_DISPATCH_HELD_UNCONFIGURED' })
      .first();
    expect(audit).toBeTruthy();

    expect(adminAlertMock.sendAdminAlert).toHaveBeenCalledTimes(1);
    const alertArg = adminAlertMock.sendAdminAlert.mock.calls[0][0];
    expect(alertArg).toMatchObject({
      clinicId,
      kind: 'integration_unreachable',
    });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });
});
