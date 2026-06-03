import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STAFF_DEACTIVATION_PENDING_NOTES_BYPASS_FLAG } from '@signacare/shared';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { _resetFeatureFlagCache } from '../../src/shared/featureFlags';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-428-${Date.now()}`;

let session: { token: string; clinicId: string; userId: string };
let passwordHash = '';
const createdStaffIds: string[] = [];
const createdPatientIds: string[] = [];
const createdEpisodeIds: string[] = [];
const createdNoteIds: string[] = [];
const createdConsentIds: string[] = [];

type SeededStaff = {
  id: string;
  email: string;
};

type SeededDraftNote = {
  noteId: string;
  patientId: string;
  episodeId: string;
};

async function upsertBypassFlag(enabled: boolean): Promise<void> {
  const existing = await dbAdmin('feature_flags')
    .where({ clinic_id: session.clinicId, name: STAFF_DEACTIVATION_PENDING_NOTES_BYPASS_FLAG })
    .first('id');

  if (existing) {
    await dbAdmin('feature_flags')
      .where({ id: existing.id })
      .update({ enabled, rollout_percentage: enabled ? 100 : 0 });
  } else {
    await dbAdmin('feature_flags').insert({
      id: randomUUID(),
      clinic_id: session.clinicId,
      name: STAFF_DEACTIVATION_PENDING_NOTES_BYPASS_FLAG,
      enabled,
      rollout_percentage: enabled ? 100 : 0,
    });
  }
  _resetFeatureFlagCache();
}

async function seedStaff(suffix: string): Promise<SeededStaff> {
  const id = randomUUID();
  const email = `${TEST_TAG.toLowerCase()}-${suffix}-${id.slice(0, 8)}@example.local`;
  createdStaffIds.push(id);

  await dbAdmin('staff').insert({
    id,
    clinic_id: session.clinicId,
    given_name: 'Bug428',
    family_name: suffix,
    email,
    password_hash: passwordHash,
    role: 'clinician',
    mfa_enabled: false,
    is_active: true,
    must_change_password: false,
    failed_login_attempts: 0,
    created_at: new Date(),
    updated_at: new Date(),
  });

  return { id, email };
}

async function seedPendingDraftNote(authorStaffId: string, suffix: string): Promise<SeededDraftNote> {
  const patientId = randomUUID();
  const episodeId = randomUUID();
  const noteId = randomUUID();
  const consentId = randomUUID();
  createdPatientIds.push(patientId);
  createdEpisodeIds.push(episodeId);
  createdNoteIds.push(noteId);
  createdConsentIds.push(consentId);

  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: session.clinicId,
    given_name: 'Bug428',
    family_name: `${TEST_TAG}-${suffix}`,
    emr_number: `${TEST_TAG}-${suffix}`,
    date_of_birth: '1993-04-05',
    created_at: new Date(),
    updated_at: new Date(),
  });

  await dbAdmin('episodes').insert({
    id: episodeId,
    clinic_id: session.clinicId,
    patient_id: patientId,
    episode_type: 'triage',
    presenting_problem: `${TEST_TAG}-${suffix}`,
    status: 'open',
    start_date: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  });

  await dbAdmin('scribe_consents').insert({
    id: consentId,
    clinic_id: session.clinicId,
    patient_id: patientId,
    mode: 'clinician_attestation',
    clinician_attested_by_id: session.userId,
    clinician_attestation_text: `${TEST_TAG} consent`,
    attested_at: new Date(),
    created_at: new Date(),
  });

  await dbAdmin('clinical_notes').insert({
    id: noteId,
    clinic_id: session.clinicId,
    patient_id: patientId,
    consent_id: consentId,
    episode_id: episodeId,
    author_id: authorStaffId,
    note_type: 'progress',
    status: 'draft',
    is_draft: true,
    is_signed: false,
    note_date_time: new Date(),
    note_date: new Date().toISOString().slice(0, 10),
    content: `${TEST_TAG} unsigned draft`,
    is_reportable_contact: true,
    foi_exempt: false,
    did_not_attend: false,
    is_ai_draft: false,
    lock_version: 1,
    created_at: new Date(),
    updated_at: new Date(),
  });

  return { noteId, patientId, episodeId };
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();
  passwordHash = await bcrypt.hash(`Str0ng!${TEST_TAG}`, 10);
  await upsertBypassFlag(false);
});

afterAll(async () => {
  if (!READY) return;
  if (createdNoteIds.length > 0) {
    await dbAdmin('clinical_notes').whereIn('id', createdNoteIds).del().catch(() => undefined);
  }
  if (createdConsentIds.length > 0) {
    await dbAdmin('scribe_consents').whereIn('id', createdConsentIds).del().catch(() => undefined);
  }
  if (createdEpisodeIds.length > 0) {
    await dbAdmin('episodes').whereIn('id', createdEpisodeIds).del().catch(() => undefined);
  }
  if (createdPatientIds.length > 0) {
    await dbAdmin('patients').whereIn('id', createdPatientIds).del().catch(() => undefined);
  }
  if (createdStaffIds.length > 0) {
    await dbAdmin('staff').whereIn('id', createdStaffIds).del().catch(() => undefined);
  }
  await upsertBypassFlag(false);
});

describe.skipIf(!READY)('BUG-428 — staff deactivation pending-unsigned-notes gate', () => {
  it('blocks deactivation when authored draft notes are still unsigned', async () => {
    const staff = await seedStaff('blocked');
    await seedPendingDraftNote(staff.id, 'blocked');

    const res = await request(app)
      .put(`/api/v1/staff/${staff.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({ isActive: false });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STAFF_DEACTIVATION_BLOCKED_PENDING_UNSIGNED_NOTES');
    expect(res.body.details?.pendingUnsignedNotesCount).toBe(1);
    expect(Array.isArray(res.body.details?.pendingUnsignedNotesSample)).toBe(true);
  });

  it('allows deactivation when no pending unsigned notes exist', async () => {
    const staff = await seedStaff('allowed');

    const res = await request(app)
      .put(`/api/v1/staff/${staff.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });

  it('allows deactivation when bypass flag is explicitly enabled', async () => {
    await upsertBypassFlag(true);
    const staff = await seedStaff('bypass');
    await seedPendingDraftNote(staff.id, 'bypass');

    const res = await request(app)
      .put(`/api/v1/staff/${staff.id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    await upsertBypassFlag(false);
  });
});
