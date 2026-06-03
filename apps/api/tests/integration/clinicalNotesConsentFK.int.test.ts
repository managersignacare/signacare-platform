/**
 * BUG-273 regression — clinical_notes.consent_id FK to scribe_consents.
 *
 * Pre-fix: the link between a clinical_note and the scribe_consents row
 * that authorised its recording lived only in audit_log (string-join on
 * AMBIENT_NOTE_RECORDING_STARTED with record_id=consentId matching the
 * patient's audit row). Post-fix, `clinical_notes.consent_id` is a
 * direct FK so (a) forensic replay is a 1-JOIN query and (b) DELETEs
 * on scribe_consents are blocked while any clinical_note references
 * them (ON DELETE RESTRICT).
 *
 * Current enforced contract verified:
 *   F1: column exists, FK exists and is VALIDATED; consent_id is NOT NULL.
 *   F2: INSERT with non-existent consent_id → 23503 FK violation
 *       (referential integrity for new rows is fail-closed).
 *   F3: DELETE of a consent referenced by a note → 23503 RESTRICT.
 *   F4: End-to-end POST /ambient-note → new note carries
 *       consent_id = dto.consentId directly (no audit-log join).
 *   F5: INSERT with consent_id=NULL → 23502 NOT NULL violation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Hoist mocks for the ambient-processor + blobStorage so /ambient-note
// reaches the INSERT without touching Whisper/Ollama/S3.
const blobMock = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('../../src/shared/blobStorage', () => ({
  blobStorage: { put: blobMock.put },
}));

const ambientMock = vi.hoisted(() => ({ processAmbientAudio: vi.fn() }));
vi.mock('../../src/mcp/ambientProcessor', () => ({
  processAmbientAudio: ambientMock.processAmbientAudio,
}));

// detectScribeHallucinations must return ok:true so /ambient-note
// reaches the clinical_notes INSERT in tests.
vi.mock('../../src/shared/detectScribeHallucinations', () => ({
  detectScribeHallucinations: () => ({ ok: true, findings: [] }),
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

beforeAll(async () => {
  if (!READY) return;
  const session = await loginAsAdmin();
  token = session.token;
  adminStaffId = session.userId;
  clinicId = session.clinicId;

  const patient = await dbAdmin('patients').where({ clinic_id: clinicId }).whereNull('deleted_at').first('id');
  if (!patient) throw new Error('BUG-273 setup: no seeded patient');
  patientId = patient.id as string;
});

beforeEach(() => {
  blobMock.put.mockReset();
  ambientMock.processAmbientAudio.mockReset();
  blobMock.put.mockResolvedValue({ key: 'audio/test/bug273.webm', bucket: 'local' });
  ambientMock.processAmbientAudio.mockResolvedValue({
    summary: 'BUG-273 test summary',
    transcript: 'Patient tolerates treatment',
    structured: { subjective: 's', objective: 'o', assessment: 'a', plan: 'p' },
    medications: [],
    suggestedDiagnosis: [],
  });
});

afterAll(async () => {
  if (!READY) return;
  // Clean up BUG-273 test artefacts. Note deletion must PRECEDE
  // scribe_consents deletion because of the new FK.
  // audit_log is append-only (BUG-039) — inserted rows stay.
  await dbAdmin('clinical_notes').where({ clinic_id: clinicId, title: 'BUG-273' }).del().catch(() => undefined);
  await dbAdmin('scribe_consents').where({ clinic_id: clinicId, clinician_attestation_text: 'BUG-273 test consent' }).del().catch(() => undefined);
});

async function seedConsent(): Promise<string> {
  const id = randomUUID();
  await dbAdmin('scribe_consents').insert({
    id,
    clinic_id: clinicId,
    patient_id: patientId,
    mode: 'clinician_attestation',
    clinician_attested_by_id: adminStaffId,
    clinician_attestation_text: 'BUG-273 test consent',
    attested_at: new Date(),
    created_at: new Date(),
  });
  return id;
}

describe.skipIf(!READY)('BUG-273 — clinical_notes.consent_id FK', () => {
  it('F1 — consent_id is present, NOT NULL, and FK is validated', async () => {
    const col = await dbAdmin.raw<{ rows: Array<{ column_name: string; is_nullable: string }> }>(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
        WHERE table_name='clinical_notes' AND column_name='consent_id'`,
    );
    expect(col.rows.length).toBe(1);
    expect(col.rows[0]!.is_nullable).toBe('NO');

    const fk = await dbAdmin.raw<{ rows: Array<{ conname: string; convalidated: boolean }> }>(
      `SELECT conname, convalidated FROM pg_constraint
        WHERE conrelid='clinical_notes'::regclass
          AND conname='clinical_notes_consent_id_fk'`,
    );
    expect(fk.rows.length).toBe(1);
    expect(fk.rows[0]!.convalidated).toBe(true);
  });

  it('F2 — INSERT with non-existent consent_id → 23503 FK violation', async () => {
    const bogusConsentId = randomUUID();
    await expect(
      dbAdmin('clinical_notes').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: patientId,
        author_id: adminStaffId,
        title: 'BUG-273',
        note_type: 'soap',
        status: 'draft',
        consent_id: bogusConsentId,
        created_at: new Date(),
        updated_at: new Date(),
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('F3 — DELETE of a referenced consent → 23503 RESTRICT', async () => {
    const consentId = await seedConsent();
    const noteId = randomUUID();
    await dbAdmin('clinical_notes').insert({
      id: noteId,
      clinic_id: clinicId,
      patient_id: patientId,
      author_id: adminStaffId,
      title: 'BUG-273',
      note_type: 'soap',
      status: 'draft',
      consent_id: consentId,
      created_at: new Date(),
      updated_at: new Date(),
    });
    // With the note referencing it, the consent DELETE must be blocked.
    await expect(
      dbAdmin('scribe_consents').where({ id: consentId }).del(),
    ).rejects.toMatchObject({ code: '23503' });
    // Cleanup: delete the note, THEN the consent.
    await dbAdmin('clinical_notes').where({ id: noteId }).del();
    await dbAdmin('scribe_consents').where({ id: consentId }).del();
  });

  it('F4 — /ambient-note happy path saves consent_id directly on clinical_notes row', async () => {
    const consentId = await seedConsent();
    const agent = request(app).post('/api/v1/llm/ambient-note')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .field('patientId', patientId)
      .field('consentId', consentId)
      .attach('audio', Buffer.alloc(1500, 0x55), { filename: 't.webm', contentType: 'audio/webm' });
    const res = await agent;
    expect(res.status).toBe(200);
    expect(res.body.savedNoteId).toBeTruthy();

    // Load the saved note and assert consent_id is populated from dto.
    // Direct query — no audit-log join needed.
    const saved = await dbAdmin('clinical_notes').where({ id: res.body.savedNoteId }).first();
    expect(saved).toBeTruthy();
    expect(saved!.consent_id).toBe(consentId);

    // Cleanup.
    await dbAdmin('clinical_notes').where({ id: res.body.savedNoteId }).del();
  });

  it('F5 — INSERT with NULL consent_id → 23502 NOT NULL violation', async () => {
    await expect(
      dbAdmin('clinical_notes').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: patientId,
        author_id: adminStaffId,
        title: 'BUG-273',
        note_type: 'soap',
        status: 'draft',
        consent_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      }),
    ).rejects.toMatchObject({ code: '23502' });
  });
});
