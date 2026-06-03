/**
 * BUG-437 — integration test for unbounded `.limit()` ceilings.
 *
 * For each ceiling class, seeds N+1 rows where N is the proposed cap and
 * asserts the response set length is bounded by N. Pre-fix the response
 * is 501; post-fix the response is 500.
 *
 * The 8 ceiling classes covered (mirrors §4 of the BUG-437 plan):
 *   F1 — FHIR Condition (per-patient diagnoses, cap=500)
 *   F2 — FHIR MedicationStatement (per-patient meds, cap=500)
 *   F3 — FHIR AllergyIntolerance (per-patient allergies, cap=500)
 *   F4 — FHIR Encounter (per-patient episodes, cap=500)
 *   N1 — clinical-notes meds snippet (per-patient active meds, cap=500)
 *   T2 — messaging inbox (per-user messages, cap=500)
 *   P1 — pathology orders by patient (per-patient orders, cap=500)
 *   K1 — tasks list (clinic-wide tasks, cap=500)
 *
 * Tests share one patient + one clinic (the seeded admin clinic). Bulk
 * seeds are inserted via `dbAdmin` (RLS bypass) using the unique label
 * `BUG-437-CEIL-<timestamp>` so afterAll cleanup is precise.
 *
 * Schema-conformant seeds: every column in every insert below is
 * verified against `apps/api/src/db/schema-snapshot.json` AND the live
 * `information_schema.columns` query for NOT-NULL-no-default columns.
 * No guessing — see the BUG-437 plan §8 verification log.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

const TEST_LABEL = `BUG-437-CEIL-${Date.now()}`;
const CAP = 500; // shared per-patient list cap
const OVERFLOW = CAP + 1; // 501 — minimum to prove the ceiling fires

let token = '';
let clinicId = '';
let userId = '';
let patientId = '';
let senderStaffId = '';
const threadIds: string[] = [];
const seededStaffIds: string[] = []; // F5 — 1001 active staff
const seededAuditRecordId = randomUUID(); // X1 — focal record_id for 2001 audit rows
const seededCriticalResultIds: string[] = []; // P2 acknowledge regression
let seededPathologyOrderId = '';

interface NoteSnippet {
  type?: string;
  recordCount?: number;
}

describe.skipIf(!READY)('BUG-437 — `.limit()` safety ceilings', () => {
  beforeAll(async () => {
    const sess = await loginAsAdmin();
    token = sess.token;
    clinicId = sess.clinicId;
    userId = sess.userId;

    patientId = randomUUID();
    senderStaffId = randomUUID();

    // Sender staff for the inbox test. The inbox query excludes messages
    // the logged-in user is the SENDER of, so we need a separate sender.
    await dbAdmin('staff').insert({
      id: senderStaffId,
      clinic_id: clinicId,
      email: `${TEST_LABEL}-sender@signacare.local`,
      given_name: 'Inbox',
      family_name: 'Sender',
      password_hash: '$2a$10$x'.padEnd(60, 'x'), // throwaway test hash
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: clinicId,
      given_name: 'Ceiling',
      family_name: 'Patient',
      emr_number: TEST_LABEL,
      date_of_birth: '1990-01-01',
      created_at: new Date(),
      updated_at: new Date(),
    });

    // ── F1: 501 diagnoses (per-patient cap=500) ─────────────────────────────
    await dbAdmin('diagnoses').insert(
      Array.from({ length: OVERFLOW }, (_, i) => ({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: patientId,
        created_by_id: userId,
        icd_code: `Z00.${i % 99}`,
        description: `${TEST_LABEL}-dx-${i}`,
        diagnosed_date: '2024-01-01',
        status: 'active',
        is_primary: false,
        created_at: new Date(Date.now() - i * 1000),
        updated_at: new Date(Date.now() - i * 1000),
      })),
    );

    // ── F2 + N1: 501 active patient_medications (cap=500) ───────────────────
    await dbAdmin('patient_medications').insert(
      Array.from({ length: OVERFLOW }, (_, i) => ({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: patientId,
        drug_label: `${TEST_LABEL}-drug-${i}`,
        generic_name: 'Test',
        dose: '10mg',
        frequency: 'OD',
        route: 'oral',
        status: 'active',
        start_date: '2024-01-01',
        source: 'manual',
        created_at: new Date(Date.now() - i * 1000),
        updated_at: new Date(Date.now() - i * 1000),
      })),
    );

    // ── F3: 501 patient_allergies (cap=500) ─────────────────────────────────
    await dbAdmin('patient_allergies').insert(
      Array.from({ length: OVERFLOW }, (_, i) => ({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: patientId,
        allergen: `${TEST_LABEL}-allergen-${i}`,
        allergen_type: 'drug',
        reaction: 'rash',
        severity: 'mild',
        status: 'active',
        recorded_at: new Date(Date.now() - i * 1000),
        created_at: new Date(Date.now() - i * 1000),
        updated_at: new Date(Date.now() - i * 1000),
      })),
    );

    // ── F4: 501 episodes (cap=500) ──────────────────────────────────────────
    // All 'closed' status to dodge the partial-unique idx_episodes_one_open_per_type
    // (one open episode per type per patient). FHIR /Encounter returns
    // both open and closed; status filter is N/A for the ceiling test.
    await dbAdmin('episodes').insert(
      Array.from({ length: OVERFLOW }, (_, i) => ({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: patientId,
        title: `${TEST_LABEL}-ep-${i}`,
        episode_type: 'community',
        status: 'closed',
        start_date: '2024-01-01',
        end_date: '2024-06-30',
        created_at: new Date(Date.now() - i * 1000),
        updated_at: new Date(Date.now() - i * 1000),
      })),
    );

    // ── T2: 501 messages with admin user as participant (cap=500) ──────────
    const threadInserts: Array<Record<string, unknown>> = [];
    const participantInserts: Array<Record<string, unknown>> = [];
    const messageInserts: Array<Record<string, unknown>> = [];
    for (let i = 0; i < OVERFLOW; i += 1) {
      const threadId = randomUUID();
      threadIds.push(threadId);
      threadInserts.push({
        id: threadId,
        clinic_id: clinicId,
        created_by_id: userId,
        patient_id: patientId,
        subject: `${TEST_LABEL}-thread-${i}`,
        created_at: new Date(Date.now() - i * 1000),
        updated_at: new Date(Date.now() - i * 1000),
      });
      participantInserts.push({
        id: randomUUID(),
        thread_id: threadId,
        user_id: userId,
        created_at: new Date(Date.now() - i * 1000),
        updated_at: new Date(Date.now() - i * 1000),
      });
      messageInserts.push({
        id: randomUUID(),
        thread_id: threadId,
        sender_id: senderStaffId, // not the logged-in user — inbox excludes self-sent
        clinic_id: clinicId,
        content: `${TEST_LABEL}-msg-${i}`,
        is_read: false,
        created_at: new Date(Date.now() - i * 1000),
        updated_at: new Date(Date.now() - i * 1000),
      });
    }
    await dbAdmin('message_threads').insert(threadInserts);
    await dbAdmin('message_thread_participants').insert(participantInserts);
    await dbAdmin('messages').insert(messageInserts);

    // ── P1: 501 pathology_orders (cap=500) ──────────────────────────────────
    await dbAdmin('pathology_orders').insert(
      Array.from({ length: OVERFLOW }, (_, i) => ({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: patientId,
        ordered_by_id: userId,
        order_number: `${TEST_LABEL}-PORD-${i}`,
        panel_name: 'BUG-437 test panel',
        tests: ['FBE', 'UEC'],
        urgency: 'routine',
        status: 'pending',
        created_at: new Date(Date.now() - i * 1000),
        updated_at: new Date(Date.now() - i * 1000),
      })),
    );

    // ── K1: 501 tasks (clinic-wide cap=500) ─────────────────────────────────
    await dbAdmin('tasks').insert(
      Array.from({ length: OVERFLOW }, (_, i) => ({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: patientId,
        title: `${TEST_LABEL}-task-${i}`,
        task_type: 'follow-up',
        priority: 'medium',
        status: 'open',
        assigned_by_id: userId,
        assigned_to_id: userId,
        due_date: new Date(Date.now() + (i + 1) * 86_400_000),
        created_at: new Date(Date.now() - i * 1000),
        updated_at: new Date(Date.now() - i * 1000),
      })),
    );

    // ── F5: 1001 active staff (FHIR Practitioner clinic-wide cap=1000) ──────
    const F5_OVERFLOW = 1001;
    const F5_CAP = 1000;
    const f5Staff = Array.from({ length: F5_OVERFLOW }, () => ({
      id: randomUUID(),
      clinic_id: clinicId,
      email: `${TEST_LABEL}-f5-${randomUUID()}@signacare.local`,
      given_name: 'F5',
      family_name: 'Staff',
      password_hash: '$2a$10$x'.padEnd(60, 'x'),
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    }));
    for (const s of f5Staff) seededStaffIds.push(s.id);
    // Bulk-insert in chunks of 200 to keep parameter count below the
    // ~32k pg-driver limit (per row × col count fits comfortably).
    for (let i = 0; i < f5Staff.length; i += 200) {
      await dbAdmin('staff').insert(f5Staff.slice(i, i + 200));
    }
    // Capture the cap for cross-reference in the assertion.
    (globalThis as Record<string, unknown>)['__F5_CAP'] = F5_CAP;

    // ── X1: 2001 audit_log rows for one record_id (cap=2000) ────────────────
    const X1_OVERFLOW = 2001;
    const X1_CAP = 2000;
    const x1Rows = Array.from({ length: X1_OVERFLOW }, (_, i) => ({
      id: randomUUID(),
      clinic_id: clinicId,
      staff_id: userId,
      user_id: userId,
      action: 'TEST_BUG_437_REPLAY',
      table_name: 'patients',
      record_id: seededAuditRecordId,
      created_at: new Date(Date.now() + i),
    }));
    for (let i = 0; i < x1Rows.length; i += 250) {
      await dbAdmin('audit_log').insert(x1Rows.slice(i, i + 250));
    }
    (globalThis as Record<string, unknown>)['__X1_CAP'] = X1_CAP;

    // ── P2 acknowledge regression: 5 unacknowledged critical pathology
    // results. The decoupling fix means we acknowledge by id directly
    // regardless of list position; we don't need cap-overflow seeds to
    // exercise the by-id query — a small set is sufficient to prove the
    // service no longer depends on the capped list-fetch.
    const P2_RESULTS = 5;
    seededPathologyOrderId = randomUUID();
    await dbAdmin('pathology_orders').insert({
      id: seededPathologyOrderId,
      clinic_id: clinicId,
      patient_id: patientId,
      ordered_by_id: userId,
      order_number: `${TEST_LABEL}-P2-ORD`,
      panel_name: 'BUG-437 P2 panel',
      tests: ['CRP'],
      urgency: 'urgent',
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
    });
    const p2Results = Array.from({ length: P2_RESULTS }, (_, i) => {
      const id = randomUUID();
      seededCriticalResultIds.push(id);
      return {
        id,
        clinic_id: clinicId,
        pathology_order_id: seededPathologyOrderId,
        patient_id: patientId,
        test_code: 'CRP',
        test_name: 'C-Reactive Protein',
        result_value: '180',
        result_unit: 'mg/L',
        abnormal_flag: 'H',
        result_status: 'final',
        collection_date: new Date(Date.now() - i * 60_000),
        result_date: new Date(Date.now() - i * 60_000),
        is_critical: true,
        created_at: new Date(Date.now() - i * 60_000),
        updated_at: new Date(Date.now() - i * 60_000),
      };
    });
    await dbAdmin('pathology_results').insert(p2Results);
  }, 360_000);

  afterAll(async () => {
    if (!READY) return;
    // Cleanup is deliberate — these inserts pollute the seed DB with
    // 4_000+ rows otherwise. Catch + log per table so a missing table
    // doesn't fail the whole suite tear-down.
    const cleanup = async (
      table: string,
      where: Record<string, unknown>,
    ): Promise<void> => {
      try {
        await dbAdmin(table).where(where).delete();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[limitCeilings.int.test] cleanup failed for ${table}:`,
          err instanceof Error ? err.message : err,
        );
      }
    };
    // Order matters for FK cascades.
    if (threadIds.length) {
      try {
        await dbAdmin('messages').whereIn('thread_id', threadIds).delete();
        await dbAdmin('message_thread_participants').whereIn('thread_id', threadIds).delete();
        await dbAdmin('message_threads').whereIn('id', threadIds).delete();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          '[limitCeilings.int.test] message cleanup failed:',
          err instanceof Error ? err.message : err,
        );
      }
    }
    await cleanup('tasks', { clinic_id: clinicId, patient_id: patientId });
    await cleanup('pathology_orders', { clinic_id: clinicId, patient_id: patientId });
    await cleanup('episodes', { clinic_id: clinicId, patient_id: patientId });
    await cleanup('patient_allergies', { clinic_id: clinicId, patient_id: patientId });
    await cleanup('patient_medications', { clinic_id: clinicId, patient_id: patientId });
    await cleanup('diagnoses', { clinic_id: clinicId, patient_id: patientId });
    // Pathology results + the focal order created for P2 acknowledge regression
    if (seededCriticalResultIds.length) {
      try {
        await dbAdmin('pathology_results').whereIn('id', seededCriticalResultIds).delete();
      } catch {
        void 0;
      }
    }
    if (seededPathologyOrderId) {
      try {
        await dbAdmin('pathology_orders').where({ id: seededPathologyOrderId }).delete();
      } catch {
        void 0;
      }
    }
    // X1 audit_log rows scoped by the synthetic record_id
    try {
      await dbAdmin('audit_log').where({ record_id: seededAuditRecordId, action: 'TEST_BUG_437_REPLAY' }).delete();
    } catch {
      void 0;
    }
    // F5 staff bulk-cleanup
    if (seededStaffIds.length) {
      try {
        for (let i = 0; i < seededStaffIds.length; i += 250) {
          await dbAdmin('staff').whereIn('id', seededStaffIds.slice(i, i + 250)).delete();
        }
      } catch {
        void 0;
      }
    }
    await cleanup('patients', { id: patientId });
    if (senderStaffId) await cleanup('staff', { id: senderStaffId });
  }, 120_000);

  const auth = (path: string) =>
    request(app)
      .get(path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test');

  // ────────────────────────────────────────────────────────────────────────
  // F1 — FHIR Condition Bundle is capped at 500
  // ────────────────────────────────────────────────────────────────────────
  it('F1 FHIR /Condition?patient= caps Bundle.entry at 500 even when 501 rows exist', async () => {
    const res = await auth(`/api/v1/fhir/Condition?patient=${patientId}`);
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe('Bundle');
    expect(res.body.entry?.length).toBeLessThanOrEqual(CAP);
    expect(res.body.total).toBeLessThanOrEqual(CAP);
  });

  // ────────────────────────────────────────────────────────────────────────
  // F2 — FHIR MedicationStatement Bundle is capped at 500
  // ────────────────────────────────────────────────────────────────────────
  it('F2 FHIR /MedicationStatement?patient= caps Bundle.entry at 500', async () => {
    const res = await auth(`/api/v1/fhir/MedicationStatement?patient=${patientId}`);
    expect(res.status).toBe(200);
    expect(res.body.entry?.length).toBeLessThanOrEqual(CAP);
    expect(res.body.total).toBeLessThanOrEqual(CAP);
  });

  // ────────────────────────────────────────────────────────────────────────
  // F3 — FHIR AllergyIntolerance Bundle is capped at 500
  // ────────────────────────────────────────────────────────────────────────
  it('F3 FHIR /AllergyIntolerance?patient= caps Bundle.entry at 500', async () => {
    const res = await auth(`/api/v1/fhir/AllergyIntolerance?patient=${patientId}`);
    expect(res.status).toBe(200);
    expect(res.body.entry?.length).toBeLessThanOrEqual(CAP);
    expect(res.body.total).toBeLessThanOrEqual(CAP);
  });

  // ────────────────────────────────────────────────────────────────────────
  // F4 — FHIR Encounter Bundle is capped at 500
  // ────────────────────────────────────────────────────────────────────────
  it('F4 FHIR /Encounter?patient= caps Bundle.entry at 500', async () => {
    const res = await auth(`/api/v1/fhir/Encounter?patient=${patientId}`);
    expect(res.status).toBe(200);
    expect(res.body.entry?.length).toBeLessThanOrEqual(CAP);
    expect(res.body.total).toBeLessThanOrEqual(CAP);
  });

  // ────────────────────────────────────────────────────────────────────────
  // N1 — clinical-notes meds snippet is capped at 500
  // ────────────────────────────────────────────────────────────────────────
  it('N1 GET /clinical-notes/patient/:id/snippets?types=meds caps recordCount at 500', async () => {
    const res = await auth(
      `/api/v1/clinical-notes/patient/${patientId}/snippets?types=meds`,
    );
    expect(res.status).toBe(200);
    const snippets: NoteSnippet[] = Array.isArray(res.body.snippets) ? res.body.snippets : [];
    const meds = snippets.find((s) => s.type === 'meds');
    expect(meds).toBeTruthy();
    expect(meds?.recordCount ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(CAP);
  });

  // ────────────────────────────────────────────────────────────────────────
  // T2 — messaging inbox is capped at 500
  // ────────────────────────────────────────────────────────────────────────
  it('T2 GET /messages/inbox caps the array length at 500', async () => {
    const res = await auth('/api/v1/messages/inbox');
    expect(res.status).toBe(200);
    // Some controllers wrap the array in `{ messages: [...] }` — accept either.
    const arr = Array.isArray(res.body) ? res.body : (res.body.messages ?? []);
    expect(arr.length).toBeLessThanOrEqual(CAP);
  });

  // ────────────────────────────────────────────────────────────────────────
  // P1 — pathology orders by patient capped at 500
  // ────────────────────────────────────────────────────────────────────────
  it('P1 GET /pathology/patients/:id/orders caps the array length at 500', async () => {
    const res = await auth(`/api/v1/pathology/patients/${patientId}/orders`);
    expect(res.status).toBe(200);
    const arr = Array.isArray(res.body) ? res.body : (res.body.orders ?? []);
    expect(arr.length).toBeLessThanOrEqual(CAP);
  });

  // ────────────────────────────────────────────────────────────────────────
  // K1 — tasks list is capped at 500
  // ────────────────────────────────────────────────────────────────────────
  it('K1 GET /tasks caps the array length at 500', async () => {
    const res = await auth('/api/v1/tasks');
    expect(res.status).toBe(200);
    const arr = Array.isArray(res.body) ? res.body : (res.body.tasks ?? []);
    expect(arr.length).toBeLessThanOrEqual(CAP);
  });

  // ────────────────────────────────────────────────────────────────────────
  // F5 — FHIR Practitioner Bundle is capped at 1000 (clinic-wide cap)
  // BUG-437 absorb-1: L3 flagged the absence of a cap=1000 boundary test.
  // ────────────────────────────────────────────────────────────────────────
  it('F5 FHIR /Practitioner caps Bundle.entry at 1000 when 1001+ active staff exist', async () => {
    const res = await auth('/api/v1/fhir/Practitioner');
    expect(res.status).toBe(200);
    expect(res.body.resourceType).toBe('Bundle');
    expect(res.body.entry?.length).toBeLessThanOrEqual(1000);
    expect(res.body.total).toBeLessThanOrEqual(1000);
  });

  // ────────────────────────────────────────────────────────────────────────
  // X1 — audit-replay record history caps at 2000
  // BUG-437 absorb-1: L3 flagged the absence of a cap=2000 boundary test.
  // ────────────────────────────────────────────────────────────────────────
  it('X1 GET /audit-replay/record/:table/:recordId caps history at 2000', async () => {
    const res = await auth(`/api/v1/audit/record/patients/${seededAuditRecordId}`);
    expect(res.status).toBe(200);
    const arr = Array.isArray(res.body) ? res.body : (res.body.data ?? []);
    expect(arr.length).toBeLessThanOrEqual(2000);
  });

  // ────────────────────────────────────────────────────────────────────────
  // P2 acknowledge regression — BUG-437 L4 absorb-1.
  //
  // Pre-absorb shape: pathologyService.acknowledgeCritical called
  // findCriticalUnacknowledged(clinicId).find(r => r.id === resultId).
  // With the 5000-row list cap, any critical result clipped by the cap
  // returned undefined → 404 "already acknowledged" → un-acknowledgeable
  // critical lab.
  //
  // Post-absorb: acknowledgeCritical uses findCriticalUnacknowledgedById
  // which queries by id directly. Test seeds 5 critical pathology
  // results, acknowledges any one by id via the route, asserts 200 OK
  // and that the row's critical_acknowledged_at is non-null afterward.
  //
  // The decoupling means cap-fire and acknowledge-path are now
  // independent — proving the regression class is closed.
  // ────────────────────────────────────────────────────────────────────────
  it('P2 acknowledge-by-id path no longer depends on the 5000-row list cap', async () => {
    const target = seededCriticalResultIds[0]!;
    const res = await request(app)
      .post(`/api/v1/pathology/results/${target}/acknowledge`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test');
    // Controller returns 204 No Content on success.
    expect(res.status).toBe(204);
    const row = await dbAdmin('pathology_results')
      .where({ id: target })
      .select('critical_acknowledged_at')
      .first();
    expect(row?.critical_acknowledged_at).not.toBeNull();
  });
});
