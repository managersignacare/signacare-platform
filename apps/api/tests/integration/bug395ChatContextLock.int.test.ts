/**
 * BUG-395 — AI chat patient-context UUID lock end-to-end.
 *
 * A `/clinical-ai` request with a conversationId + patientId binds that
 * conversation to the patient for 60 min. A second request with the
 * same conversationId but a DIFFERENT patientId MUST be rejected 409
 * CHAT_CONTEXT_LOCKED. Same patientId → ok (refreshes TTL). No
 * conversationId → no lock (backwards-compat for frontend rollout).
 *
 * The clinical-ai endpoint calls out to a local LLM which may not be
 * running under integration test; we short-circuit by using an action
 * that doesn't require the LLM (the lock check happens BEFORE the
 * model invocation). If the LLM is unreachable, the test still covers
 * the lock behaviour because the 409 fires in front of the model call.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../src/server';
import { redis } from '../../src/config/redis';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { CHAT_CTX_KEY_PREFIX } from '../../src/features/llm/chatContextLock';

const READY = await isIntegrationReady();

let session: { token: string; clinicId: string; userId: string };
let patientAId = '';
let patientBId = '';
let episodeAId = '';
let episodeBId = '';
const TAG = `BUG-395-${Date.now()}`;

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();
  // Seed two real patients and explicit relationship episodes so
  // requirePatientRelationship passes independently of role-level
  // bypass policy.
  patientAId = randomUUID();
  patientBId = randomUUID();
  await dbAdmin('patients').insert([
    {
      id: patientAId,
      clinic_id: session.clinicId,
      given_name: 'A',
      family_name: TAG,
      emr_number: `A-${TAG}`,
      date_of_birth: '1990-01-01',
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: patientBId,
      clinic_id: session.clinicId,
      given_name: 'B',
      family_name: TAG,
      emr_number: `B-${TAG}`,
      date_of_birth: '1990-01-01',
      created_at: new Date(),
      updated_at: new Date(),
    },
  ]);

  episodeAId = randomUUID();
  episodeBId = randomUUID();
  await dbAdmin('episodes').insert([
    {
      id: episodeAId,
      patient_id: patientAId,
      clinic_id: session.clinicId,
      title: 'BUG-395 relationship A',
      status: 'open',
      start_date: new Date().toISOString().slice(0, 10),
      specialty_code: 'mental_health',
      primary_clinician_id: session.userId,
      lock_version: 0,
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: episodeBId,
      patient_id: patientBId,
      clinic_id: session.clinicId,
      title: 'BUG-395 relationship B',
      status: 'open',
      start_date: new Date().toISOString().slice(0, 10),
      specialty_code: 'mental_health',
      primary_clinician_id: session.userId,
      lock_version: 0,
      created_at: new Date(),
      updated_at: new Date(),
    },
  ]);
});

afterAll(async () => {
  if (!READY) return;
  await dbAdmin('episodes').whereIn('id', [episodeAId, episodeBId]).del();
  await dbAdmin('patients').whereIn('id', [patientAId, patientBId]).del();
});

describe.skipIf(!READY)('BUG-395 — AI chat patient-context UUID lock', () => {
  it('rejects a cross-patient switch with 409 CHAT_CONTEXT_LOCKED', async () => {
    const conversationId = randomUUID();

    // First request binds (conversationId, patientA)
    const r1 = await request(app)
      .post('/api/v1/llm/clinical-ai')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        action: 'classify',
        data: 'hello',
        conversationId,
        patientId: patientAId,
      });
    // We don't assert 200 — the LLM may 500 if Ollama is not running.
    // The lock acquisition happens FIRST, so Redis now has the mapping.
    // Post-L4-absorb the stored value is a JSON payload { patientId, createdAt }.
    const stored = await redis.get(`${CHAT_CTX_KEY_PREFIX}${conversationId}`);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored as string);
    expect(parsed.patientId).toBe(patientAId);

    // Second request with the SAME conversationId but different patientId
    const r2 = await request(app)
      .post('/api/v1/llm/clinical-ai')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        action: 'classify',
        data: 'hello',
        conversationId,
        patientId: patientBId,
      });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('CHAT_CONTEXT_LOCKED');
    // L4 absorb: lockedPatientId is NOT in response body (oracle risk).
    // It IS in the server-side audit row; verify via redis state instead.
    expect(r2.body.details?.lockedPatientId).toBeUndefined();

    // Cleanup
    await redis.del(`${CHAT_CTX_KEY_PREFIX}${conversationId}`);
    // r1 result only referenced to satisfy "declared but never used" lint
    expect(r1.status).toBeGreaterThan(0);
  });

  it('allows same-patient continuation (no 409)', async () => {
    const conversationId = randomUUID();

    await request(app)
      .post('/api/v1/llm/clinical-ai')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        action: 'classify',
        data: 'first turn',
        conversationId,
        patientId: patientAId,
      });

    const r2 = await request(app)
      .post('/api/v1/llm/clinical-ai')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        action: 'classify',
        data: 'second turn',
        conversationId,
        patientId: patientAId,
      });
    // Second turn with same patientId must NOT be 409. It may still 500
    // if Ollama is offline; we only assert the lock does not reject.
    expect(r2.status).not.toBe(409);

    await redis.del(`${CHAT_CTX_KEY_PREFIX}${conversationId}`);
  });

  it('mandatory conversationId — request without it fails validation (L4 absorb)', async () => {
    // L4-absorb 2026-04-24 upgraded conversationId from optional to
    // mandatory. The pre-absorb "backwards-compat silent gap" is now
    // closed — every call gets locked. Frontend rollout went out in
    // the same commit (apiClient interceptor auto-injects).
    const r = await request(app)
      .post('/api/v1/llm/clinical-ai')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        action: 'classify',
        data: 'no-conv',
        patientId: patientAId,
        // conversationId intentionally omitted
      });
    // Zod validation fails before the handler runs (422 per project
    // error-envelope convention for schema-validation errors)
    expect(r.status).toBe(422);
  });
});
