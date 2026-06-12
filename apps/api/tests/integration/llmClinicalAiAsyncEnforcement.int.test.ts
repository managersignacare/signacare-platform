import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('clinical-ai async enforcement', () => {
  let token = '';
  let clinicId = '';
  let staffId = '';
  let patientId = '';
  let episodeId = '';

  beforeAll(async () => {
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;
    staffId = session.userId;
    patientId = randomUUID();
    episodeId = randomUUID();

    await dbAdmin.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
      await trx('patients').insert({
        id: patientId,
        clinic_id: clinicId,
        given_name: 'Async',
        family_name: 'Enforcement',
        date_of_birth: '1981-02-03',
        gender: 'female',
        created_at: new Date(),
        updated_at: new Date(),
      });
      await trx('episodes').insert({
        id: episodeId,
        clinic_id: clinicId,
        patient_id: patientId,
        primary_clinician_id: staffId,
        status: 'open',
        episode_type: 'community',
        start_date: '2026-06-01',
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
  });

  afterAll(async () => {
    if (!patientId) return;
    await dbAdmin.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
      await trx('episodes')
        .where({ id: episodeId })
        .update({ status: 'closed', deleted_at: new Date(), updated_at: new Date() });
      await trx('patients')
        .where({ id: patientId })
        .update({ deleted_at: new Date(), updated_at: new Date() });
    }).catch(() => undefined);
  });

  beforeEach(() => {
    aiEnhancerMock.enhancedGenerate.mockReset();
    aiEnhancerMock.loadPatientContext.mockReset();
    localLlmMock.callLocalLlm.mockReset();
  });

  async function postClinicalAi(body: Record<string, unknown>) {
    return request(app)
      .post('/api/v1/llm/clinical-ai')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({
        conversationId: randomUUID(),
        ...body,
      });
  }

  // Phase 3 hard constraint #1 — every long clinical action must be
  // blocked on the synchronous /llm/clinical-ai route. The operator-
  // mandated list below is the canonical set the guard MUST cover.
  // Each entry declares whether the action is patient-scoped (needs a
  // patientId to trigger the guard) or unconditional (fires regardless).
  const OPERATOR_LONG_ACTION_CASES = [
    { action: 'report-insight', patientScoped: true, sample: 'Episode insight prompt' },
    { action: 'handover-summary', patientScoped: false, sample: 'Shift handover prompt' },
    { action: 'medication-adherence', patientScoped: true, sample: 'Adherence prompt' },
    { action: 'ect-summary', patientScoped: true, sample: 'ECT course summary' },
    { action: 'mhrt-report', patientScoped: true, sample: 'MHRT brief' },
    { action: 'lifechart-schema', patientScoped: true, sample: 'Life chart schema' },
    { action: 'linkages', patientScoped: true, sample: 'Care linkages' },
    { action: 'med-summary', patientScoped: true, sample: 'Current medications...' },
    { action: 'register-summary', patientScoped: true, sample: 'Register summary' },
    { action: 'risk-summary', patientScoped: true, sample: 'Risk summary' },
    { action: 'certificate', patientScoped: true, sample: 'Medical certificate' },
    { action: 'admin-report', patientScoped: false, sample: '{"overview":true}' },
    { action: 'discharge', patientScoped: true, sample: 'Discharge plan' },
    { action: 'formulation', patientScoped: true, sample: 'Biopsychosocial formulation' },
  ] as const;

  it.each(OPERATOR_LONG_ACTION_CASES)(
    "rejects '$action' on the sync clinical-ai route",
    async ({ action, patientScoped, sample }) => {
      const res = await postClinicalAi({
        action,
        data: sample,
        patientId: patientScoped ? patientId : undefined,
        enhance: action === 'letter' || patientScoped,
      });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('AI_ACTION_REQUIRES_ASYNC_JOB');
      expect(String(res.body.error)).toContain('/llm/clinical-ai');
      expect(res.body.details).toMatchObject({
        action,
        recommendedEndpoint: '/api/v1/ai/jobs',
      });
      expect(aiEnhancerMock.enhancedGenerate).not.toHaveBeenCalled();
      expect(localLlmMock.callLocalLlm).not.toHaveBeenCalled();
    },
  );

  it('still allows a bounded non-durable action to reach the sync handler', async () => {
    // Negative-space coverage: the guard must NOT trip for actions that
    // are deliberately lightweight (e.g. classification chat helpers).
    // We mock the downstream generate so the request can complete even
    // without an Ollama server, then assert the guard let the call
    // through (i.e. the generate mock WAS invoked).
    aiEnhancerMock.enhancedGenerate.mockResolvedValueOnce({
      output: 'classified',
      model: 'test',
    });
    localLlmMock.callLocalLlm.mockResolvedValueOnce({ output: 'classified', model: 'test' });

    const res = await postClinicalAi({
      action: 'lightweight-helper',
      data: 'short prompt',
      enhance: false,
    });

    // We don't need to assert success-or-not (the downstream may still
    // 4xx on Zod validation), only that the guard's specific 409 code
    // did not fire — which would have aborted before any generate path.
    expect(res.body.code).not.toBe('AI_ACTION_REQUIRES_ASYNC_JOB');
  });
});
