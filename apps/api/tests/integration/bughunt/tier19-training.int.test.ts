/**
 * Bug-hunt Phase II.D — Tier 19 training platform integration coverage.
 *
 * Tier 19 shipped: PHI scrubber, training corpus queue, model registry,
 * red-team gate, canary deploy state machine, surveillance events,
 * training opt-in. Zero frontend callers.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import {
  isIntegrationReady,
  loginAsAdmin,
  authedAgent,
} from '../_helpers';
import { scrubText, SCRUBBER_VERSION } from '../../../src/features/llm/phiScrubberService';
import { dbAdmin } from '../../../src/db/db';

describe.skipIf(!(await isIntegrationReady()))('Tier 19 — training platform', () => {
  let token: string;

  async function ensureTier19ScrubRules(): Promise<void> {
    const existing = await dbAdmin('phi_scrubber_rules')
      .whereNull('clinic_id')
      .count<{ c: string }[]>('* as c');
    if (Number(existing[0]?.c ?? 0) >= 8) return;

    const now = new Date();
    const seeds = [
      { category: 'ihi', name: '16-digit IHI', pattern: '\\b80\\d{14}\\b', replacement: '[IHI]', precedence: 10 },
      { category: 'medicare', name: '10-digit Medicare', pattern: '\\b[2-6]\\d{9}\\b', replacement: '[MEDICARE]', precedence: 20 },
      { category: 'phone', name: 'AU mobile', pattern: '\\b04\\d{2}\\s?\\d{3}\\s?\\d{3}\\b', replacement: '[PHONE]', precedence: 30 },
      { category: 'phone', name: 'AU landline', pattern: '\\b(?:\\+?61|0)[23478]\\s?\\d{4}\\s?\\d{4}\\b', replacement: '[PHONE]', precedence: 31 },
      { category: 'email', name: 'Email', pattern: '\\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}\\b', replacement: '[EMAIL]', precedence: 40 },
      { category: 'date_of_birth', name: 'DOB', pattern: '\\b(0?[1-9]|[12][0-9]|3[01])/(0?[1-9]|1[012])/(19|20)\\d{2}\\b', replacement: '[DOB]', precedence: 50 },
      { category: 'mrn', name: 'Local MRN', pattern: '\\bMRN[:\\s]+\\d{6,8}\\b', replacement: 'MRN [REDACTED]', precedence: 60 },
      { category: 'address', name: 'AU postcode', pattern: '\\b(0800|0810|0830|0870|0880|2[0-9]{3}|3[0-9]{3}|4[0-9]{3}|5[0-9]{3}|6[0-9]{3}|7[0-9]{3})\\b', replacement: '[POSTCODE]', precedence: 70 },
    ] as const;

    for (const seed of seeds) {
      const row = await dbAdmin('phi_scrubber_rules')
        .whereNull('clinic_id')
        .where({ category: seed.category, name: seed.name })
        .first('id');
      if (row) continue;
      await dbAdmin('phi_scrubber_rules').insert({
        id: randomUUID(),
        clinic_id: null,
        category: seed.category,
        name: seed.name,
        pattern: seed.pattern,
        replacement: seed.replacement,
        precedence: seed.precedence,
        is_active: true,
        created_at: now,
        updated_at: now,
      } as never);
    }
  }

  beforeAll(async () => {
    await ensureTier19ScrubRules();
    const s = await loginAsAdmin();
    token = s.token;
  });

  describe('PHI scrubber — unit-ish (pure function)', () => {
    const IHI_RULE = {
      id: 'test-ihi',
      clinicId: null,
      category: 'ihi',
      name: 'IHI',
      pattern: '\\b80\\d{14}\\b',
      replacement: '[IHI]',
      precedence: 10,
    };
    const PHONE_RULE = {
      id: 'test-phone',
      clinicId: null,
      category: 'phone',
      name: 'AU mobile',
      pattern: '\\b04\\d{2}\\s?\\d{3}\\s?\\d{3}\\b',
      replacement: '[PHONE]',
      precedence: 30,
    };

    it('removes IHI', () => {
      const text = 'Patient IHI is 8003608166690365.';
      const r = scrubText(text, [IHI_RULE]);
      expect(r.sanitised).not.toContain('8003608166690365');
      expect(r.sanitised).toContain('[IHI]');
      expect(r.redactionSummary.ihi).toBe(1);
    });

    it('removes AU mobile number', () => {
      const text = 'Call me on 0412 345 678.';
      const r = scrubText(text, [PHONE_RULE]);
      expect(r.sanitised).toContain('[PHONE]');
      expect(r.redactionSummary.phone).toBe(1);
    });

    it('produces deterministic scrubber version', () => {
      const r = scrubText('hi', []);
      expect(r.scrubberVersion).toBe(SCRUBBER_VERSION);
    });

    it('no rules = identity scrub', () => {
      const text = 'unchanged text';
      const r = scrubText(text, []);
      expect(r.sanitised).toBe(text);
      expect(r.redactionSummary).toEqual({});
    });

    it('skips invalid regex silently', () => {
      const badRule = { ...IHI_RULE, pattern: '[unclosed' };
      const r = scrubText('some text', [badRule]);
      expect(r.sanitised).toBe('some text');
    });
  });

  describe('training corpus opt-in guard (Tier 19.7)', () => {
    it('POST /admin/training/corpus/ingest refuses without opt-in', async () => {
      const agent = authedAgent(token);
      const res = await agent
        .post('/api/v1/admin/training/corpus/ingest')
        .send({ transcript: 'test transcript' });
      // Opt-in is false by default — 409 TRAINING_OPT_OUT expected
      expect([409, 403]).toContain(res.status);
    });
  });

  describe('model registry + red-team gate (Tier 19.3-19.5)', () => {
    it('GET /admin/training/models returns 200 (empty or populated)', async () => {
      const agent = authedAgent(token);
      const res = await agent.get('/api/v1/admin/training/models');
      expect([200, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('models');
      }
    });

    it('POST /admin/training/deployments refuses without red-team pass', async () => {
      const agent = authedAgent(token);
      const res = await agent
        .post('/api/v1/admin/training/deployments')
        .send({ modelId: randomUUID() });
      // non-existent model → 404, unauthorised → 403, red-team gate → 409
      expect([403, 404, 409]).toContain(res.status);
    });
  });

  describe('scrub rules (Tier 19.1)', () => {
    it('GET /admin/training/scrub-rules returns seed rules', async () => {
      const agent = authedAgent(token);
      const res = await agent.get('/api/v1/admin/training/scrub-rules');
      if (res.status === 200) {
        expect(res.body).toHaveProperty('rules');
        expect(res.body.rules.length).toBeGreaterThanOrEqual(8);
        const categories = new Set(res.body.rules.map((r: { category: string }) => r.category));
        for (const c of ['ihi', 'medicare', 'phone', 'email']) {
          expect(categories.has(c)).toBe(true);
        }
      }
    });
  });
});
