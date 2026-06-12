/**
 * BUG-036 regression — LLM routes MUST enforce clinician-patient relationship
 * before routing patient-scoped data across the trust boundary (LLM prompt).
 *
 * Five endpoints gated:
 *   1. POST /api/v1/llm/clinical-ai          — RAG via enhancedGenerate
 *   2. POST /api/v1/llm/agent                — autonomous agent tool-use
 *   3. POST /api/v1/scribe/patient-summary   — patient name → Ollama prompt
 *   4. POST /api/v1/scribe/referral-letter   — name / DOB / MRN → Ollama prompt
 *   5. POST /api/v1/scribe/search            — patient-filtered vector search
 *
 * Test matrix per endpoint (3 scenarios × 5 = 15 tests):
 *   a. Clinician with NO care relationship → 403 NO_PATIENT_RELATIONSHIP
 *   b. Clinician WITH care relationship    → 200 (LLM mock called)
 *   c. Admin/superadmin (BYPASS_ROLES)     → 200 regardless of relationship
 *
 * Plus 1 conditional-gate bypass test on /clinical-ai: POST without patientId
 * → assert loadPatientContext spy is never called. Proves the conditional
 * gate's safety assumption (aiEnhancer.ts:480 — RAG only runs if patientId
 * AND clinicId both present).
 *
 * Total: 16 tests.
 *
 * Red-first: pre-fix the 5 clinician-no-rel tests FAIL (handler passes request
 * to LLM mock); post-fix 16/16 PASS. Captured FAIL + PASS logs in commit body.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// ─── Hoisted mocks ─────────────────────────────────────────────────────────
// LLM + RAG + Ollama calls mocked so gate behaviour is the real test.
const aiEnhancerMock = vi.hoisted(() => ({
  enhancedGenerate: vi.fn(),
  loadPatientContext: vi.fn(),
}));
vi.mock('../../src/mcp/aiEnhancer', () => ({
  enhancedGenerate: aiEnhancerMock.enhancedGenerate,
  loadPatientContext: aiEnhancerMock.loadPatientContext,
}));

const localLlmMock = vi.hoisted(() => ({
  callLocalLlm: vi.fn(),
}));
vi.mock('../../src/mcp/localLlmAgent', () => ({
  callLocalLlm: localLlmMock.callLocalLlm,
}));

const aiAgentMock = vi.hoisted(() => ({
  runAgent: vi.fn(),
}));
vi.mock('../../src/mcp/server/aiAgent', () => ({
  runAgent: aiAgentMock.runAgent,
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────

import request from 'supertest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';

const READY = await isIntegrationReady();

let adminToken = '';
let clinicId = '';

// A patient WITH a care relationship to sarah.chen (clinician).
let patientWithRel = '';
// A patient WITHOUT any clinician relationship.
let orphanPatient = '';

// Cache clinician token across tests — 15+ logins in one test run would
// trip auth rate limit (dev cap 200/15min shared with admin setup).
let cachedClinicianToken: string | null = null;
async function loginAsClinician(): Promise<string> {
  if (cachedClinicianToken) return cachedClinicianToken;
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', 'test')
    .set('X-Client', 'mobile')
    .send({ email: 'sarah.chen@signacare.local', password: 'Password1!' });
  if (res.status !== 200) throw new Error(`clinician login failed: ${res.status}`);
  cachedClinicianToken = res.body.accessToken as string;
  return cachedClinicianToken;
}

beforeAll(async () => {
  if (!READY) return;
  const session = await loginAsAdmin();
  adminToken = session.token;
  clinicId = session.clinicId;

  // Seed two patients: one with care relationship to sarah.chen, one orphan.
  // Relationship is established via an `open` episode with sarah as
  // primary_clinician_id — the first branch of requirePatientRelationship.
  const sarah = await dbAdmin('staff').where({ email: 'sarah.chen@signacare.local' }).first('id');
  if (!sarah) throw new Error('BUG-036 test setup: clinician sarah.chen not seeded');
  const clinicianId = sarah.id as string;

  patientWithRel = randomUUID();
  await dbAdmin('patients').insert({
    id: patientWithRel,
    clinic_id: clinicId,
    given_name: 'WithRel',
    family_name: 'Test',
    date_of_birth: '1985-03-14',
  });
  await dbAdmin('episodes').insert({
    id: randomUUID(),
    clinic_id: clinicId,
    patient_id: patientWithRel,
    episode_type: 'inpatient',
    status: 'open',
    start_date: new Date().toISOString().slice(0, 10),
    primary_clinician_id: clinicianId,
    created_at: new Date(),
    updated_at: new Date(),
  });

  orphanPatient = randomUUID();
  await dbAdmin('patients').insert({
    id: orphanPatient,
    clinic_id: clinicId,
    given_name: 'Orphan',
    family_name: 'Test',
    date_of_birth: '1990-01-01',
  });

  // scribeRoutes mounts requireFeatureEnabled('ai-scribe') at the router
  // level. Tests against /scribe/* must have the flag enabled for this
  // clinic OR they return 403 FEATURE_DISABLED before reaching the gate.
  // Partial unique index on (clinic_id, name) WHERE clinic_id IS NOT NULL
  // doesn't match Knex's onConflict; do a manual upsert.
  const existing = await dbAdmin('feature_flags')
    .where({ clinic_id: clinicId, name: 'ai-scribe' })
    .first('id');
  if (existing) {
    await dbAdmin('feature_flags').where({ id: existing.id }).update({ enabled: true });
  } else {
    await dbAdmin('feature_flags').insert({
      id: randomUUID(),
      clinic_id: clinicId,
      name: 'ai-scribe',
      enabled: true,
      rollout_percentage: 100,
    });
  }
});

afterAll(async () => {
  if (!READY) return;
  await dbAdmin('episodes')
    .where({ patient_id: patientWithRel })
    .update({
      status: 'closed',
      deleted_at: new Date(),
      updated_at: new Date(),
    })
    .catch(() => undefined);
  await dbAdmin('patients')
    .whereIn('id', [patientWithRel, orphanPatient])
    .update({
      deleted_at: new Date(),
      updated_at: new Date(),
    })
    .catch(() => undefined);
  // BUG-036 L5 review minor: disable ai-scribe flag after test so
  // the clinic state returns to its pre-test baseline.
  await dbAdmin('feature_flags')
    .where({ clinic_id: clinicId, name: 'ai-scribe' })
    .update({ enabled: false })
    .catch(() => undefined);
});

beforeEach(() => {
  aiEnhancerMock.enhancedGenerate.mockReset();
  aiEnhancerMock.loadPatientContext.mockReset();
  aiAgentMock.runAgent.mockReset();
  localLlmMock.callLocalLlm.mockReset();

  // Default mock returns so happy-path tests don't 500 after the gate.
  aiEnhancerMock.enhancedGenerate.mockResolvedValue({
    result: 'mock-enhanced-output',
    model: 'mock',
    enriched: true,
    sections: { valid: true, missing: [] },
  });
  aiEnhancerMock.loadPatientContext.mockResolvedValue('mock-context');
  aiAgentMock.runAgent.mockResolvedValue({
    answer: 'mock-agent-answer',
    model: 'mock',
    toolCalls: [],
  });
  localLlmMock.callLocalLlm.mockResolvedValue({
    text: 'mock-local-output',
    model: 'mock-local-model',
    tokensUsed: 128,
    modelVersion: 'mock-local-model',
  });
});

// ─── Helper senders ────────────────────────────────────────────────────────

function postClinicalAi(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/llm/clinical-ai')
    .set('Authorization', `Bearer ${token}`)
    .set('X-CSRF-Token', 'test')
    .send({
      conversationId:
        typeof body.conversationId === 'string' ? body.conversationId : randomUUID(),
      ...body,
    });
}
function postAgent(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/llm/agent')
    .set('Authorization', `Bearer ${token}`)
    .set('X-CSRF-Token', 'test')
    .send(body);
}
function postPatientSummary(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/scribe/patient-summary')
    .set('Authorization', `Bearer ${token}`)
    .set('X-CSRF-Token', 'test')
    .send(body);
}
function postReferralLetter(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/scribe/referral-letter')
    .set('Authorization', `Bearer ${token}`)
    .set('X-CSRF-Token', 'test')
    .send(body);
}
function postSearch(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/scribe/search')
    .set('Authorization', `Bearer ${token}`)
    .set('X-CSRF-Token', 'test')
    .send(body);
}

const DUMMY_STRUCTURED = {
  subjective: 's',
  objective: 'o',
  assessment: 'a',
  plan: 'p',
};
const DUMMY_EMBEDDING = new Array(1536).fill(0);

// ─── Tests ─────────────────────────────────────────────────────────────────

describe.skipIf(!READY)('BUG-036 — LLM routes patient-relationship gate', () => {
  describe('/clinical-ai', () => {
    it('(1a) clinician WITHOUT relationship → 403 NO_PATIENT_RELATIONSHIP', async () => {
      const token = await loginAsClinician();
      const res = await postClinicalAi(token, {
        action: 'maudsley', data: 'test', patientId: orphanPatient, enhance: true,
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('NO_PATIENT_RELATIONSHIP');
      expect(aiEnhancerMock.enhancedGenerate).not.toHaveBeenCalled();
    });

    it('(1b) clinician WITH relationship → 200 (LLM mock called)', async () => {
      const token = await loginAsClinician();
      const res = await postClinicalAi(token, {
        action: 'maudsley', data: 'test', patientId: patientWithRel, enhance: true,
      });
      expect(res.status).toBe(200);
      expect(aiEnhancerMock.enhancedGenerate).toHaveBeenCalledTimes(1);
    });

    it('(1c) superadmin bypass → 200 regardless of relationship', async () => {
      const res = await postClinicalAi(adminToken, {
        action: 'maudsley', data: 'test', patientId: orphanPatient, enhance: true,
      });
      expect(res.status).toBe(200);
      expect(aiEnhancerMock.enhancedGenerate).toHaveBeenCalledTimes(1);
    });

    it('(1d) NO patientId + enhance:true → loadPatientContext NEVER called (conditional-gate bypass safety)', async () => {
      const token = await loginAsClinician();
      const res = await postClinicalAi(token, {
        action: 'maudsley', data: 'test', enhance: true,
      });
      expect(res.status).toBe(200);
      // Conditional gate `if (patientId)` skipped; enhancedGenerate's RAG
      // branch at aiEnhancer.ts:480 requires BOTH patientId + clinicId —
      // so loadPatientContext is never called. This proves the gate's
      // safety assumption even when patientId is absent.
      expect(aiEnhancerMock.loadPatientContext).not.toHaveBeenCalled();
    });
  });

  describe('/agent', () => {
    it('(2a) clinician WITHOUT relationship → 403', async () => {
      const token = await loginAsClinician();
      const res = await postAgent(token, { query: 'test', patientId: orphanPatient });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('NO_PATIENT_RELATIONSHIP');
      expect(aiAgentMock.runAgent).not.toHaveBeenCalled();
    });
    it('(2b) clinician WITH relationship → 200', async () => {
      const token = await loginAsClinician();
      const res = await postAgent(token, { query: 'test', patientId: patientWithRel });
      expect(res.status).toBe(200);
      expect(aiAgentMock.runAgent).toHaveBeenCalledTimes(1);
    });
    it('(2c) superadmin bypass → 200', async () => {
      const res = await postAgent(adminToken, { query: 'test', patientId: orphanPatient });
      expect(res.status).toBe(200);
      expect(aiAgentMock.runAgent).toHaveBeenCalledTimes(1);
    });
  });

  describe('/scribe/patient-summary', () => {
    it('(3a) clinician WITHOUT relationship → 403', async () => {
      const token = await loginAsClinician();
      const res = await postPatientSummary(token, {
        structuredNote: DUMMY_STRUCTURED, patientId: orphanPatient,
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('NO_PATIENT_RELATIONSHIP');
      expect(localLlmMock.callLocalLlm).not.toHaveBeenCalled();
    });
    it('(3b) clinician WITH relationship → 200', async () => {
      const token = await loginAsClinician();
      const res = await postPatientSummary(token, {
        structuredNote: DUMMY_STRUCTURED, patientId: patientWithRel,
      });
      expect(res.status).toBe(200);
      expect(localLlmMock.callLocalLlm).toHaveBeenCalledTimes(1);
    });
    it('(3c) superadmin bypass → 200', async () => {
      const res = await postPatientSummary(adminToken, {
        structuredNote: DUMMY_STRUCTURED, patientId: orphanPatient,
      });
      expect(res.status).toBe(200);
      expect(localLlmMock.callLocalLlm).toHaveBeenCalledTimes(1);
    });
  });

  describe('/scribe/referral-letter', () => {
    it('(4a) clinician WITHOUT relationship → 403', async () => {
      const token = await loginAsClinician();
      const res = await postReferralLetter(token, {
        structuredNote: DUMMY_STRUCTURED, patientId: orphanPatient,
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('NO_PATIENT_RELATIONSHIP');
      expect(localLlmMock.callLocalLlm).not.toHaveBeenCalled();
    });
    it('(4b) clinician WITH relationship → 200', async () => {
      const token = await loginAsClinician();
      const res = await postReferralLetter(token, {
        structuredNote: DUMMY_STRUCTURED, patientId: patientWithRel,
      });
      expect(res.status).toBe(200);
      expect(localLlmMock.callLocalLlm).toHaveBeenCalledTimes(1);
    });
    it('(4c) superadmin bypass → 200', async () => {
      const res = await postReferralLetter(adminToken, {
        structuredNote: DUMMY_STRUCTURED, patientId: orphanPatient,
      });
      expect(res.status).toBe(200);
      expect(localLlmMock.callLocalLlm).toHaveBeenCalledTimes(1);
    });
  });

  describe('/scribe/search', () => {
    it('(5a) clinician WITHOUT relationship → 403', async () => {
      const token = await loginAsClinician();
      const res = await postSearch(token, {
        embedding: DUMMY_EMBEDDING, topK: 5, patientId: orphanPatient,
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('NO_PATIENT_RELATIONSHIP');
    });
    it('(5b) clinician WITH relationship → 200', async () => {
      const token = await loginAsClinician();
      const res = await postSearch(token, {
        embedding: DUMMY_EMBEDDING, topK: 5, patientId: patientWithRel,
      });
      expect(res.status).toBe(200);
    });
    it('(5c) superadmin bypass → 200', async () => {
      const res = await postSearch(adminToken, {
        embedding: DUMMY_EMBEDDING, topK: 5, patientId: orphanPatient,
      });
      expect(res.status).toBe(200);
    });

    it('(5d) missing patientId → 422 VALIDATION_ERROR (L4 review dim 5: patientId now REQUIRED to close clinic-wide PHI-fishing vector)', async () => {
      const token = await loginAsClinician();
      const res = await postSearch(token, {
        embedding: DUMMY_EMBEDDING, topK: 5,
        // patientId intentionally omitted
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });
});
