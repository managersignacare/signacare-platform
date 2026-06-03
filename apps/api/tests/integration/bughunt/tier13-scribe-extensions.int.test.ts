/**
 * Bug-hunt Phase II.D — Tier 13 scribe extensions integration coverage.
 *
 * Tier 13 shipped: sensitive-flag detector (10 categories), action-items
 * lifecycle, talk-time metrics, semantic search, note templates.
 * Zero frontend callers — this suite provides end-to-end coverage.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import {
  isIntegrationReady,
  loginAsAdmin,
  authedAgent,
} from '../_helpers';
import { scanTranscriptForSensitiveTopics } from '../../../src/features/llm/scribeSafetyService';

describe.skipIf(!(await isIntegrationReady()))('Tier 13 — scribe extensions', () => {
  let token: string;

  async function ensureTier13NoteTemplates(): Promise<void> {
    const { dbAdmin } = await import('../../../src/db/db');
    const requiredVariants = ['psychiatric', 'nursing', 'psychology'] as const;
    const existingRows = await dbAdmin('scribe_note_templates')
      .whereNull('clinic_id')
      .whereIn('variant', [...requiredVariants])
      .select('variant') as Array<{ variant: string }>;
    const existingVariants = new Set(existingRows.map((row) => row.variant));
    const now = new Date();

    for (const variant of requiredVariants) {
      if (existingVariants.has(variant)) continue;
      await dbAdmin('scribe_note_templates').insert({
        id: randomUUID(),
        clinic_id: null,
        variant,
        name: `${variant} template`,
        system_prompt: `${variant} system prompt`,
        user_prompt_template: `${variant} user prompt template`,
        sections: JSON.stringify(['history', 'mental_state_exam', 'plan']),
        is_active: true,
        created_at: now,
        updated_at: now,
      });
    }
  }

  beforeAll(async () => {
    const s = await loginAsAdmin();
    token = s.token;
    await ensureTier13NoteTemplates();
  });

  describe('sensitive-topic detector (Tier 13.1)', () => {
    it('scans transcript — empty transcript produces 0 flags', () => {
      const flags = scanTranscriptForSensitiveTopics('Hello, how are you today?');
      expect(Array.isArray(flags)).toBe(true);
      expect(flags).toHaveLength(0);
    });

    it('detects suicide_intent with critical modifier "tonight"', () => {
      const flags = scanTranscriptForSensitiveTopics(
        "I've been thinking I want to kill myself tonight.",
      );
      expect(flags.length).toBeGreaterThan(0);
      const suicide = flags.find((f) => f.category === 'suicide_intent');
      expect(suicide).toBeTruthy();
      expect(suicide!.severity).toBe('critical');
    });

    it('detects self_harm with moderate severity when no modifier', () => {
      const flags = scanTranscriptForSensitiveTopics('I have been cutting for a while.');
      const sh = flags.find((f) => f.category === 'self_harm');
      expect(sh).toBeTruthy();
      expect(sh!.severity).toBe('moderate');
    });

    it('detects domestic_violence', () => {
      const flags = scanTranscriptForSensitiveTopics('My partner hits me when drunk.');
      const dv = flags.find((f) => f.category === 'domestic_violence');
      expect(dv).toBeTruthy();
    });

    it('captures transcript offset + snippet', () => {
      const t = 'some text then kill myself here';
      const flags = scanTranscriptForSensitiveTopics(t);
      expect(flags[0]?.transcriptOffset).toBeGreaterThanOrEqual(0);
      expect(flags[0]?.snippet).toContain('kill myself');
    });

    it('POST /scribe/session/:id/scan accepts transcript', async () => {
      const agent = authedAgent(token);
      const res = await agent
        .post(`/api/v1/scribe/session/${randomUUID()}/scan`)
        .send({ transcript: 'Hello' });
      // No session exists → 404, or feature disabled → 403
      expect([200, 403, 404]).toContain(res.status);
    });
  });

  describe('action items (Tier 13.2)', () => {
    it('PATCH /scribe/action-items/:id/review with invalid status returns 422', async () => {
      const agent = authedAgent(token);
      const res = await agent
        .patch(`/api/v1/scribe/action-items/${randomUUID()}/review`)
        .send({ status: 'invalid_status' });
      expect([422, 403]).toContain(res.status);
    });
  });

  describe('semantic search (Tier 13.3)', () => {
    it('POST /scribe/search requires 1536-dim embedding', async () => {
      const agent = authedAgent(token);
      const res = await agent
        .post('/api/v1/scribe/search')
        .send({ embedding: [0.1, 0.2], topK: 5, patientId: randomUUID() });
      // Too-small embedding → 422 (zod), or feature disabled → 403
      expect([422, 403]).toContain(res.status);
    });
  });

  describe('talk-time (Tier 13.4)', () => {
    it('PUT /scribe/session/:id/talk-time with negative seconds returns 422', async () => {
      const agent = authedAgent(token);
      const res = await agent
        .put(`/api/v1/scribe/session/${randomUUID()}/talk-time`)
        .send({
          clinicianSeconds: -1,
          patientSeconds: 100,
          silenceSeconds: 10,
          totalSeconds: 110,
        });
      expect([422, 403]).toContain(res.status);
    });
  });

  describe('note templates (Tier 13.5)', () => {
    it('GET /scribe/note-templates returns seeded variants', async () => {
      const agent = authedAgent(token);
      const res = await agent.get('/api/v1/scribe/note-templates');
      if (res.status === 200) {
        expect(res.body).toHaveProperty('templates');
        expect(Array.isArray(res.body.templates)).toBe(true);
        // 3 vendor-global seeded: psychiatric, nursing, psychology
        expect(res.body.templates.length).toBeGreaterThanOrEqual(3);
      } else {
        expect([403]).toContain(res.status);
      }
    });
  });
});
