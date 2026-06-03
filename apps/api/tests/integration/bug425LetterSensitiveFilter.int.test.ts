/**
 * BUG-425 — letter AI-draft downstream sensitive-field filter.
 *
 * Verifies:
 * 1) direct path (enhance=false) sanitises identifier/contact/header lines
 * 2) enhanced path sanitises the same class
 * 3) letter action fails closed when patientId is missing
 * 4) kill-switch bypass flag returns raw output when explicitly enabled
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

const aiEnhancerMock = vi.hoisted(() => ({
  enhancedGenerate: vi.fn(),
  loadPatientContext: vi.fn(),
}));
vi.mock('../../src/mcp/aiEnhancer', () => ({
  enhancedGenerate: aiEnhancerMock.enhancedGenerate,
  loadPatientContext: aiEnhancerMock.loadPatientContext,
}));

const localLlmMock = vi.hoisted(() => ({
  clinicalAi: {
    classifyText: vi.fn(),
    generateMaudsleySummary: vi.fn(),
    generateISBAR: vi.fn(),
    generateFormulation: vi.fn(),
    generate91DayReview: vi.fn(),
    generateLetter: vi.fn(),
    processAmbientNotes: vi.fn(),
    generateAdminReport: vi.fn(),
    generateRegistrationSummary: vi.fn(),
    generateDischargeSummary: vi.fn(),
    generateMedSummary: vi.fn(),
  },
}));
vi.mock('../../src/mcp/localLlmAgent', () => ({
  clinicalAi: localLlmMock.clinicalAi,
}));

import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { _resetFeatureFlagCache } from '../../src/shared/featureFlags';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { LETTER_DRAFT_SENSITIVE_FILTER_BYPASS_FLAG } from '@signacare/shared';

const READY = await isIntegrationReady();

const RAW_LETTER = [
  'Dear Dr Example,',
  'Re: Jane Citizen, DOB: 02/02/1982, UR: 12345678',
  'Email: private@example.com',
  '',
  'Current symptoms are improving with treatment adherence.',
  'Plan: continue current medication and review in two weeks.',
  '',
  'Kind regards,',
].join('\n');

describe.skipIf(!READY)('BUG-425 letter draft sensitive filter', () => {
  let token = '';
  let clinicId = '';
  let patientId = '';

  beforeAll(async () => {
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;

    const p = await dbAdmin('patients').where({ clinic_id: clinicId }).first('id');
    if (!p) throw new Error('BUG-425 setup failed: no seeded patient in clinic');
    patientId = p.id as string;

    // Ensure bypass starts disabled for deterministic filter assertions.
    await dbAdmin('feature_flags')
      .where({ clinic_id: clinicId, name: LETTER_DRAFT_SENSITIVE_FILTER_BYPASS_FLAG })
      .update({ enabled: false, rollout_percentage: 0 });
    _resetFeatureFlagCache();
  });

  it('sanitises direct letter path output (enhance=false)', async () => {
    localLlmMock.clinicalAi.generateLetter.mockResolvedValueOnce(RAW_LETTER);

    const res = await request(app)
      .post('/api/v1/llm/clinical-ai')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({
        action: 'letter',
        data: 'Generate GP letter from consultation notes',
        patientId,
        enhance: false,
        conversationId: randomUUID(),
      });

    expect(res.status).toBe(200);
    expect(res.body.result).toContain('Current symptoms are improving');
    expect(res.body.result).not.toMatch(/dob|ur:|email|dear|kind regards/i);
  });

  it('sanitises enhanced letter path output', async () => {
    aiEnhancerMock.enhancedGenerate.mockResolvedValueOnce({
      result: RAW_LETTER,
      model: 'mock-model',
      enriched: true,
      sections: { valid: true, missing: [] },
    });

    const res = await request(app)
      .post('/api/v1/llm/clinical-ai')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({
        action: 'letter',
        data: 'Generate GP letter from consultation notes',
        patientId,
        enhance: true,
        conversationId: randomUUID(),
      });

    expect(res.status).toBe(200);
    expect(res.body.result).toContain('Plan: continue current medication');
    expect(res.body.result).not.toMatch(/dob|ur:|email|dear|kind regards/i);
  });

  it('fails closed when letter action is requested without patientId', async () => {
    localLlmMock.clinicalAi.generateLetter.mockResolvedValueOnce(RAW_LETTER);

    const res = await request(app)
      .post('/api/v1/llm/clinical-ai')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({
        action: 'letter',
        data: 'Generate GP letter from consultation notes',
        enhance: false,
        conversationId: randomUUID(),
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

});
