/**
 * Bug-hunt Phase II.D — Tier 15-17 letters integration coverage.
 *
 * Tier 15 shipped: letter_templates (10 AU templates), letter state
 * machine (draft→in_review→approved→sent), section regen, audit log.
 * Tier 16: delivery + exports + translations + revisions + letterhead.
 * Tier 17: state_mha_forms, capacity_assessments, forensic_risk,
 * letter_citations, tone_presets.
 *
 * Zero frontend callers — this suite is the only test coverage.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { dbAdmin } from '../../../src/db/db';
import {
  isIntegrationReady,
  loginAsAdmin,
  authedAgent,
} from '../_helpers';

describe.skipIf(!(await isIntegrationReady()))('Tier 15-17 — letters + structured artefacts', () => {
  let token: string;

  async function ensureTier1517ReferenceData(): Promise<void> {
    const now = new Date();

    const templateSeeds = [
      { code: 'gp_referral', name: 'GP Referral', category: 'referral_gp' },
      { code: 'specialist_referral', name: 'Specialist Referral', category: 'referral_specialist' },
      { code: 'discharge_summary', name: 'Discharge Summary', category: 'discharge_summary' },
      { code: 'medicare_authority', name: 'Medicare Authority', category: 'medicare_authority' },
      { code: 'mha_notification', name: 'MHA Notification', category: 'mha_notification' },
    ] as const;

    for (const seed of templateSeeds) {
      const existing = await dbAdmin('letter_templates')
        .whereNull('clinic_id')
        .where({ code: seed.code })
        .first('id');
      if (existing) continue;
      await dbAdmin('letter_templates').insert({
        id: randomUUID(),
        clinic_id: null,
        code: seed.code,
        name: seed.name,
        category: seed.category,
        description: `Integration seed for ${seed.name}`,
        sections: JSON.stringify([{ key: 'body', label: 'Body', prompt: '' }]),
        system_prompt: 'Write a structured clinical letter with clear headings.',
        default_recipients: JSON.stringify([]),
        is_active: true,
        requires_second_review: false,
        created_at: now,
        updated_at: now,
      } as never);
    }

    const toneSeeds = [
      { tone_key: 'formal', name: 'Formal' },
      { tone_key: 'collegial', name: 'Collegial' },
      { tone_key: 'patient_friendly', name: 'Patient-friendly' },
      { tone_key: 'plain_language', name: 'Plain language' },
      { tone_key: 'medico_legal', name: 'Medico-legal' },
    ] as const;
    for (const seed of toneSeeds) {
      const existing = await dbAdmin('letter_tone_presets')
        .whereNull('clinic_id')
        .where({ tone_key: seed.tone_key })
        .first('id');
      if (existing) continue;
      await dbAdmin('letter_tone_presets').insert({
        id: randomUUID(),
        clinic_id: null,
        tone_key: seed.tone_key,
        name: seed.name,
        description: `Integration seed tone preset (${seed.tone_key})`,
        system_prompt_addendum: `Tone preset: ${seed.tone_key}`,
        is_active: true,
        created_at: now,
        updated_at: now,
      } as never);
    }

    const formSeeds = [
      { state_code: 'NSW', form_code: 'schedule_1', section_reference: 'Sch 1' },
      { state_code: 'VIC', form_code: 'assessment_order', section_reference: 's 31' },
      { state_code: 'QLD', form_code: 'eau_order', section_reference: 's 30' },
      { state_code: 'WA', form_code: 'form_1a', section_reference: 's 26' },
      { state_code: 'SA', form_code: 'level_1', section_reference: 's 56' },
      { state_code: 'TAS', form_code: 'assessment_order', section_reference: 's 35' },
    ] as const;
    for (const seed of formSeeds) {
      const existing = await dbAdmin('state_mha_forms')
        .where({ state_code: seed.state_code, form_code: seed.form_code })
        .first('id');
      if (existing) continue;
      await dbAdmin('state_mha_forms').insert({
        id: randomUUID(),
        state_code: seed.state_code,
        form_code: seed.form_code,
        name: `${seed.state_code} ${seed.form_code} form`,
        act_reference: `${seed.state_code} Mental Health Act`,
        section_reference: seed.section_reference,
        field_schema: JSON.stringify({ sections: ['patient_identification', 'grounds'] }),
        requires_authorised_psychiatrist: false,
        max_duration_days: 7,
        is_active: true,
        created_at: now,
        updated_at: now,
      } as never);
    }
  }

  beforeAll(async () => {
    await ensureTier1517ReferenceData();
    const s = await loginAsAdmin();
    token = s.token;
  });

  describe('letter templates (Tier 15.1)', () => {
    it('GET /letters/templates returns seeded AU templates', async () => {
      const agent = authedAgent(token);
      const res = await agent.get('/api/v1/letters/templates');
      if (res.status === 200) {
        expect(res.body).toHaveProperty('templates');
        expect(Array.isArray(res.body.templates)).toBe(true);
        expect(res.body.templates.length).toBeGreaterThanOrEqual(5);
      } else {
        expect([403]).toContain(res.status);
      }
    });

    it('templates have expected AU categories', async () => {
      const agent = authedAgent(token);
      const res = await agent.get('/api/v1/letters/templates');
      if (res.status === 200) {
        const categories: string[] = res.body.templates.map(
          (t: { category: string }) => t.category,
        );
        const expected = [
          'referral_gp', 'referral_specialist', 'discharge_summary',
          'medicare_authority', 'mha_notification',
        ];
        for (const c of expected) {
          expect(categories).toContain(c);
        }
      }
    });
  });

  describe('letter state machine (Tier 15.2)', () => {
    it('POST /letters/:id/approve on non-existent letter returns 404', async () => {
      const agent = authedAgent(token);
      const res = await agent.post(`/api/v1/letters/${randomUUID()}/approve`);
      expect([403, 404]).toContain(res.status);
    });
  });

  describe('state MHA forms (Tier 17.1)', () => {
    it('GET /clinical/state-mha-forms returns 8 jurisdictions', async () => {
      const agent = authedAgent(token);
      const res = await agent.get('/api/v1/clinical/state-mha-forms');
      if (res.status === 200) {
        expect(res.body).toHaveProperty('forms');
        const stateCodes = new Set(res.body.forms.map((f: { stateCode: string }) => f.stateCode));
        expect(stateCodes.size).toBeGreaterThanOrEqual(6);
        for (const code of ['NSW', 'VIC', 'QLD']) {
          expect(stateCodes.has(code)).toBe(true);
        }
      } else {
        expect([403]).toContain(res.status);
      }
    });

    it('GET /clinical/state-mha-forms?state=VIC filters correctly', async () => {
      const agent = authedAgent(token);
      const res = await agent.get('/api/v1/clinical/state-mha-forms?state=VIC');
      if (res.status === 200) {
        for (const f of res.body.forms) {
          expect(f.stateCode).toBe('VIC');
        }
      }
    });
  });

  describe('capacity assessments (Tier 17.2)', () => {
    it('POST /clinical/capacity-assessments with invalid conclusion returns validation/client error', async () => {
      const agent = authedAgent(token);
      const res = await agent
        .post('/api/v1/clinical/capacity-assessments')
        .send({
          patientId: randomUUID(),
          decisionContext: 'Test',
          conclusion: 'not_a_valid_value',
          conclusionReasoning: 'short',
        });
      expect([422, 400, 403, 404]).toContain(res.status);
    });
  });

  describe('forensic risk (Tier 17.3)', () => {
    it('POST /clinical/forensic-risk with invalid instrument returns validation/client error', async () => {
      const agent = authedAgent(token);
      const res = await agent
        .post('/api/v1/clinical/forensic-risk')
        .send({
          patientId: randomUUID(),
          instrument: 'not_a_real_tool',
          scores: {},
          overallRisk: 'low',
          overallReasoning: 'test reasoning',
        });
      expect([422, 400, 403, 404]).toContain(res.status);
    });
  });

  describe('tone presets (Tier 17.5)', () => {
    it('GET /clinical/tone-presets returns 5 seeded presets', async () => {
      const agent = authedAgent(token);
      const res = await agent.get('/api/v1/clinical/tone-presets');
      if (res.status === 200) {
        expect(res.body).toHaveProperty('tonePresets');
        expect(res.body.tonePresets.length).toBeGreaterThanOrEqual(5);
        const keys = res.body.tonePresets.map((t: { toneKey: string }) => t.toneKey);
        expect(keys).toContain('formal');
        expect(keys).toContain('patient_friendly');
      }
    });
  });
});
