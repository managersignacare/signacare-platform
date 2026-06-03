/**
 * BUG-411 + BUG-400d audit-log regression tests (Bucket A Tier-A drain
 * 2026-05-03). 4 sites covered:
 *
 *   - PATCH /api/v1/clinic-settings → CLINIC_SETTINGS_UPDATE
 *   - POST /api/v1/patients/:id/legal-orders → LEGAL_ORDER_CREATE
 *   - PATCH /api/v1/patients/legal-orders/:orderId → LEGAL_ORDER_UPDATE
 *   - GET /api/v1/patients/:id/legal-orders auto-archive side-effect →
 *     LEGAL_ORDER_AUTO_EXPIRED (with `auto_expired_by: 'list_handler'`
 *     metadata; BUG-400e tracks moving to a daily cron)
 *
 * audit_log queries filter on LOWERCASE `action` per audit.ts:347
 * persistence (column is lowercased; v2 `operation` column carries
 * uppercase per :340). audit_log rows are NOT cleaned up (BUG-039
 * `audit_log_prevent_mutation()` trigger blocks all DELETE) — test
 * rows accumulate harmlessly with fresh per-run UUIDs.
 *
 * Sibling-applicable property #3 (original-value restoration): test
 * captures original `clinic_settings` row for the seeded test clinic
 * (if any) and restores in afterAll so adjacent suites are not
 * polluted. legal-orders test fixtures use synthetic UUIDs scoped to
 * `runId` for isolation.
 *
 * fix-registry anchors pinned by this file: R-FIX-BUG-411-CLINIC-SETTINGS-AUDIT
 * + R-FIX-BUG-400D-CREATE-AUDIT + R-FIX-BUG-400D-UPDATE-AUDIT +
 * R-FIX-BUG-400D-AUTO-EXPIRED-AUDIT.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import app from '../../src/server';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-411 + BUG-400d — audit-log regression for clinic_settings + legal_orders', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const runId = randomUUID().slice(0, 8);
  const tag = `bug411-400d-${runId}`;
  const patientId = randomUUID();
  const orderTypeId = randomUUID();

  // Capture original clinic_settings row (if any) for restoration.
  let origClinicSettings: Record<string, unknown> | null = null;

  // Track legal-order ids created so afterAll can drop the synthetic
  // patient + orders cleanly (audit_log rows are immutable per BUG-039
  // and accumulate harmlessly).
  const createdOrderIds: string[] = [];
  const createdContactIds: string[] = [];

  async function waitForContactRecordBySourceId(sourceId: string): Promise<Record<string, unknown> | null> {
    const maxAttempts = 40;
    const sleepMs = 50;
    for (let i = 0; i < maxAttempts; i += 1) {
      const row = await dbAdmin('contact_records')
        .where({ clinic_id: session.clinicId, patient_id: patientId })
        .whereRaw("content IS NOT NULL AND content::jsonb->>'sourceId' = ?", [sourceId])
        .orderBy('created_at', 'desc')
        .first('id', 'content');
      if (row) return row as Record<string, unknown>;
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
    return null;
  }

  beforeAll(async () => {
    if (!ready) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));

    // Capture clinic_settings pre-image for restoration.
    origClinicSettings =
      (await dbAdmin('clinic_settings')
        .where({ clinic_id: session.clinicId })
        .first()) ?? null;

    // Insert a legal_order_type_config for the LEGAL_ORDER_CREATE test
    // (FK from patient_legal_orders.order_type_id). Per-run unique
    // name so adjacent test runs don't collide. Schema per
    // schema-snapshot.json: clinic-scoped, requires clinic_id + name +
    // category.
    await dbAdmin('legal_order_type_configs').insert({
      id: orderTypeId,
      clinic_id: session.clinicId,
      name: `Integration Test Order Type ${tag}`,
      category: 'compulsory_treatment',
    });

    // Synthetic patient bound to the seeded test clinic.
    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      emr_number: `${tag}-${runId.slice(0, 4)}`,
      given_name: 'Patient',
      family_name: tag,
      date_of_birth: '1990-01-01',
    });
  });

  afterAll(async () => {
    if (!ready || !session) return;

    // FK-safe cleanup. patient_legal_orders may have been auto-archived
    // by the GET test — delete by id list. legal_order_type_configs is
    // global. audit_log rows are append-only (BUG-039) — not deleted.
    if (createdOrderIds.length > 0) {
      await dbAdmin('patient_legal_orders').whereIn('id', createdOrderIds).del();
    }
    if (createdContactIds.length > 0) {
      await dbAdmin('contact_records').whereIn('id', createdContactIds).del();
    }
    await dbAdmin('patients').where({ id: patientId }).del();
    await dbAdmin('legal_order_type_configs').where({ id: orderTypeId }).del();

    // Restore clinic_settings: if no row existed pre-test, drop the row
    // we may have created; if a row existed pre-test, write back the
    // captured pre-image so adjacent suites see consistent state.
    if (!origClinicSettings) {
      await dbAdmin('clinic_settings').where({ clinic_id: session.clinicId }).del();
    } else {
      await dbAdmin('clinic_settings')
        .where({ clinic_id: session.clinicId })
        .update({
          scribe_consent_mode: origClinicSettings.scribe_consent_mode,
          ai_chat_classifier_mode: origClinicSettings.ai_chat_classifier_mode,
          scribe_audio_retention: origClinicSettings.scribe_audio_retention,
          email_sender_mode: origClinicSettings.email_sender_mode ?? 'staff_delegated',
          clinic_sender_email: origClinicSettings.clinic_sender_email ?? null,
          clinic_sender_name: origClinicSettings.clinic_sender_name ?? null,
          updated_at: new Date(),
        });
    }
  });

  describe('BUG-411 — PATCH /clinic-settings audit_log', () => {
    it('TP-CS-AUDIT-411-1: PATCH writes CLINIC_SETTINGS_UPDATE audit_log row with pre-image (oldData) + post-image (newData)', async () => {
      const targetMode = 'patient_esignature' as const;
      const res = await request(app)
        .patch('/api/v1/clinic-settings')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({ scribeConsentMode: targetMode });

      expect(res.status).toBe(200);
      expect(res.body.scribeConsentMode).toBe(targetMode);

      // Audit row filter: lowercase action per audit.ts:347.
      const audit = await dbAdmin('audit_log')
        .where({ clinic_id: session.clinicId, action: 'clinic_settings_update' })
        .orderBy('created_at', 'desc')
        .first('action', 'operation', 'old_data', 'new_data');
      expect(audit).toBeTruthy();
      expect(audit.action).toBe('clinic_settings_update');
      expect(audit.operation).toBe('CLINIC_SETTINGS_UPDATE');

      const newData =
        typeof audit.new_data === 'string' ? JSON.parse(audit.new_data) : audit.new_data;
      expect(newData.scribe_consent_mode).toBe(targetMode);
    });

    it('TP-CS-AUDIT-411-2: rejects clinic_mailbox mode without clinic sender email', async () => {
      const res = await request(app)
        .patch('/api/v1/clinic-settings')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({ emailSenderMode: 'clinic_mailbox', clinicSenderEmail: null });

      expect(res.status).toBe(422);
      expect(String(res.body?.code ?? '')).toBe('VALIDATION_ERROR');
    });

    it('TP-CS-AUDIT-411-3: persists clinic sender profile and records it in audit newData', async () => {
      const senderEmail = `noreply+${runId}@clinic.example`;
      const senderName = `Clinic Sender ${runId}`;

      const res = await request(app)
        .patch('/api/v1/clinic-settings')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({
          emailSenderMode: 'clinic_mailbox',
          clinicSenderEmail: senderEmail,
          clinicSenderName: senderName,
        });

      expect(res.status).toBe(200);
      expect(res.body.emailSenderMode).toBe('clinic_mailbox');
      expect(res.body.clinicSenderEmail).toBe(senderEmail);
      expect(res.body.clinicSenderName).toBe(senderName);

      const audit = await dbAdmin('audit_log')
        .where({ clinic_id: session.clinicId, action: 'clinic_settings_update' })
        .orderBy('created_at', 'desc')
        .first('new_data');
      expect(audit).toBeTruthy();
      const newData =
        typeof audit.new_data === 'string' ? JSON.parse(audit.new_data) : audit.new_data;
      expect(newData.email_sender_mode).toBe('clinic_mailbox');
      expect(newData.clinic_sender_email).toBe(senderEmail);
      expect(newData.clinic_sender_name).toBe(senderName);
    });
  });

  describe('BUG-400d — POST /patients/:id/legal-orders → LEGAL_ORDER_CREATE', () => {
    it('TP-LO-AUDIT-400D-1: POST writes LEGAL_ORDER_CREATE audit_log row with newData carrying patient_id + order_type_id + dates', async () => {
      const res = await request(app)
        .post(`/api/v1/patients/${patientId}/legal-orders`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({
          orderTypeId,
          orderNumber: `MHA-${runId}-CREATE`,
          startDate: new Date().toISOString().slice(0, 10),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10),
          status: 'active',
          notes: 'BUG-400d audit regression test',
        });
      expect(res.status).toBe(201);
      const orderId = res.body.order.id as string;
      createdOrderIds.push(orderId);

      const audit = await dbAdmin('audit_log')
        .where({
          clinic_id: session.clinicId,
          record_id: orderId,
          action: 'legal_order_create',
        })
        .first('action', 'operation', 'new_data');
      expect(audit).toBeTruthy();
      expect(audit.action).toBe('legal_order_create');
      expect(audit.operation).toBe('LEGAL_ORDER_CREATE');

      const newData =
        typeof audit.new_data === 'string' ? JSON.parse(audit.new_data) : audit.new_data;
      expect(newData.patient_id).toBe(patientId);
      expect(newData.order_type_id).toBe(orderTypeId);
      expect(newData.status).toBe('active');

      const contact = await waitForContactRecordBySourceId(orderId);
      expect(contact).toBeTruthy();
      const dupRows = await dbAdmin('contact_records')
        .where({ clinic_id: session.clinicId, patient_id: patientId })
        .whereRaw("content IS NOT NULL AND content::jsonb->>'sourceId' = ?", [orderId])
        .select('id', 'content');
      expect(dupRows.length).toBe(1);
      createdContactIds.push(...dupRows.map((row: { id: string }) => row.id));
      const content =
        typeof contact!.content === 'string'
          ? JSON.parse(contact!.content)
          : contact!.content;
      expect(content.sourceId).toBe(orderId);
      expect(content.sourceType).toBe('correspondence');
    });

    it('TP-LO-AUDIT-400D-LEN-1: rejects orderNumber > 50 with 422 (prevents DB 22001 overflow)', async () => {
      const tooLongOrderNumber = `MHA-${'X'.repeat(48)}`; // 52 chars total
      expect(tooLongOrderNumber.length).toBeGreaterThan(50);

      const res = await request(app)
        .post(`/api/v1/patients/${patientId}/legal-orders`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({
          orderTypeId,
          orderNumber: tooLongOrderNumber,
          startDate: new Date().toISOString().slice(0, 10),
          status: 'active',
          notes: 'Length overflow guard test',
        });

      expect(res.status).toBe(422);
      expect(res.body?.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('BUG-400d — PATCH /patients/legal-orders/:orderId → LEGAL_ORDER_UPDATE', () => {
    it('TP-LO-AUDIT-400D-2: PATCH writes LEGAL_ORDER_UPDATE audit_log row with pre-image (oldData) + post-image (newData) — true diff', async () => {
      // Insert a fresh order via dbAdmin (faster than HTTP for setup).
      const orderId = randomUUID();
      const today = new Date().toISOString().slice(0, 10);
      await dbAdmin('patient_legal_orders').insert({
        id: orderId,
        patient_id: patientId,
        clinic_id: session.clinicId,
        order_type_id: orderTypeId,
        entered_by_id: session.userId,
        order_number: `MHA-${runId}-UPDATE-PRE`,
        start_date: today,
        status: 'active',
      });
      createdOrderIds.push(orderId);

      const res = await request(app)
        .patch(`/api/v1/patients/legal-orders/${orderId}`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({
          expectedLockVersion: 1,
          orderNumber: `MHA-${runId}-UPDATE-POST`,
          notes: 'PATCH applied',
        });

      expect(res.status).toBe(200);
      // Read post-state directly from DB rather than relying on
      // response-shape (route returns the row but column-naming may
      // differ from request-DTO camelCase).
      const post = await dbAdmin('patient_legal_orders')
        .where({ id: orderId })
        .first('order_number');
      expect(post.order_number).toBe(`MHA-${runId}-UPDATE-POST`);

      const audit = await dbAdmin('audit_log')
        .where({
          clinic_id: session.clinicId,
          record_id: orderId,
          action: 'legal_order_update',
        })
        .first('action', 'operation', 'old_data', 'new_data');
      expect(audit).toBeTruthy();
      expect(audit.action).toBe('legal_order_update');
      expect(audit.operation).toBe('LEGAL_ORDER_UPDATE');

      const oldData =
        typeof audit.old_data === 'string' ? JSON.parse(audit.old_data) : audit.old_data;
      const newData =
        typeof audit.new_data === 'string' ? JSON.parse(audit.new_data) : audit.new_data;
      // True diff: pre-image PRE, post-image POST.
      expect(oldData.order_number).toBe(`MHA-${runId}-UPDATE-PRE`);
      expect(newData.order_number).toBe(`MHA-${runId}-UPDATE-POST`);
    });

    it('TP-LO-AUDIT-400D-2-PHI: PATCH audit row MUST NOT contain `notes` or `ai_summary` (L4 cycle-3 absorb — audit_log is immutable; PHI free-text MUST stay out per audit.ts:280+303 contract)', async () => {
      const orderId = randomUUID();
      const today = new Date().toISOString().slice(0, 10);
      await dbAdmin('patient_legal_orders').insert({
        id: orderId,
        patient_id: patientId,
        clinic_id: session.clinicId,
        order_type_id: orderTypeId,
        entered_by_id: session.userId,
        order_number: `MHA-${runId}-PHI-PRE`,
        start_date: today,
        status: 'active',
        notes: 'PHI pre-update — patient presents with [redacted clinical detail]',
        ai_summary: 'AI-generated pre-update summary with hallucinated content',
      });
      createdOrderIds.push(orderId);

      // PATCH includes BOTH structural change (status) AND PHI fields
      // (notes + ai_summary) — verifies the redaction handles the case
      // where the caller explicitly sends PHI into the patch.
      const res = await request(app)
        .patch(`/api/v1/patients/legal-orders/${orderId}`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({
          expectedLockVersion: 1,
          status: 'revoked',
          notes: 'PHI post-update — clinician note with [more redacted detail]',
          aiSummary: 'AI-generated post-update summary',
        });
      expect(res.status).toBe(200);

      // Filter on the order_number to disambiguate this test's audit
      // row from prior tests' audit rows for the same record_id (shared
      // patientId across tests means audit_log accumulates many rows).
      const audit = await dbAdmin('audit_log')
        .where({
          clinic_id: session.clinicId,
          record_id: orderId,
          action: 'legal_order_update',
        })
        .first('old_data', 'new_data');
      expect(audit).toBeTruthy();

      const oldData =
        typeof audit.old_data === 'string' ? JSON.parse(audit.old_data) : audit.old_data;
      const newData =
        typeof audit.new_data === 'string' ? JSON.parse(audit.new_data) : audit.new_data;

      // Structural columns MUST be present — confirms the audit row
      // still captures the diff that AHPRA / coronial review needs.
      expect(oldData.status).toBe('active');
      expect(newData.status).toBe('revoked');
      expect(oldData.order_number).toBe(`MHA-${runId}-PHI-PRE`);

      // PHI fields MUST NOT be present in either oldData or newData.
      // Mutation: removing the column-list projection would re-introduce
      // PHI into immutable audit_log.
      expect(oldData).not.toHaveProperty('notes');
      expect(oldData).not.toHaveProperty('ai_summary');
      expect(newData).not.toHaveProperty('notes');
      expect(newData).not.toHaveProperty('ai_summary');
    });
  });

  describe('BUG-400d — GET /:id/legal-orders auto-archive → LEGAL_ORDER_AUTO_EXPIRED', () => {
    it('TP-LO-AUDIT-400D-3: GET auto-archive writes LEGAL_ORDER_AUTO_EXPIRED audit_log row with auto_expired_by metadata', async () => {
      // Insert an active order whose end_date has already passed — the
      // GET handler will auto-archive on read and emit the audit row.
      const orderId = randomUUID();
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      await dbAdmin('patient_legal_orders').insert({
        id: orderId,
        patient_id: patientId,
        clinic_id: session.clinicId,
        order_type_id: orderTypeId,
        entered_by_id: session.userId,
        order_number: `MHA-${runId}-AUTOEXPIRE`,
        start_date: lastWeek,
        end_date: yesterday,
        status: 'active',
      });
      createdOrderIds.push(orderId);

      const res = await request(app)
        .get(`/api/v1/patients/${patientId}/legal-orders`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test');
      expect(res.status).toBe(200);

      // The order should now be 'expired' in the response.
      const inResponse = (
        res.body.orders as Array<{ id: string; status: string }>
      ).find((o) => o.id === orderId);
      expect(inResponse?.status).toBe('expired');

      const audit = await dbAdmin('audit_log')
        .where({
          clinic_id: session.clinicId,
          record_id: orderId,
          action: 'legal_order_auto_expired',
        })
        .first('action', 'operation', 'old_data', 'new_data');
      expect(audit).toBeTruthy();
      expect(audit.action).toBe('legal_order_auto_expired');
      expect(audit.operation).toBe('LEGAL_ORDER_AUTO_EXPIRED');

      const oldData =
        typeof audit.old_data === 'string' ? JSON.parse(audit.old_data) : audit.old_data;
      const newData =
        typeof audit.new_data === 'string' ? JSON.parse(audit.new_data) : audit.new_data;
      expect(oldData.status).toBe('active');
      expect(newData.status).toBe('expired');
      expect(newData.auto_expired_by).toBe('list_handler');
    });
  });
});
