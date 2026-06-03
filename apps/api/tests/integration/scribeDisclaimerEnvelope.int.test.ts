/**
 * BUG-284 regression — `/scribe/patient-summary` and
 * `/scribe/referral-letter` response envelopes must carry the
 * canonical `disclaimer: CLINICAL_AI_DISCLAIMER` field.
 *
 * Pre-fix: both handlers returned `{summary|letter, ..., isAiDraft: true}`
 * with NO `disclaimer` field, breaking parity with /suggest,
 * /clinical-ai, /agent (BUG-038 shipped the canonical disclaimer
 * there). Frontend had to hard-code the warning string; auditors
 * couldn't cross-reference AI-source signals across the scribe +
 * non-scribe LLM surfaces.
 *
 * Post-fix: both envelopes include `disclaimer: CLINICAL_AI_DISCLAIMER`
 * verbatim.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

// Hoisted mock for axios so /patient-summary + /referral-letter
// don't hit a real Ollama. The handler invokes axios.post(
// `${OLLAMA_URL}/api/generate`, ...) and reads resp.data.response.
const axiosMock = vi.hoisted(() => ({
  post: vi.fn(),
  default: { post: vi.fn() },
}));
vi.mock('axios', () => {
  return {
    default: { post: axiosMock.post },
    post: axiosMock.post,
  };
});

import request from 'supertest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import app from '../../src/server';
import { CLINICAL_AI_DISCLAIMER } from '../../src/shared/llmDisclaimer';
import { dbAdmin } from '../../src/db/db';

describe.skipIf(!(await isIntegrationReady()))('BUG-284 scribe disclaimer envelope parity', () => {
  let token: string;
  let clinicId: string;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;

    // Enable the 'ai-scribe' feature flag for this clinic so the
    // scribe router's requireFeatureEnabled guard lets the test
    // reach the handler. Same pattern as the BUG-038 test suite.
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

    // Default axios mock — returns an Ollama-shaped response.
    axiosMock.post.mockResolvedValue({ data: { response: 'Synthetic clinical output for BUG-284 test.' } });
  });

  const baseStructured = {
    subjective: 'Patient reports low mood.',
    objective: 'Appears tired.',
    assessment: 'Depressive episode.',
    plan: 'Continue sertraline 50mg; review in 2 weeks.',
  };

  it('T1 — /scribe/patient-summary envelope carries canonical disclaimer', async () => {
    const res = await request(app)
      .post('/api/v1/scribe/patient-summary')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ structuredNote: baseStructured });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(res.body.isAiDraft).toBe(true);
    expect(res.body.disclaimer).toBe(CLINICAL_AI_DISCLAIMER);
  });

  it('T2 — /scribe/referral-letter envelope carries canonical disclaimer', async () => {
    const res = await request(app)
      .post('/api/v1/scribe/referral-letter')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({
        structuredNote: baseStructured,
        recipientType: 'gp',
        recipientName: 'Dr Example',
        reason: 'Ongoing management.',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('letter');
    expect(res.body.isAiDraft).toBe(true);
    expect(res.body.disclaimer).toBe(CLINICAL_AI_DISCLAIMER);
  });

  it('T3 — disclaimer is literally CLINICAL_AI_DISCLAIMER (no inline-literal drift)', async () => {
    const res = await request(app)
      .post('/api/v1/scribe/patient-summary')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({ structuredNote: baseStructured });

    expect(res.body.disclaimer).toBe(
      'AI-generated — verify against current clinical guidelines before acting',
    );
  });

  // Clean up any seeded rows (none in this test — all reads).
  it.skip('cleanup', async () => { void dbAdmin; });
});
