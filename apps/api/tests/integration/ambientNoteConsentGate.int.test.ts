/**
 * BUG-035 regression — /ambient-note MUST verify recording consent +
 * patient relationship BEFORE persisting audio, transcribing, or saving
 * a clinical note.
 *
 * Pre-fix (verified via git stash): the handler at llmRoutes.ts:432
 * accepted audio + patientId + no consent check + no patient-relationship
 * check. blobStorage.put ran at :474 before any gate. Whisper at :485.
 * Save at :563. Silent privacy + authorization double-failure.
 *
 * Post-fix contract:
 *   1. multer parse (needed to extract text fields alongside audio)
 *   2. Zod parse → 422 on missing/invalid patientId/consentId
 *   3. buildAuthContext + requirePatientRelationship → 403 on no care relationship
 *   4. verifyRecordingConsent → 403 on missing/cross-patient/cross-tenant/stale consent
 *   5. size check → 400 on audio < 1000 bytes
 *   6. blobStorage.put (gated)
 *   7. audit_log AMBIENT_NOTE_RECORDING_STARTED bound to consent_id
 *   8. processAmbientAudio (gated)
 *
 * processAmbientAudio + blobStorage.put mocked so tests don't hit
 * Whisper/Ollama/S3. Gate ordering is real.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Knex } from 'knex';

// Hoisted mocks — blobStorage + processAmbientAudio stubs so the happy-path
// test exercises the real gate chain without calling Whisper.
const blobMock = vi.hoisted(() => ({
  put: vi.fn(),
}));
vi.mock('../../src/shared/blobStorage', () => ({
  blobStorage: {
    put: blobMock.put,
  },
}));

const ambientMock = vi.hoisted(() => ({
  processAmbientAudio: vi.fn(),
}));
vi.mock('../../src/mcp/ambientProcessor', () => ({
  processAmbientAudio: ambientMock.processAmbientAudio,
}));

import request from 'supertest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';

const READY = await isIntegrationReady();

let token = '';
let adminStaffId = '';
let clinicId = '';
let patientId = '';
let otherClinicId = '';
let otherPatientId = '';
let relationshipEpisodeId = '';
const createdConsentIds: string[] = [];
let createdPrimaryPatientId = '';

async function withClinicRls<T>(
  scopedClinicId: string,
  work: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return dbAdmin.transaction(async (trx) => {
    await trx.raw("select set_config('app.clinic_id', ?, true)", [scopedClinicId]);
    return work(trx);
  });
}

beforeAll(async () => {
  if (!READY) return;
  const session = await loginAsAdmin();
  token = session.token;
  adminStaffId = session.userId;
  clinicId = session.clinicId;

  // Use a deterministic patient + explicit relationship fixture for this
  // suite. Relationship policy evolves over time, so tests must not rely
  // on role-based bypass assumptions.
  const patient = await withClinicRls(clinicId, (trx) => (
    trx('patients')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .first('id')
  ));
  if (patient) {
    patientId = patient.id as string;
  } else {
    const seededPatientId = randomUUID();
    await withClinicRls(clinicId, async (trx) => {
      await trx('patients').insert({
        id: seededPatientId,
        clinic_id: clinicId,
        given_name: 'Bug035',
        family_name: 'Fixture',
        date_of_birth: '1991-01-01',
        gender: 'female',
        created_at: new Date(),
        updated_at: new Date(),
      } as never);
    });
    patientId = seededPatientId;
    createdPrimaryPatientId = seededPatientId;
  }

  relationshipEpisodeId = randomUUID();
  await withClinicRls(clinicId, async (trx) => {
    await trx('episodes').insert({
      id: relationshipEpisodeId,
      patient_id: patientId,
      clinic_id: clinicId,
      title: 'BUG-035 relationship fixture',
      status: 'open',
      start_date: new Date().toISOString().slice(0, 10),
      specialty_code: 'mental_health',
      primary_clinician_id: adminStaffId,
      lock_version: 0,
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  // Build a second clinic + patient for cross-tenant test.
  const otherClinic = await dbAdmin('clinics').insert({
    id: randomUUID(),
    name: 'BUG-035 cross-tenant clinic',
    hpio: `800362${String(Date.now()).slice(-10)}`,
  }).returning('id');
  otherClinicId = (otherClinic[0] as { id: string }).id;
  const otherPatient = await withClinicRls(otherClinicId, (trx) => (
    trx('patients').insert({
      id: randomUUID(),
      clinic_id: otherClinicId,
      given_name: 'Cross',
      family_name: 'Tenant',
      date_of_birth: '1990-01-01',
    }).returning('id')
  ));
  otherPatientId = (otherPatient[0] as { id: string }).id;
});

beforeEach(() => {
  blobMock.put.mockReset();
  ambientMock.processAmbientAudio.mockReset();
  // Default happy-path mocks; individual tests override when they expect
  // the gate to short-circuit before these are called.
  blobMock.put.mockResolvedValue({ key: 'audio/test/key.webm', bucket: 'local' });
  ambientMock.processAmbientAudio.mockResolvedValue({
    summary: 'Test summary',
    transcript: 'Patient reports feeling stable',
    structured: { subjective: 's', objective: 'o', assessment: 'a', plan: 'p' },
    medications: [],
    suggestedDiagnosis: [],
  });
});

afterAll(async () => {
  if (!READY) return;
  if (relationshipEpisodeId) {
    await withClinicRls(clinicId, (trx) => (
      trx('episodes').where({ id: relationshipEpisodeId }).del()
    )).catch(() => undefined);
  }
  // Clean up BUG-035-specific rows; leave seeded patient intact.
  if (createdConsentIds.length > 0) {
    await withClinicRls(clinicId, (trx) => (
      trx('clinical_notes').whereIn('consent_id', createdConsentIds).del()
    )).catch(() => undefined);
    await withClinicRls(clinicId, (trx) => (
      trx('scribe_consents').whereIn('id', createdConsentIds).del()
    )).catch(() => undefined);
  }
  // audit_log is append-only by trigger policy (BUG-039), so this suite
  // intentionally does not attempt to delete AMBIENT_NOTE_RECORDING_STARTED rows.
  if (otherClinicId) {
    await withClinicRls(otherClinicId, (trx) => (
      trx('patients').where({ clinic_id: otherClinicId }).del()
    )).catch(() => undefined);
    await dbAdmin('clinics').where({ id: otherClinicId }).del().catch(() => undefined);
  }
  if (createdPrimaryPatientId) {
    await withClinicRls(clinicId, (trx) => (
      trx('patients').where({ id: createdPrimaryPatientId }).del()
    )).catch(() => undefined);
  }
});

// Helper: insert a consent row directly (bypassing the POST route so
// tests control `attested_at` precisely).
async function seedConsent(args: {
  patientId: string;
  clinicId: string;
  attestedAt: Date;
}): Promise<string> {
  const id = randomUUID();
  await withClinicRls(args.clinicId, async (trx) => {
    await trx('scribe_consents').insert({
      id,
      clinic_id: args.clinicId,
      patient_id: args.patientId,
      mode: 'clinician_attestation',
      clinician_attested_by_id: adminStaffId,
      clinician_attestation_text: 'BUG-035 test consent',
      attested_at: args.attestedAt,
      created_at: new Date(),
    });
  });
  createdConsentIds.push(id);
  return id;
}

function postAmbientNote(fields: Record<string, string>) {
  const agent = request(app).post('/api/v1/llm/ambient-note')
    .set('Authorization', `Bearer ${token}`)
    .set('X-CSRF-Token', 'test');
  for (const [k, v] of Object.entries(fields)) agent.field(k, v);
  agent.attach('audio', Buffer.alloc(1500, 0x55), { filename: 'test.webm', contentType: 'audio/webm' });
  return agent;
}

describe.skipIf(!READY)('BUG-035 — /ambient-note consent + relationship gate', () => {
  it('(1) missing consentId → 422 VALIDATION_ERROR', async () => {
    const res = await postAmbientNote({ patientId });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(blobMock.put).not.toHaveBeenCalled();
    expect(ambientMock.processAmbientAudio).not.toHaveBeenCalled();
  });

  it('(2) missing patientId → 422 VALIDATION_ERROR', async () => {
    const res = await postAmbientNote({ consentId: randomUUID() });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(blobMock.put).not.toHaveBeenCalled();
  });

  it('(3) non-UUID consentId → 422 VALIDATION_ERROR', async () => {
    const res = await postAmbientNote({ patientId, consentId: 'not-a-uuid' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(blobMock.put).not.toHaveBeenCalled();
  });

  it('(4) consent row does NOT exist → 403 CONSENT_REQUIRED; blobStorage NOT called', async () => {
    const res = await postAmbientNote({ patientId, consentId: randomUUID() });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
    expect(blobMock.put).not.toHaveBeenCalled();
    expect(ambientMock.processAmbientAudio).not.toHaveBeenCalled();
  });

  it('(5) consent for a DIFFERENT patient → 403 CONSENT_REQUIRED (cross-patient)', async () => {
    const consentId = await seedConsent({
      patientId: otherPatientId, // consent bound to OTHER patient
      clinicId,                  // same clinic
      attestedAt: new Date(),
    });
    const res = await postAmbientNote({ patientId, consentId }); // but request is for THIS patient
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
    expect(blobMock.put).not.toHaveBeenCalled();
  });

  it('(6) consent for a DIFFERENT clinic → 403 CONSENT_REQUIRED (cross-tenant)', async () => {
    const consentId = await seedConsent({
      patientId: otherPatientId,
      clinicId: otherClinicId, // OTHER clinic
      attestedAt: new Date(),
    });
    const res = await postAmbientNote({ patientId, consentId });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
    expect(blobMock.put).not.toHaveBeenCalled();
  });

  it('(7) consent STALE (attested > TTL ago) → 403 CONSENT_EXPIRED', async () => {
    // Default TTL was raised to 60 min per L4 review; use 90 min to be
    // unambiguously stale.
    const consentId = await seedConsent({
      patientId,
      clinicId,
      attestedAt: new Date(Date.now() - 90 * 60 * 1000),
    });
    const res = await postAmbientNote({ patientId, consentId });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONSENT_EXPIRED');
    expect(blobMock.put).not.toHaveBeenCalled();
  });

  it('(7b) clinician WITHOUT care relationship to the patient → 403 FORBIDDEN via requirePatientRelationship (L3 review item 1 — genuinely exercises the bypass-exempt path)', async () => {
    // The seeded superadmin (admin@signacare.local) short-circuits
    // requirePatientRelationship via BYPASS_ROLES at authGuards.ts:17.
    // To genuinely guard the `requirePatientRelationship` line (the
    // 2-LOC absorption from Review 2 item 2), we must log in as a
    // NON-bypass user and POST against a patient that user has no
    // episode / team / appointment link to.
    //
    // `sarah.chen@signacare.local` is the seeded clinician (role =
    // 'clinician', NOT in BYPASS_ROLES). We pick a patient that has
    // zero records in (episodes | patient_team_assignments |
    // appointment_attendees) for her staff_id. If such a patient
    // doesn't exist in seed data we create a fresh orphan patient
    // scoped to her clinic but with no care-relationship to her.
    const orphanId = randomUUID();
    await withClinicRls(clinicId, async (trx) => {
      await trx('patients').insert({
        id: orphanId,
        clinic_id: clinicId,
        given_name: 'NoRel',
        family_name: 'Orphan',
        date_of_birth: '1990-01-01',
      });
    });

    // Login as sarah.chen (clinician). Inline login because helpers.ts
    // only exports loginAsAdmin.
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({ email: 'sarah.chen@signacare.local', password: 'Password1!' });
    expect(loginRes.status).toBe(200);
    const clinicianToken = loginRes.body.accessToken as string;

    // Seed a valid consent ROW for the orphan — so the consent gate
    // passes. The relationship gate must be what fails.
    const consentId = await seedConsent({
      patientId: orphanId,
      clinicId,
      attestedAt: new Date(),
    });

    const res = await request(app).post('/api/v1/llm/ambient-note')
      .set('Authorization', `Bearer ${clinicianToken}`)
      .set('X-CSRF-Token', 'test')
      .field('patientId', orphanId)
      .field('consentId', consentId)
      .attach('audio', Buffer.alloc(1500, 0x55), { filename: 'test.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(403);
    // requirePatientRelationship throws AppError with code 'NO_PATIENT_RELATIONSHIP'.
    expect(res.body.code).toBe('NO_PATIENT_RELATIONSHIP');
    expect(blobMock.put).not.toHaveBeenCalled();
    expect(ambientMock.processAmbientAudio).not.toHaveBeenCalled();

    // Cleanup
    await withClinicRls(clinicId, async (trx) => {
      await trx('scribe_consents').where({ id: consentId }).del();
      await trx('patients').where({ id: orphanId }).del();
    });
  });

  it('(8) happy path — fresh consent + correct patient+clinic → 200; audit_log records AMBIENT_NOTE_RECORDING_STARTED bound to consent_id', async () => {
    const consentId = await seedConsent({
      patientId,
      clinicId,
      attestedAt: new Date(), // fresh
    });

    const res = await postAmbientNote({ patientId, consentId });

    expect(res.status).toBe(200);
    expect(blobMock.put).toHaveBeenCalledTimes(1);
    expect(ambientMock.processAmbientAudio).toHaveBeenCalledTimes(1);

    const processCall = ambientMock.processAmbientAudio.mock.calls[0];
    const optionsArg = processCall?.[2] as {
      auth?: { clinicId: string; staffId: string; patientId?: string };
    } | undefined;
    expect(optionsArg?.auth).toMatchObject({
      clinicId,
      staffId: adminStaffId,
      patientId,
    });

    const audit = await withClinicRls(clinicId, (trx) => (
      trx('audit_log')
        .where({ clinic_id: clinicId, operation: 'AMBIENT_NOTE_RECORDING_STARTED', record_id: consentId })
        .first()
    ));
    expect(audit).toBeTruthy();
  });

  it('(9) extended note formats supported by UI (e.g. ward_round) are accepted by API schema', async () => {
    const consentId = await seedConsent({
      patientId,
      clinicId,
      attestedAt: new Date(),
    });

    const res = await postAmbientNote({ patientId, consentId, format: 'ward_round' });

    expect(res.status).toBe(200);
    expect(res.body.code).not.toBe('VALIDATION_ERROR');
    expect(ambientMock.processAmbientAudio).toHaveBeenCalledTimes(1);

    const processCall = ambientMock.processAmbientAudio.mock.calls[0];
    const optionsArg = processCall?.[2] as { outputFormat?: string } | undefined;
    expect(optionsArg?.outputFormat).toBe('ward_round');
  });
});
