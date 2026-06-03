/**
 * BUG-457 — LlmFeature / LLMInteraction enum drift integration tests.
 *
 * Pre-fix the SSoT `LlmFeatureSchema` enumerates 6 values
 * (`ambient_note, suggestion, summarisation, risk_flag, coding_assist,
 * other`) while production code writes 12 different shapes — none of
 * which match. The frontend `LLMInteractionSchema` redeclares a
 * fictional 7-value taxonomy with zero overlap with the SSoT and zero
 * consumers. POST `/llm/interactions` 422s on every realistic feature
 * value.
 *
 * Post-fix: SSoT is widened to UNION of historical enum + production
 * literals + 3 template-regex patterns + free-form fallback. Frontend
 * dead-code removed. `mapInteraction` runs `safeParse` on emit.
 *
 * Pre-fix RED gate:
 *   - LI-1 (POST feature='ambient'): 422 invalid_enum_value
 *   - LI-2 (POST feature='document_handover-summary'): 422
 *   - LI-3 (POST feature='risk_flag'): 201 (back-compat path — passes today)
 *   - LI-4 (GET /llm/usage): 200 (permissive response — passes today)
 *   - LI-5 (frontend file does not contain LLMInteractionSchema): FAILS today
 *
 * Post-fix: 5/5 GREEN.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { LlmInteractionResponseSchema, LlmInteractionSummaryResponseSchema } from '@signacare/shared';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

const TEST_LABEL = `BUG-457-${Date.now()}`;
let token = '';
let clinicId = '';

const auth = (): { post: (p: string) => request.Test; get: (p: string) => request.Test } => ({
  post: (p) =>
    request(app)
      .post(p)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test'),
  get: (p) =>
    request(app)
      .get(p)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test'),
});

describe.skipIf(!READY)('BUG-457 — LlmFeature / LLMInteraction SSoT alignment', () => {
  beforeAll(async () => {
    const sess = await loginAsAdmin();
    token = sess.token;
    clinicId = sess.clinicId;
  });

  afterAll(async () => {
    if (!READY) return;
    try {
      await dbAdmin('llm_interactions')
        .where({ clinic_id: clinicId })
        .where('model_name', 'like', `${TEST_LABEL}%`)
        .delete();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[BUG-457 cleanup]', err instanceof Error ? err.message : err);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // LI-1 — POST with production literal `'ambient'`. Pre-fix: 422 (not in
  // SSoT enum). Post-fix: 201 (UNION admits production literal).
  // ────────────────────────────────────────────────────────────────────────
  it("LI-1 POST /llm/interactions accepts feature='ambient' (production literal)", async () => {
    const res = await auth()
      .post('/api/v1/llm/interactions')
      .send({
        feature: 'ambient',
        modelName: `${TEST_LABEL}-li1`,
        success: true,
      });
    expect([200, 201]).toContain(res.status);
    const parsed = LlmInteractionResponseSchema.safeParse(res.body);
    if (!parsed.success) {
      // eslint-disable-next-line no-console
      console.error('Zod issues:', JSON.stringify(parsed.error.issues, null, 2));
    }
    expect(parsed.success).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────
  // LI-2 — POST with template literal `'document_*'`. Pre-fix: 422.
  // Post-fix: 201 (UNION includes regex member /^document_[a-z0-9_-]+$/).
  // ────────────────────────────────────────────────────────────────────────
  it("LI-2 POST /llm/interactions accepts feature='document_handover-summary' (regex member)", async () => {
    const res = await auth()
      .post('/api/v1/llm/interactions')
      .send({
        feature: 'document_handover-summary',
        modelName: `${TEST_LABEL}-li2`,
        success: true,
      });
    expect([200, 201]).toContain(res.status);
  });

  // ────────────────────────────────────────────────────────────────────────
  // LI-3 — POST with legacy SSoT value. Already passes today; this is
  // the back-compat regression-trap.
  // ────────────────────────────────────────────────────────────────────────
  it("LI-3 POST /llm/interactions accepts feature='risk_flag' (back-compat)", async () => {
    const res = await auth()
      .post('/api/v1/llm/interactions')
      .send({
        feature: 'risk_flag',
        modelName: `${TEST_LABEL}-li3`,
        success: true,
      });
    expect([200, 201]).toContain(res.status);
  });

  // ────────────────────────────────────────────────────────────────────────
  // LI-4 — GET /llm/usage round-trip — response satisfies SSoT. Permissive
  // today; regression-trap for future tightening.
  // ────────────────────────────────────────────────────────────────────────
  it('LI-4 GET /llm/usage response satisfies LlmInteractionSummaryResponseSchema', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await auth().get(`/api/v1/llm/usage?dateFrom=${today}&dateTo=${today}`);
    expect(res.status).toBe(200);
    const parsed = LlmInteractionSummaryResponseSchema.safeParse(res.body);
    if (!parsed.success) {
      // eslint-disable-next-line no-console
      console.error('Zod issues:', JSON.stringify(parsed.error.issues, null, 2));
    }
    expect(parsed.success).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────
  // LI-5 — Frontend file invariant: the redeclared `LLMInteractionSchema`
  // and `LLMInteraction` MUST be deleted. This is a static check that
  // reads the file from disk and greps for the symbols.
  // Pre-fix: FAILS (declarations present at lines 71-80).
  // Post-fix: PASSES (deleted).
  // ────────────────────────────────────────────────────────────────────────
  it('LI-5 frontend llmTypes.ts does NOT redeclare LLMInteractionSchema', () => {
    const file = readFileSync(
      resolve(__dirname, '../../../web/src/features/llm/types/llmTypes.ts'),
      'utf8',
    );
    expect(file).not.toMatch(/^export const LLMInteractionSchema\b/m);
    expect(file).not.toMatch(/^export type LLMInteraction\s*=/m);
    // LLMSuggestionType MUST stay (UI state machine taxonomy)
    expect(file).toMatch(/^export const LLMSuggestionTypeSchema\b/m);
  });
});
