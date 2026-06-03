/**
 * BUG-262 integration — HL7 inbound ORU^R01 ingestion (silent-drop fix).
 *
 * Exercises the full inbound worker processor against real Postgres.
 * No MLLP listener is started — we call `processInboundHl7Job` directly
 * with a synthetic ORU^R01 message, bypassing the on-wire path. That's
 * the same seam `hl7Transport.int.test.ts` uses for outbound.
 *
 * What this catches that a unit test does not:
 *   - Real pathology_orders lookup by (clinic_id, order_number).
 *   - Real pathology_results rows written via dbAdmin (worker context).
 *   - Real audit_log rows for HL7_INBOUND_INGESTED and
 *     HL7_INBOUND_ORDER_NOT_FOUND.
 *   - Critical-flag task creation for abnormal_flag=critical_high.
 *   - Idempotency under BullMQ retry (same job fires twice → 1 result
 *     row, not 2).
 *   - UnrecoverableError semantics for order-not-found.
 *
 * TDD evidence:
 *   - Pre-fix: all 5 scenarios FAIL because processInboundHl7Job throws
 *     `HL7_INBOUND_NOT_IMPLEMENTED` at the stub.
 *   - Post-fix: all 5 PASS.
 *
 * Skip behaviour: if Postgres unreachable, suite degrades to
 * "0 tests run, 0 failed" (same pattern as other .int tests).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { dbAdmin } from '../../src/db/db';
import { processInboundHl7Job } from '../../src/jobs/workers/hl7Worker';

const READY = await isIntegrationReady();

let clinicId = '';
let staffId = '';
let patientId = '';

beforeAll(async () => {
  if (!READY) return;
  const session = await loginAsAdmin();
  clinicId = session.clinicId;
  staffId = session.userId;
  const patient = await dbAdmin('patients').where({ clinic_id: clinicId }).whereNull('deleted_at').first('id');
  if (!patient) throw new Error('No seeded patient for HL7 inbound test');
  patientId = patient.id as string;
});

beforeEach(async () => {
  if (!READY) return;
  // Clean any rows from prior tests in this file. audit_log is
  // tamper-evident (append-only, BUG-039) so we DON'T delete those;
  // each test uses a fresh orderNumber so audit rows are uniquely
  // addressable by (record_id = fresh orderId).
  await dbAdmin('pathology_results')
    .where({ clinic_id: clinicId })
    .whereIn('test_code', ['BUG262-CBC', 'BUG262-POT'])
    .del();
  await dbAdmin('pathology_orders')
    .where({ clinic_id: clinicId, panel_name: 'BUG-262-TEST' })
    .del();
});

afterAll(async () => {
  if (!READY) return;
  await dbAdmin('pathology_results')
    .where({ clinic_id: clinicId })
    .whereIn('test_code', ['BUG262-CBC', 'BUG262-POT'])
    .del();
  await dbAdmin('pathology_orders')
    .where({ clinic_id: clinicId, panel_name: 'BUG-262-TEST' })
    .del();
});

async function seedOrder(): Promise<{ orderId: string; orderNumber: string }> {
  const orderId = randomUUID();
  const orderNumber = `BUG-262-${Date.now()}`;
  await dbAdmin('pathology_orders').insert({
    id: orderId,
    clinic_id: clinicId,
    patient_id: patientId,
    ordered_by_id: staffId,
    order_number: orderNumber,
    panel_name: 'BUG-262-TEST',
    tests: ['CBC', 'Potassium'],
    urgency: 'routine',
    fasting: false,
    copy_to_gp: false,
    status: 'sent',
  });
  return { orderId, orderNumber };
}

function buildOruR01(orderNumber: string): string {
  const now = '20260424120000';
  const segments = [
    `MSH|^~\\&|LAB|SIGNACARE_EMR|${now}||ORU^R01|${orderNumber}|P|2.5`,
    `PID|1||${patientId}^^^SIGNACARE`,
    `OBR|1|${orderNumber}||CBC^CBC Panel|||${now}|||||||||${staffId}||||||||${now}||F|||||||TestLab`,
    // Normal result: haemoglobin
    `OBX|1|NM|BUG262-CBC^Haemoglobin||145|g/L|120-160|N|||F`,
    // Critical high: potassium
    `OBX|2|NM|BUG262-POT^Potassium||6.8|mmol/L|3.5-5.0|HH|||F`,
  ];
  return segments.join('\r');
}

describe.skipIf(!READY)('BUG-262 — HL7 inbound ORU^R01 ingestion', () => {
  it('T1: happy path — ORU^R01 with 2 observations lands 2 rows in pathology_results', async () => {
    const { orderId, orderNumber } = await seedOrder();
    const hl7 = buildOruR01(orderNumber);

    await processInboundHl7Job({ data: { clinicId, hl7Message: hl7 } });

    const results = await dbAdmin('pathology_results')
      .where({ clinic_id: clinicId, pathology_order_id: orderId })
      .orderBy('test_code', 'asc');
    expect(results).toHaveLength(2);

    const cbc = results.find((r) => r.test_code === 'BUG262-CBC');
    expect(cbc).toBeTruthy();
    expect(cbc.result_value).toBe('145');
    expect(cbc.result_unit).toBe('g/L');
    expect(cbc.abnormal_flag).toBe('normal');
    expect(cbc.is_critical).toBe(false);

    const pot = results.find((r) => r.test_code === 'BUG262-POT');
    expect(pot).toBeTruthy();
    expect(pot.result_value).toBe('6.8');
    expect(pot.abnormal_flag).toBe('critical_high');
    expect(pot.is_critical).toBe(true);
  });

  it('T2: order status transitions to complete after full ingestion', async () => {
    const { orderId, orderNumber } = await seedOrder();
    await processInboundHl7Job({ data: { clinicId, hl7Message: buildOruR01(orderNumber) } });

    const order = await dbAdmin('pathology_orders').where({ id: orderId }).first();
    expect(order.status).toBe('complete');
  });

  it('T3: critical abnormal_flag triggers a flag task with urgent priority', async () => {
    const { orderId, orderNumber } = await seedOrder();
    await processInboundHl7Job({ data: { clinicId, hl7Message: buildOruR01(orderNumber) } });

    const critical = await dbAdmin('pathology_results')
      .where({ clinic_id: clinicId, pathology_order_id: orderId, test_code: 'BUG262-POT' })
      .first();
    expect(critical.flag_task_id).not.toBeNull();

    const task = await dbAdmin('tasks').where({ id: critical.flag_task_id }).first();
    expect(task).toBeTruthy();
    expect(task.priority).toBe('urgent');
    expect(task.title).toContain('CRITICAL');
  });

  it('T4: idempotent under BullMQ retry — same job fires twice → 2 result rows total, not 4', async () => {
    const { orderId, orderNumber } = await seedOrder();
    const hl7 = buildOruR01(orderNumber);

    await processInboundHl7Job({ data: { clinicId, hl7Message: hl7 } });
    await processInboundHl7Job({ data: { clinicId, hl7Message: hl7 } });

    const results = await dbAdmin('pathology_results')
      .where({ clinic_id: clinicId, pathology_order_id: orderId });
    expect(results).toHaveLength(2);
  });

  it('T5: order-number-not-found → UnrecoverableError + audit row + 0 result rows', async () => {
    const bogusOrderNumber = `BUG-262-GHOST-${Date.now()}`;
    const hl7 = buildOruR01(bogusOrderNumber);

    await expect(
      processInboundHl7Job({ data: { clinicId, hl7Message: hl7 } }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/order.*not found/i) });

    const results = await dbAdmin('pathology_results')
      .where({ clinic_id: clinicId })
      .whereIn('test_code', ['BUG262-CBC', 'BUG262-POT']);
    expect(results).toHaveLength(0);

    // audit_log is append-only — many rows may exist across test runs
    // with this operation. Use JSONB filter to pick the row for THIS
    // test's unique bogusOrderNumber.
    const audit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, operation: 'HL7_INBOUND_ORDER_NOT_FOUND' })
      .whereRaw("new_data->>'orderNumber' = ?", [bogusOrderNumber])
      .first();
    expect(audit).toBeTruthy();
    expect(audit.new_data).toMatchObject({ orderNumber: bogusOrderNumber });
  });

  it('T6: audit row HL7_INBOUND_INGESTED written on successful ingestion', async () => {
    const { orderId, orderNumber } = await seedOrder();
    await processInboundHl7Job({ data: { clinicId, hl7Message: buildOruR01(orderNumber) } });

    const audit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, operation: 'HL7_INBOUND_INGESTED', record_id: orderId })
      .first();
    expect(audit).toBeTruthy();
    expect(audit.new_data).toMatchObject({
      orderNumber,
      resultCount: 2,
    });
  });

  it('T8: BUG-262-FU — inactive ordering clinician reassigns critical task to clinic nominated admin', async () => {
    // Seed an inactive orderer distinct from the test admin.
    const inactiveId = randomUUID();
    const adminStaff = await dbAdmin('staff').where({ clinic_id: clinicId }).whereNot('id', staffId).first();
    if (!adminStaff) throw new Error('T8 needs a second seeded staff to use as nominated admin');
    const clinicBefore = await dbAdmin('clinics')
      .where({ id: clinicId })
      .first('nominated_admin_staff_id', 'delegated_admin_staff_id');

    await dbAdmin('staff').insert({
      id: inactiveId,
      clinic_id: clinicId,
      email: `bug262fu-inactive-${Date.now()}@test.local`,
      given_name: 'Inactive',
      family_name: 'Orderer',
      role: 'clinician',
      discipline: 'psychiatry',
      is_active: false,
      password_hash: 'x',
      updated_at: dbAdmin.fn.now(),
    });

    // Ensure the clinic has a nominated admin configured.
    await dbAdmin('clinics')
      .where({ id: clinicId })
      .update({ nominated_admin_staff_id: adminStaff.id, updated_at: dbAdmin.fn.now() });
    const clinicConfigured = await dbAdmin('clinics')
      .where({ id: clinicId })
      .first('nominated_admin_staff_id', 'delegated_admin_staff_id');
    const expectedAdminId =
      clinicConfigured?.nominated_admin_staff_id
      ?? clinicConfigured?.delegated_admin_staff_id
      ?? null;
    expect(expectedAdminId).toBeTruthy();

    // Seed an order whose ordered_by points at the inactive staff.
    const orderId = randomUUID();
    const orderNumber = `BUG-262-FU-${Date.now()}`;
    await dbAdmin('pathology_orders').insert({
      id: orderId, clinic_id: clinicId, patient_id: patientId,
      ordered_by_id: inactiveId, order_number: orderNumber,
      panel_name: 'BUG-262-TEST', tests: ['Potassium'], urgency: 'routine',
      fasting: false, copy_to_gp: false, status: 'sent',
    });

    await processInboundHl7Job({ data: { clinicId, hl7Message: buildOruR01(orderNumber) } });

    const critical = await dbAdmin('pathology_results')
      .where({ clinic_id: clinicId, pathology_order_id: orderId, test_code: 'BUG262-POT' })
      .first();
    expect(critical).toBeTruthy();
    expect(critical.flag_task_id).not.toBeNull();

    const task = await dbAdmin('tasks').where({ id: critical.flag_task_id }).first();
    // Task should be assigned to the currently configured clinic admin
    // (nominated preferred, delegated fallback), NOT the inactive orderer.
    expect(task.assigned_to_id).toBe(expectedAdminId);
    expect(task.description).toContain('inactive');
    const reassignedAudit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, record_id: critical.id, operation: 'CRITICAL_RECIPIENT_REASSIGNED' })
      .orderBy('created_at', 'desc')
      .first();
    expect(reassignedAudit).toBeTruthy();
    expect(reassignedAudit.new_data).toMatchObject({
      ordering_staff_id: inactiveId,
      admin_staff_id: expectedAdminId,
      reason: 'all_candidates_inactive_admin_fallback',
    });

    // Cleanup: remove the inactive staff seed + restore admin settings.
    await dbAdmin('clinics')
      .where({ id: clinicId })
      .update({
        nominated_admin_staff_id: clinicBefore?.nominated_admin_staff_id ?? null,
        delegated_admin_staff_id: clinicBefore?.delegated_admin_staff_id ?? null,
        updated_at: dbAdmin.fn.now(),
      });
    await dbAdmin('pathology_orders').where({ id: orderId }).del();
    await dbAdmin('staff').where({ id: inactiveId }).del();
  });

  it('T9: BUG-262-FU — inactive ordering clinician with no clinic admin emits CRITICAL_NO_RECIPIENT_AVAILABLE and keeps task fallback', async () => {
    const inactiveId = randomUUID();
    const clinicBefore = await dbAdmin('clinics')
      .where({ id: clinicId })
      .first('nominated_admin_staff_id', 'delegated_admin_staff_id');

    await dbAdmin('staff').insert({
      id: inactiveId,
      clinic_id: clinicId,
      email: `bug262fu-no-admin-${Date.now()}@test.local`,
      given_name: 'Inactive',
      family_name: 'NoAdmin',
      role: 'clinician',
      discipline: 'psychiatry',
      is_active: false,
      password_hash: 'x',
      updated_at: dbAdmin.fn.now(),
    });

    await dbAdmin('clinics')
      .where({ id: clinicId })
      .update({
        nominated_admin_staff_id: null,
        delegated_admin_staff_id: null,
        updated_at: dbAdmin.fn.now(),
      });

    const orderId = randomUUID();
    const orderNumber = `BUG-262-FU-NOADMIN-${Date.now()}`;
    await dbAdmin('pathology_orders').insert({
      id: orderId,
      clinic_id: clinicId,
      patient_id: patientId,
      ordered_by_id: inactiveId,
      order_number: orderNumber,
      panel_name: 'BUG-262-TEST',
      tests: ['Potassium'],
      urgency: 'routine',
      fasting: false,
      copy_to_gp: false,
      status: 'sent',
    });

    await processInboundHl7Job({ data: { clinicId, hl7Message: buildOruR01(orderNumber) } });

    const critical = await dbAdmin('pathology_results')
      .where({ clinic_id: clinicId, pathology_order_id: orderId, test_code: 'BUG262-POT' })
      .first();
    expect(critical).toBeTruthy();
    expect(critical.flag_task_id).not.toBeNull();

    const task = await dbAdmin('tasks').where({ id: critical.flag_task_id }).first();
    expect(task.assigned_to_id).toBe(inactiveId);
    expect(task.description).toContain('no clinic admin configured');

    const noRecipientAudit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, record_id: critical.id, operation: 'CRITICAL_NO_RECIPIENT_AVAILABLE' })
      .orderBy('created_at', 'desc')
      .first();
    expect(noRecipientAudit).toBeTruthy();
    expect(noRecipientAudit.new_data).toMatchObject({
      ordering_staff_id: inactiveId,
      fallback_assignee_id: inactiveId,
      reason: 'no_admin_configured_assigned_inactive_candidate',
    });

    await dbAdmin('clinics')
      .where({ id: clinicId })
      .update({
        nominated_admin_staff_id: clinicBefore?.nominated_admin_staff_id ?? null,
        delegated_admin_staff_id: clinicBefore?.delegated_admin_staff_id ?? null,
        updated_at: dbAdmin.fn.now(),
      });
    await dbAdmin('pathology_orders').where({ id: orderId }).del();
    await dbAdmin('staff').where({ id: inactiveId }).del();
  });

  it('T7: corrected result (different result_status) lands as a NEW row, not an update (append-only)', async () => {
    const { orderId, orderNumber } = await seedOrder();

    // Step 1: lab sends the original `F` (final) result.
    await processInboundHl7Job({ data: { clinicId, hl7Message: buildOruR01(orderNumber) } });

    const firstPass = await dbAdmin('pathology_results')
      .where({ clinic_id: clinicId, pathology_order_id: orderId });
    expect(firstPass).toHaveLength(2);
    expect(firstPass.every((r) => r.result_status === 'final')).toBe(true);

    // Step 2: lab re-sends the SAME potassium but with `C` (corrected)
    // status and a different result value (e.g. reagent fault discovered).
    const correctedHl7 = [
      `MSH|^~\\&|LAB|SIGNACARE_EMR|20260424130000||ORU^R01|${orderNumber}|P|2.5`,
      `PID|1||${patientId}^^^SIGNACARE`,
      `OBR|1|${orderNumber}||CBC^CBC Panel|||20260424120000|||||||||${staffId}||||||||20260424130000||F|||||||TestLab`,
      `OBX|1|NM|BUG262-POT^Potassium||5.2|mmol/L|3.5-5.0|H|||C`,
    ].join('\r');
    await processInboundHl7Job({ data: { clinicId, hl7Message: correctedHl7 } });

    // Expect 3 rows now: original CBC (normal), original K+ (critical_high),
    // corrected K+ (high, not critical). Append-only — original K+ row is NOT
    // updated or deleted.
    const afterCorrection = await dbAdmin('pathology_results')
      .where({ clinic_id: clinicId, pathology_order_id: orderId })
      .orderBy('created_at', 'asc');
    expect(afterCorrection).toHaveLength(3);

    const potRows = afterCorrection.filter((r) => r.test_code === 'BUG262-POT');
    expect(potRows).toHaveLength(2);

    const original = potRows.find((r) => r.result_status === 'final');
    const corrected = potRows.find((r) => r.result_status === 'corrected');
    expect(original).toBeTruthy();
    expect(original.result_value).toBe('6.8');
    expect(original.abnormal_flag).toBe('critical_high');
    expect(corrected).toBeTruthy();
    expect(corrected.result_value).toBe('5.2');
    expect(corrected.abnormal_flag).toBe('high');
    expect(corrected.is_critical).toBe(false);
  });
});
