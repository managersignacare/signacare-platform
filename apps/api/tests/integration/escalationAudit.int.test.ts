/**
 * BUG-NEW-ESCALATION-AUDIT regression tests (2026-05-03).
 *
 * Sibling pattern of BUG-400d (legalOrderAndClinicSettingsAudit). Two
 * sites covered:
 *
 *   - POST /api/v1/escalations/:id/resolve → ESCALATION_RESOLVE
 *   - POST /api/v1/escalations/:id/notes   → ESCALATION_NOTE_ADDED
 *
 * PHI redaction is the primary failure mode being pinned: both methods
 * accept a `notes` parameter (clinician free-text PHI). audit_log is
 * immutable per BUG-039 — PHI written there cannot be redacted under
 * Privacy Act APP 13.1 / OAIC suppression / HPP 4 retention. The
 * service-layer redacts by NOT including `notes` in oldData/newData; the
 * note CONTENT is preserved in the mutable `escalation_events.notes`
 * column (which CAN be redacted).
 *
 * audit_log queries filter on LOWERCASE `action` per audit.ts:347
 * persistence (column is lowercased; v2 `operation` column carries
 * uppercase per :340). audit_log rows are NOT cleaned up (BUG-039
 * `audit_log_prevent_mutation()` trigger blocks all DELETE) — test
 * rows accumulate harmlessly with fresh per-run UUIDs.
 *
 * fix-registry anchors pinned by this file: R-FIX-BUG-NEW-ESCALATION-
 * RESOLVE-AUDIT + R-FIX-BUG-NEW-ESCALATION-NOTE-AUDIT + R-FIX-BUG-NEW-
 * ESCALATION-NO-PHI-IN-AUDIT.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import app from '../../src/server';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-NEW-ESCALATION-AUDIT — escalation forensic-trail audit_log', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const runId = randomUUID().slice(0, 8);
  const tag = `bug-esc-audit-${runId}`;
  const patientId = randomUUID();
  const episodeId = randomUUID();

  // Track escalation ids so afterAll can clean up the synthetic rows
  // (audit_log rows are immutable per BUG-039 and accumulate harmlessly).
  const createdEscalationIds: string[] = [];

  beforeAll(async () => {
    if (!ready) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));

    // Synthetic patient bound to the seeded test clinic.
    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      emr_number: `${tag}-${runId.slice(0, 4)}`,
      given_name: 'Patient',
      family_name: tag,
      date_of_birth: '1990-01-01',
    });

    // Synthetic episode so requirePatientRelationship resolves OK.
    await dbAdmin('episodes').insert({
      id: episodeId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      episode_type: 'community',
      status: 'open',
      start_date: new Date().toISOString().slice(0, 10),
      title: `${tag} episode`,
      primary_clinician_id: session.userId,
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  afterAll(async () => {
    if (!ready || !session) return;

    // FK-safe cleanup. escalation_events references escalations(id) with
    // ON DELETE CASCADE, so a single delete on escalations cascades the
    // events. audit_log rows are append-only (BUG-039) — not deleted.
    if (createdEscalationIds.length > 0) {
      await dbAdmin('escalations').whereIn('id', createdEscalationIds).del();
    }
    await dbAdmin('episodes').where({ id: episodeId }).del();
    await dbAdmin('patients').where({ id: patientId }).del();
  });

  /**
   * Helper: create an escalation via HTTP, return the id + initial
   * lockVersion. Uses POST /api/v1/escalations with a minimal ISBAR
   * payload. Server emits ESCALATION_CREATE-class side-effects which
   * are NOT under test here (covered by escalation.routes own tests).
   */
  async function createEscalation(): Promise<{ id: string; lockVersion: number }> {
    const res = await request(app)
      .post('/api/v1/escalations')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-CSRF-Token', 'test')
      .send({
        patientId,
        episodeId,
        assignedTeam: 'Triage Team',
        priority: 'urgent',
        isbar: {
          situation:      'Test situation',
          background:     'Test background',
          assessment:     'Test assessment',
          recommendation: 'Test recommendation',
        },
      });
    if (res.status !== 201 && res.status !== 200) {
      throw new Error(`createEscalation HTTP ${res.status}: ${JSON.stringify(res.body)}`);
    }
    const id = (res.body.id ?? res.body.escalation?.id) as string;
    const lockVersion = (res.body.lockVersion ?? res.body.escalation?.lockVersion ?? 1) as number;
    createdEscalationIds.push(id);
    return { id, lockVersion };
  }

  describe('POST /escalations/:id/resolve → ESCALATION_RESOLVE', () => {
    it('TP-ESC-AUDIT-RESOLVE-1: resolve writes ESCALATION_RESOLVE audit_log row with structural pre-image (status, lockVersion, patientId) + post-image (status=resolved, lockVersion+1, resolvedAt, resolvedById)', async () => {
      const { id, lockVersion } = await createEscalation();

      const res = await request(app)
        .post(`/api/v1/escalations/${id}/resolve`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({
          expectedLockVersion: lockVersion,
          notes: 'Resolution clinical note — structural-only audit',
        });
      expect(res.status).toBe(200);

      const audit = await dbAdmin('audit_log')
        .where({
          clinic_id: session.clinicId,
          record_id: id,
          action: 'escalation_resolve',
        })
        .first('action', 'operation', 'old_data', 'new_data');
      expect(audit).toBeTruthy();
      expect(audit.action).toBe('escalation_resolve');
      expect(audit.operation).toBe('ESCALATION_RESOLVE');

      const oldData =
        typeof audit.old_data === 'string' ? JSON.parse(audit.old_data) : audit.old_data;
      const newData =
        typeof audit.new_data === 'string' ? JSON.parse(audit.new_data) : audit.new_data;
      expect(oldData.status).toBe('open');
      expect(oldData.lockVersion).toBe(lockVersion);
      expect(oldData.patientId).toBe(patientId);
      expect(newData.status).toBe('resolved');
      expect(newData.lockVersion).toBeGreaterThan(lockVersion);
      expect(newData.resolvedAt).toBeTruthy();
      expect(newData.resolvedById).toBe(session.userId);
      expect(newData.patientId).toBe(patientId);
    });

    it('TP-ESC-AUDIT-RESOLVE-PHI: resolve audit_log row MUST NOT contain `notes` (clinician free-text PHI) — audit.ts:280+303 contract; PHI must stay out of immutable audit_log', async () => {
      const { id, lockVersion } = await createEscalation();
      const phiNote = 'PHI clinical note — patient presents with [redacted detail]';

      const res = await request(app)
        .post(`/api/v1/escalations/${id}/resolve`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({
          expectedLockVersion: lockVersion,
          notes: phiNote,
        });
      expect(res.status).toBe(200);

      const audit = await dbAdmin('audit_log')
        .where({
          clinic_id: session.clinicId,
          record_id: id,
          action: 'escalation_resolve',
        })
        .first('old_data', 'new_data');
      expect(audit).toBeTruthy();

      const oldDataStr =
        typeof audit.old_data === 'string' ? audit.old_data : JSON.stringify(audit.old_data ?? {});
      const newDataStr =
        typeof audit.new_data === 'string' ? audit.new_data : JSON.stringify(audit.new_data ?? {});

      // Structural keys MUST be absent (would indicate a regression that
      // re-introduced the notes parameter into the audit payload).
      const oldData =
        typeof audit.old_data === 'string' ? JSON.parse(audit.old_data) : audit.old_data;
      const newData =
        typeof audit.new_data === 'string' ? JSON.parse(audit.new_data) : audit.new_data;
      expect('notes' in (oldData ?? {})).toBe(false);
      expect('notes' in (newData ?? {})).toBe(false);

      // Defence in depth: the literal PHI string MUST NOT appear in the
      // serialised JSON anywhere (catches accidental nested embedding).
      expect(oldDataStr.includes(phiNote)).toBe(false);
      expect(newDataStr.includes(phiNote)).toBe(false);

      // Sanity check: the note WAS persisted to escalation_events.notes
      // (the mutable table where PHI legitimately lives).
      const ev = await dbAdmin('escalation_events')
        .where({ escalation_id: id, event_type: 'resolved' })
        .first('notes');
      expect(ev).toBeTruthy();
      expect(ev.notes).toBe(phiNote);
    });
  });

  describe('POST /escalations/:id/notes → ESCALATION_NOTE_ADDED', () => {
    it('TP-ESC-AUDIT-NOTE-1: addNote writes ESCALATION_NOTE_ADDED audit_log row with eventCount delta + structural status', async () => {
      const { id } = await createEscalation();

      const res = await request(app)
        .post(`/api/v1/escalations/${id}/notes`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({
          expectedLockVersion: 1,
          notes: 'Annotation clinical note — structural-only audit',
        });
      expect(res.status).toBe(200);

      const audit = await dbAdmin('audit_log')
        .where({
          clinic_id: session.clinicId,
          record_id: id,
          action: 'escalation_note_added',
        })
        .first('action', 'operation', 'old_data', 'new_data');
      expect(audit).toBeTruthy();
      expect(audit.action).toBe('escalation_note_added');
      expect(audit.operation).toBe('ESCALATION_NOTE_ADDED');

      const oldData =
        typeof audit.old_data === 'string' ? JSON.parse(audit.old_data) : audit.old_data;
      const newData =
        typeof audit.new_data === 'string' ? JSON.parse(audit.new_data) : audit.new_data;
      expect(oldData.eventCount).toBeTypeOf('number');
      expect(newData.eventCount).toBeTypeOf('number');
      expect(newData.eventCount).toBeGreaterThan(oldData.eventCount);
      expect(newData.eventType).toBe('note_added');
      expect(newData.patientId).toBe(patientId);
    });

    it('TP-ESC-AUDIT-NOTE-PHI: addNote audit_log row MUST NOT contain `notes` (clinician free-text PHI) — audit.ts:280+303 contract', async () => {
      const { id } = await createEscalation();
      const phiNote = 'PHI annotation note — sensitive clinical detail [redacted]';

      const res = await request(app)
        .post(`/api/v1/escalations/${id}/notes`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({
          expectedLockVersion: 1,
          notes: phiNote,
        });
      expect(res.status).toBe(200);

      const audit = await dbAdmin('audit_log')
        .where({
          clinic_id: session.clinicId,
          record_id: id,
          action: 'escalation_note_added',
        })
        .first('old_data', 'new_data');
      expect(audit).toBeTruthy();

      const oldDataStr =
        typeof audit.old_data === 'string' ? audit.old_data : JSON.stringify(audit.old_data ?? {});
      const newDataStr =
        typeof audit.new_data === 'string' ? audit.new_data : JSON.stringify(audit.new_data ?? {});
      const oldData =
        typeof audit.old_data === 'string' ? JSON.parse(audit.old_data) : audit.old_data;
      const newData =
        typeof audit.new_data === 'string' ? JSON.parse(audit.new_data) : audit.new_data;
      expect('notes' in (oldData ?? {})).toBe(false);
      expect('notes' in (newData ?? {})).toBe(false);
      expect(oldDataStr.includes(phiNote)).toBe(false);
      expect(newDataStr.includes(phiNote)).toBe(false);

      // Sanity: the note WAS persisted to escalation_events.notes.
      const ev = await dbAdmin('escalation_events')
        .where({ escalation_id: id, event_type: 'note_added' })
        .orderBy('created_at', 'desc')
        .first('notes');
      expect(ev).toBeTruthy();
      expect(ev.notes).toBe(phiNote);
    });
  });
});
