import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

describe.skipIf(!(await isIntegrationReady()))('LLM prompt profiles (portable enterprise library)', () => {
  let token = '';
  let clinicId = '';

  beforeAll(async () => {
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;

    const existing = await dbAdmin('feature_flags')
      .where({ clinic_id: clinicId, name: 'ai-training' })
      .first('id');
    if (existing) {
      await dbAdmin('feature_flags')
        .where({ id: existing.id })
        .update({ enabled: true });
    } else {
      await dbAdmin('feature_flags').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        name: 'ai-training',
        enabled: true,
        rollout_percentage: 100,
      });
    }
  });

  it('T1 — GET /api/v1/llm/prompt-profiles returns enterprise profile catalog', async () => {
    const res = await request(app)
      .get('/api/v1/llm/prompt-profiles')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.profiles)).toBe(true);
    const ids = (res.body.profiles as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain('enterprise_dsm5_diagnostic_synthesis_v1');
    expect(ids).toContain('enterprise_longitudinal_summary_v1');
    expect(ids).toContain('enterprise_91_day_review_v1');
    expect(ids).toContain('enterprise_psychiatric_scribe_v1');
  });

  it('T2 — POST /api/v1/llm/prompt-profiles/apply upserts action prompts + writes portability manifest', async () => {
    const res = await request(app)
      .post('/api/v1/llm/prompt-profiles/apply')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({
        profileIds: ['enterprise_dsm5_diagnostic_synthesis_v1'],
        includeManifestInContext: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.appliedProfileIds).toContain('enterprise_dsm5_diagnostic_synthesis_v1');
    expect(Number(res.body.upsertedActions)).toBeGreaterThanOrEqual(1);
    expect(Number(res.body.manifestRowsWritten)).toBeGreaterThanOrEqual(1);

    const modelRow = await dbAdmin('ai_modelfiles')
      .where({ clinic_id: clinicId, action_type: 'report-insight' })
      .first('system_prompt');
    expect(typeof modelRow?.system_prompt).toBe('string');
    expect(String(modelRow?.system_prompt ?? '')).toContain('Zero hallucination');

    const manifestRow = await dbAdmin('ai_context_files')
      .where({
        clinic_id: clinicId,
        category: 'prompt_profile',
      })
      .where('title', 'like', 'Prompt Profile Manifest — enterprise_dsm5_diagnostic_synthesis_v1%')
      .first('content');
    expect(manifestRow).toBeTruthy();
    expect(String(manifestRow?.content ?? '')).toContain('libraryVersion');
  });
});

