/**
 * BUG-403-FOLLOWUP-CONFIG-WRITE-AUDIT + BUG-NEW-ESCALATION-AUDIT-
 * FOLLOWUP-LIFECYCLE-PARITY regression tests (2026-05-03).
 *
 * Covers 3 NEW audit emissions:
 *   - THRESHOLD_UPDATE      (clinic_thresholds writes via setThreshold)
 *   - ESCALATION_UPDATE     (admin metadata changes — assignedTeam / priority)
 *   - ESCALATION_ACKNOWLEDGE (first-touch transition)
 *
 * Sibling test pattern of escalationAudit.int.test.ts and
 * legalOrderAndClinicSettingsAudit.int.test.ts.
 *
 * audit_log queries filter on LOWERCASE `action` per audit.ts:347
 * persistence (column lowercased; v2 `operation` column carries
 * uppercase per :340). audit_log rows are NOT cleaned up (BUG-039
 * `audit_log_prevent_mutation()` trigger blocks all DELETE).
 *
 * fix-registry anchors pinned by this file:
 *   - R-FIX-BUG-403-FU-CONFIG-AUDIT-EMITS-ON-WRITE
 *   - R-FIX-BUG-NEW-ESC-FU-LIFECYCLE-UPDATE-AUDIT
 *   - R-FIX-BUG-NEW-ESC-FU-LIFECYCLE-ACKNOWLEDGE-AUDIT
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import app from '../../src/server';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-403-FU + BUG-NEW-ESC-FU — config-write + escalation-lifecycle audit', () => {
  let session: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const runId = randomUUID().slice(0, 8);
  const tag = `bug-fu-${runId}`;
  const patientId = randomUUID();
  const episodeId = randomUUID();
  const createdEscalationIds: string[] = [];

  // Capture pre-test threshold rows (if any) for restoration in afterAll
  const touchedThresholdKeys = ['therapeutic_level_warfarin_days'];
  const originalThresholds: Record<string, number> = {};

  beforeAll(async () => {
    if (!ready) return;
    session = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));

    for (const key of touchedThresholdKeys) {
      const row = await dbAdmin('clinic_thresholds')
        .where({ clinic_id: session.clinicId, threshold_key: key })
        .first('threshold_value');
      if (row) originalThresholds[key] = Number(row.threshold_value);
    }

    // Synthetic patient + episode for escalation tests
    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      emr_number: `${tag}-${runId.slice(0, 4)}`,
      given_name: 'Patient',
      family_name: tag,
      date_of_birth: '1990-01-01',
    });
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

    // Restore thresholds
    for (const key of touchedThresholdKeys) {
      if (key in originalThresholds) {
        await dbAdmin('clinic_thresholds')
          .where({ clinic_id: session.clinicId, threshold_key: key })
          .update({ threshold_value: originalThresholds[key], updated_at: new Date() });
      } else {
        await dbAdmin('clinic_thresholds')
          .where({ clinic_id: session.clinicId, threshold_key: key })
          .del();
      }
    }
    if (createdEscalationIds.length > 0) {
      await dbAdmin('escalations').whereIn('id', createdEscalationIds).del();
    }
    await dbAdmin('episodes').where({ id: episodeId }).del();
    await dbAdmin('patients').where({ id: patientId }).del();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BUG-403-FOLLOWUP-CONFIG-WRITE-AUDIT
  // ──────────────────────────────────────────────────────────────────────────
  describe('PUT /settings/thresholds → THRESHOLD_UPDATE audit', () => {
    it('TP-CFG-AUDIT-403FU-1: setting a threshold writes a THRESHOLD_UPDATE audit_log row with structural pre-image + post-image', async () => {
      const key = 'therapeutic_level_warfarin_days';
      const newValue = 21;  // Default is 14
      const res = await request(app)
        .put('/api/v1/settings/thresholds')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({ key, value: newValue });
      expect(res.status).toBe(200);

      const audit = await dbAdmin('audit_log')
        .where({
          clinic_id: session.clinicId,
          action: 'threshold_update',
        })
        .orderBy('created_at', 'desc')
        .first('action', 'operation', 'old_data', 'new_data', 'staff_id');
      expect(audit).toBeTruthy();
      expect(audit.action).toBe('threshold_update');
      expect(audit.operation).toBe('THRESHOLD_UPDATE');
      expect(audit.staff_id).toBe(session.userId);

      const newData =
        typeof audit.new_data === 'string' ? JSON.parse(audit.new_data) : audit.new_data;
      expect(newData.threshold_key).toBe(key);
      expect(newData.threshold_value).toBe(newValue);
    });

    it('TP-CFG-AUDIT-403FU-2: bulk threshold update emits one audit row per key', async () => {
      // Capture audit row count before
      const before = await dbAdmin('audit_log')
        .where({ clinic_id: session.clinicId, action: 'threshold_update' })
        .count('* as c')
        .first();
      const beforeCount = Number(before.c);

      const res = await request(app)
        .put('/api/v1/settings/thresholds/bulk')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({
          thresholds: {
            therapeutic_level_warfarin_days: 28,  // safe key, not paired
          },
        });
      expect(res.status).toBe(200);

      const after = await dbAdmin('audit_log')
        .where({ clinic_id: session.clinicId, action: 'threshold_update' })
        .count('* as c')
        .first();
      const afterCount = Number(after.c);
      expect(afterCount).toBeGreaterThanOrEqual(beforeCount + 1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BUG-NEW-ESCALATION-AUDIT-FOLLOWUP-LIFECYCLE-PARITY
  // ──────────────────────────────────────────────────────────────────────────
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

  describe('PATCH /escalations/:id → ESCALATION_UPDATE audit', () => {
    it('TP-ESC-AUDIT-FU-UPDATE-1: update writes ESCALATION_UPDATE audit_log row with structural pre-image (assignedTeam, priority) + post-image (assignedTeam, priority, lockVersion+1)', async () => {
      const { id, lockVersion } = await createEscalation();
      const res = await request(app)
        .patch(`/api/v1/escalations/${id}`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({
          expectedLockVersion: lockVersion,
          assignedTeam: 'Crisis Team',
          priority: 'emergency',
        });
      expect(res.status).toBe(200);

      const audit = await dbAdmin('audit_log')
        .where({
          clinic_id: session.clinicId,
          record_id: id,
          action: 'escalation_update',
        })
        .first('action', 'operation', 'old_data', 'new_data');
      expect(audit).toBeTruthy();
      expect(audit.action).toBe('escalation_update');
      expect(audit.operation).toBe('ESCALATION_UPDATE');

      const oldData =
        typeof audit.old_data === 'string' ? JSON.parse(audit.old_data) : audit.old_data;
      const newData =
        typeof audit.new_data === 'string' ? JSON.parse(audit.new_data) : audit.new_data;
      expect(oldData.assignedTeam).toBe('Triage Team');
      expect(oldData.priority).toBe('urgent');
      expect(newData.assignedTeam).toBe('Crisis Team');
      expect(newData.priority).toBe('emergency');
      expect(newData.lockVersion).toBeGreaterThan(oldData.lockVersion);
    });

    it('TP-ESC-AUDIT-FU-UPDATE-PHI: update audit row MUST NOT contain `notes` (clinician free-text PHI) — L4 advisory absorb: structural key-absence + substring-absence', async () => {
      const { id, lockVersion } = await createEscalation();
      const phiNote = 'PHI clinical note — sensitive detail [redacted]';
      await request(app)
        .patch(`/api/v1/escalations/${id}`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({
          expectedLockVersion: lockVersion,
          assignedTeam: 'Crisis Team',
          notes: phiNote,
        });

      const audit = await dbAdmin('audit_log')
        .where({
          clinic_id: session.clinicId,
          record_id: id,
          action: 'escalation_update',
        })
        .first('old_data', 'new_data');
      expect(audit).toBeTruthy();
      const oldDataStr =
        typeof audit.old_data === 'string' ? audit.old_data : JSON.stringify(audit.old_data ?? {});
      const newDataStr =
        typeof audit.new_data === 'string' ? audit.new_data : JSON.stringify(audit.new_data ?? {});
      // L4 cycle-2 absorb: assert structural key-absence in addition to
      // substring-absence. Substring search alone has a false-negative
      // risk if a clinician writes a note that shares a substring with
      // an admin metadata value (e.g. "Crisis Team" appearing inside notes).
      const oldData =
        typeof audit.old_data === 'string' ? JSON.parse(audit.old_data) : audit.old_data;
      const newData =
        typeof audit.new_data === 'string' ? JSON.parse(audit.new_data) : audit.new_data;
      expect('notes' in (oldData ?? {})).toBe(false);
      expect('notes' in (newData ?? {})).toBe(false);
      expect(oldDataStr.includes(phiNote)).toBe(false);
      expect(newDataStr.includes(phiNote)).toBe(false);
    });
  });

  describe('POST /escalations/:id/acknowledge → ESCALATION_ACKNOWLEDGE audit', () => {
    it('TP-ESC-AUDIT-FU-ACK-1: acknowledge writes ESCALATION_ACKNOWLEDGE audit_log row with status transition open → in_progress', async () => {
      const { id } = await createEscalation();
      const res = await request(app)
        .post(`/api/v1/escalations/${id}/acknowledge`)
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-CSRF-Token', 'test')
        .send({});
      expect(res.status).toBe(200);

      const audit = await dbAdmin('audit_log')
        .where({
          clinic_id: session.clinicId,
          record_id: id,
          action: 'escalation_acknowledge',
        })
        .first('action', 'operation', 'old_data', 'new_data');
      expect(audit).toBeTruthy();
      expect(audit.action).toBe('escalation_acknowledge');
      expect(audit.operation).toBe('ESCALATION_ACKNOWLEDGE');

      const oldData =
        typeof audit.old_data === 'string' ? JSON.parse(audit.old_data) : audit.old_data;
      const newData =
        typeof audit.new_data === 'string' ? JSON.parse(audit.new_data) : audit.new_data;
      expect(oldData.status).toBe('open');
      expect(oldData.acknowledgedAt).toBeNull();
      expect(newData.status).toBe('in_progress');
      expect(newData.acknowledgedAt).toBeTruthy();
      expect(newData.acknowledgedById).toBe(session.userId);
    });
  });
});
