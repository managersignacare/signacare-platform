/**
 * BUG-275 regression — /ambient-note catch block must pass the ORIGINAL
 * error instance through to `next()` so the global errorHandler sees
 * the true class, stack, cause chain, and custom fields.
 *
 * Pre-fix, the handler's fallback branch wrapped unknown errors in
 * `new Error(msg)`, stripping:
 *   - Class identity (HttpError → Error)
 *   - Custom fields like .code / .status
 *   - Original stack trace
 *   - Cause chain
 *
 * Post-fix contract:
 *   HttpError             → passes through (already worked pre-fix).
 *   ZodError              → passes through (already worked pre-fix).
 *   Known upstream strings (ECONNREFUSED / timeout / NO_SPEECH /
 *     Ollama) → handler writes specific status + body.
 *   Everything else       → `next(err)` with ORIGINAL instance.
 *
 * These tests mock processAmbientAudio so we don't hit Whisper/Ollama;
 * the mock throws the test's synthetic error from inside the handler.
 * Gate layers (Zod → auth → consent → size) run before the mock — all
 * must pass for control to reach the fallback catch.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// Hoisted mocks — the 2 upstream modules whose errors the catch block
// is meant to pass through. We control their throw shape via vi.mocked.
const blobMock = vi.hoisted(() => ({
  put: vi.fn(),
}));
vi.mock('../../src/shared/blobStorage', () => ({
  blobStorage: { put: blobMock.put },
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
import { HttpError } from '../../src/shared/errors';

const READY = await isIntegrationReady();

let token = '';
let adminStaffId = '';
let clinicId = '';
let patientId = '';
let relationshipEpisodeId = '';
let createdPatientId = '';

beforeAll(async () => {
  if (!READY) return;
  const session = await loginAsAdmin();
  token = session.token;
  adminStaffId = session.userId;
  clinicId = session.clinicId;

  const patient = await dbAdmin('patients')
    .where({ clinic_id: clinicId })
    .whereNull('deleted_at')
    .first('id');
  if (patient) {
    patientId = patient.id as string;
  } else {
    const seededPatientId = randomUUID();
    await dbAdmin('patients').insert({
      id: seededPatientId,
      clinic_id: clinicId,
      given_name: 'Bug275',
      family_name: 'Fixture',
      date_of_birth: '1989-03-01',
      gender: 'male',
      created_at: new Date(),
      updated_at: new Date(),
    } as never);
    patientId = seededPatientId;
    createdPatientId = seededPatientId;
  }

  relationshipEpisodeId = randomUUID();
  await dbAdmin('episodes').insert({
    id: relationshipEpisodeId,
    patient_id: patientId,
    clinic_id: clinicId,
    title: 'BUG-275 relationship fixture',
    status: 'open',
    start_date: new Date().toISOString().slice(0, 10),
    specialty_code: 'mental_health',
    primary_clinician_id: adminStaffId,
    lock_version: 0,
    created_at: new Date(),
    updated_at: new Date(),
  });
});

beforeEach(() => {
  blobMock.put.mockReset();
  ambientMock.processAmbientAudio.mockReset();
  // Default happy-path blobStorage so tests reach the processAmbientAudio
  // call. Each test then configures ambientMock to throw the specific
  // error shape under test.
  blobMock.put.mockResolvedValue({ key: 'audio/test/key.webm', bucket: 'local' });
});

afterAll(async () => {
  if (!READY) return;
  if (relationshipEpisodeId) {
    await dbAdmin('episodes').where({ id: relationshipEpisodeId }).del().catch(() => undefined);
  }
  await dbAdmin('scribe_consents').where({ clinic_id: clinicId }).del().catch(() => undefined);
  await dbAdmin('audit_log').where({ operation: 'AMBIENT_NOTE_RECORDING_STARTED', clinic_id: clinicId }).del().catch(() => undefined);
  if (createdPatientId) {
    await dbAdmin('patients').where({ id: createdPatientId }).del().catch(() => undefined);
  }
});

async function seedConsent(): Promise<string> {
  const id = randomUUID();
  await dbAdmin('scribe_consents').insert({
    id,
    clinic_id: clinicId,
    patient_id: patientId,
    mode: 'clinician_attestation',
    clinician_attested_by_id: adminStaffId,
    clinician_attestation_text: 'BUG-275 test consent',
    attested_at: new Date(),
    created_at: new Date(),
  });
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

describe.skipIf(!READY)('BUG-275 — /ambient-note catch-block error passthrough', () => {
  it('T1 — HttpError from upstream passes through unchanged (regression guard on pre-fix branch)', async () => {
    const consentId = await seedConsent();
    // processAmbientAudio throws an HttpError; the catch block's first
    // branch at llmRoutes.ts:728-731 matches HttpError explicitly and
    // calls next(err). Global errorHandler translates to 403.
    ambientMock.processAmbientAudio.mockRejectedValue(
      new HttpError(403, 'UPSTREAM_FORBIDDEN', 'synthetic upstream'),
    );
    const res = await postAmbientNote({ patientId, consentId });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('UPSTREAM_FORBIDDEN');
  });

  it('T2 — unknown non-HttpError/non-Zod/non-upstream-string throw → ORIGINAL instance reaches errorHandler (BUG-275 fix)', async () => {
    const consentId = await seedConsent();
    // Custom error class with a sentinel field. Pre-fix the handler
    // wrapped this in `new Error(msg)`, destroying className + the
    // custom .contextTag field. Post-fix the original passes through.
    class SyntheticDiagnosticError extends Error {
      public readonly contextTag = 'BUG-275-sentinel';
      constructor(msg: string) {
        super(msg);
        this.name = 'SyntheticDiagnosticError';
      }
    }
    const thrown = new SyntheticDiagnosticError('synthetic-not-matched-by-upstream-strings');
    ambientMock.processAmbientAudio.mockRejectedValue(thrown);

    const res = await postAmbientNote({ patientId, consentId });
    // The global errorHandler shape is not our contract; we don't
    // assert the body. What we DO assert:
    //   - status is 500 (unknown error → internal)
    //   - the call completed (no infinite hang / no crash)
    // The structural claim "original instance was passed to next"
    // is verified by T3 below which inspects a field that the
    // wrapping would have destroyed.
    expect(res.status).toBe(500);
  });

  it('T3 — duck-typed error with .status + .code survives fallback → errorHandler renders code (structural passthrough)', async () => {
    const consentId = await seedConsent();
    // The global errorHandler (toErrorResponse in shared/errors.ts:100-114)
    // has a duck-typed branch: if err instanceof Error AND has a numeric
    // .status AND a string .code, it renders {error, code} with the
    // custom status. This is the path pre-fix destroyed — wrapping in
    // `new Error(msg)` lost .status + .code, falling through to the
    // generic 500 with code='INTERNAL_ERROR'.
    //
    // Post-fix: the original err passes through, the duck-typed branch
    // fires, and the response body carries the custom code.
    class DuckTypedError extends Error {
      public readonly status = 418;
      public readonly code = 'BUG_275_PASSTHROUGH';
      constructor() {
        super('BUG-275 duck-typed synthetic');
      }
    }
    ambientMock.processAmbientAudio.mockRejectedValue(new DuckTypedError());

    const res = await postAmbientNote({ patientId, consentId });
    // Pre-fix: status=500, code='INTERNAL_ERROR'.
    // Post-fix: status=418, code='BUG_275_PASSTHROUGH'.
    expect(res.status).toBe(418);
    expect(res.body.code).toBe('BUG_275_PASSTHROUGH');
  });
});
