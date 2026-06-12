/**
 * BUG-038 regression — LLM response envelopes MUST include the canonical
 * `disclaimer` field so UIs + forensic auditors can reliably distinguish
 * AI-generated content from clinician-authored content (TGA non-device
 * classification; Audit Tier 5.5 MED-G3).
 *
 * Coverage matrix (4 tests):
 *
 *   T1 — POST /api/v1/llm/suggest carries disclaimer: CLINICAL_AI_DISCLAIMER
 *   T2 — POST /api/v1/llm/clinical-ai (enhanced path, patientId) carries it
 *   T3 — POST /api/v1/llm/clinical-ai (direct path, no patientId) carries it
 *   T4 — POST /api/v1/llm/agent regression — still carries canonical
 *        string (not a drifted inline literal post-de-duplication)
 *
 * Red-first: pre-fix T1–T3 FAIL (no disclaimer field in envelope);
 * T4 passes pre- and post-fix but pins that de-duplication is clean.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Hoisted mocks so we don't need a live Ollama to exercise the envelopes.
const aiAgentMock = vi.hoisted(() => ({ runAgent: vi.fn() }));
vi.mock('../../src/mcp/server/aiAgent', () => ({
  runAgent: aiAgentMock.runAgent,
}));

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

// llmService.processSuggestion is called by /suggest. Mock it so we don't
// need Ollama to exercise the envelope.
const llmServiceMock = vi.hoisted(() => ({
  processSuggestion: vi.fn(),
}));
vi.mock('../../src/features/llm/llmService', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, processSuggestion: llmServiceMock.processSuggestion };
});

import request from 'supertest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import app from '../../src/server';
import { CLINICAL_AI_DISCLAIMER } from '../../src/shared/llmDisclaimer';
import { dbAdmin } from '../../src/db/db';

describe.skipIf(!(await isIntegrationReady()))('BUG-038 clinical-disclaimer envelope', () => {
  let token: string;
  let clinicId: string;
  let staffId: string;
  let patientId: string;
  let createdEpisodeId: string | null = null;
  let createdPatientId: string | null = null;

  async function withClinicContext<T>(
    work: (trx: Awaited<ReturnType<typeof dbAdmin.transaction>>) => Promise<T>,
  ): Promise<T> {
    return dbAdmin.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
      return work(trx);
    });
  }

  beforeAll(async () => {
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;
    staffId = session.userId;

    patientId = randomUUID();
    createdPatientId = patientId;
    createdEpisodeId = randomUUID();

    await withClinicContext(async (trx) => {
      await trx('patients').insert({
        id: patientId,
        clinic_id: clinicId,
        given_name: 'Bug038',
        family_name: 'Disclaimer',
        date_of_birth: '1988-06-20',
        gender: 'female',
        created_at: new Date(),
        updated_at: new Date(),
      });

      await trx('episodes').insert({
        id: createdEpisodeId,
        clinic_id: clinicId,
        patient_id: patientId,
        primary_clinician_id: staffId,
        status: 'open',
        episode_type: 'community',
        start_date: '2026-05-24',
        created_at: new Date(),
        updated_at: new Date(),
      });
    });

    // /suggest is gated by requireFeatureEnabled('ai-chat'). Enable for
    // this clinic so the test exercises the handler (not the flag gate).
    const existing = await withClinicContext(async (trx) => (
      trx('feature_flags')
        .where({ clinic_id: clinicId, name: 'ai-chat' })
        .first('id')
    ));
    if (existing) {
      await withClinicContext(async (trx) => {
        await trx('feature_flags').where({ id: existing.id }).update({ enabled: true });
      });
    } else {
      await withClinicContext(async (trx) => {
        await trx('feature_flags').insert({
          id: randomUUID(),
          clinic_id: clinicId,
          name: 'ai-chat',
          enabled: true,
          rollout_percentage: 100,
        });
      });
    }
  });

  afterAll(async () => {
    await withClinicContext(async (trx) => {
      if (createdEpisodeId) {
        await trx('episodes')
          .where({ id: createdEpisodeId })
          .update({
            status: 'closed',
            deleted_at: new Date(),
            updated_at: new Date(),
          });
      }
      if (createdPatientId) {
        await trx('patients')
          .where({ id: createdPatientId })
          .update({
            deleted_at: new Date(),
            updated_at: new Date(),
          });
      }
    });
  });

  it('T1 — /suggest response carries canonical disclaimer', async () => {
    llmServiceMock.processSuggestion.mockResolvedValueOnce({
      interactionId: '11111111-1111-1111-1111-111111111111',
      outputRef: 'some-output-ref',
      success: true,
      latencyMs: 123,
    });

    const res = await request(app)
      .post('/api/v1/llm/suggest')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ feature: 'suggestion', contextRef: 'test-context-ref' });
    expect(res.status).toBe(200);
    expect(res.body.disclaimer).toBe(CLINICAL_AI_DISCLAIMER);
    // And the rest of the envelope is preserved.
    expect(res.body.success).toBe(true);
  });

  it('T2 — /clinical-ai enhanced path carries canonical disclaimer', async () => {
    aiEnhancerMock.enhancedGenerate.mockResolvedValueOnce({
      result: 'Mock ISBAR summary',
      model: 'llama3.2',
      enriched: true,
      sections: { valid: true, missing: [] },
    });

    const res = await request(app)
      .post('/api/v1/llm/clinical-ai')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({
        action: 'isbar',
        data: 'Clinical notes text',
        patientId,
        conversationId: randomUUID(),
      });
    expect(res.status).toBe(200);
    expect(res.body.disclaimer).toBe(CLINICAL_AI_DISCLAIMER);
    expect(res.body.result).toContain('Mock ISBAR');
  });

  it('T3 — /clinical-ai direct path (no patientId) carries canonical disclaimer', async () => {
    localLlmMock.callLocalLlm.mockResolvedValueOnce({
      text: '{"sentiment":"neutral"}',
      model: 'mock-local-model',
      tokensUsed: 64,
      modelVersion: 'mock-local-model',
    });

    const res = await request(app)
      .post('/api/v1/llm/clinical-ai')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({
        action: 'classify',
        data: 'Some neutral clinical note',
        conversationId: randomUUID(),
      });
    expect(res.status).toBe(200);
    expect(res.body.disclaimer).toBe(CLINICAL_AI_DISCLAIMER);
  });

  it('T4 — /agent regression carries canonical disclaimer (no inline-literal drift)', async () => {
    aiAgentMock.runAgent.mockResolvedValueOnce({
      answer: 'Mock agent answer.',
      toolCalls: [],
      iterations: 1,
      model: 'llama3.2',
      modelVersion: 'llama3.2',
      requestedTemperature: 0.1,
    });

    const res = await request(app)
      .post('/api/v1/llm/agent')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ query: 'Show organisation statistics', patientId });
    expect(res.status).toBe(200);
    expect(res.body.disclaimer).toBe(CLINICAL_AI_DISCLAIMER);
    // Strict equality — any inline drift in the /agent handler would
    // fail this test and surface as a review-gate violation.
    expect(res.body.disclaimer).toBe(
      'AI-generated — verify against current clinical guidelines before acting',
    );
  });
});
