/**
 * USER-A.3 absorb-1 regression — cross-episode PHI isolation in
 * clinical-note snippet builders.
 *
 * Pre-fix: buildOutcomesSnippet / buildRiskSnippet / buildMedicationsSnippet
 * queried tables WHERE clinic_id + patient_id only. Composing a clinical
 * note in Episode B and invoking Alt+Shift+O/R/M surfaced data from
 * Episode A — same class of APP 11 segmentation breach across three
 * snippet paths. Initial commit 3d3bac1 fixed outcomes only; L3+L4+L5
 * review REJECTED with "fix is incomplete — same S0 class remains on
 * risk + meds". This test pins the COMPLETE fix across all three.
 *
 * Coverage:
 *   S1 — outcomes: seed 2 episodes w/ outcome_measures on each; call
 *        GET /clinical-notes/patient/:id/snippets?types=outcomes&episodeId=B.
 *        Assert the returned outcomes snippet contains ONLY B's record.
 *   S2 — risk: same shape, seed 2 risk_assessments, assert B-only.
 *   S3 — meds: same shape, seed 2 patient_medications, assert B-only.
 *   S4 — legacy path: when episodeId is OMITTED from the query string,
 *        all three builders return both episodes' data (backward-compat
 *        for pre-episode intake flows). Pins that the fix is OPT-IN.
 *   S5 — route-level UUID validation: GET …?episodeId=not-a-uuid
 *        returns 400, not 500. Pins the L5 "implicit validation"
 *        finding.
 *
 * HTTP-level (supertest) so rlsMiddleware sets app.clinic_id correctly.
 * Calling the builders directly from test code would bypass RLS.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import type { NoteSnippet } from '../../src/features/clinical-notes/noteSnippets';

interface SnippetsResponse {
  snippets: NoteSnippet[];
}

const READY = await isIntegrationReady();

describe.skipIf(!READY)('USER-A.3 cross-episode PHI isolation (absorb-1)', () => {
  let clinicId: string;
  let adminStaffId: string;
  let token: string;
  let patientId: string;
  let episodeAId: string;
  let episodeBId: string;
  const outcomeARowId = randomUUID();
  const outcomeBRowId = randomUUID();
  const riskARowId = randomUUID();
  const riskBRowId = randomUUID();
  const medARowId = randomUUID();
  const medBRowId = randomUUID();

  async function getSnippets(types: string, episodeId?: string) {
    const q: Record<string, string> = { types };
    if (episodeId !== undefined) q.episodeId = episodeId;
    return request(app)
      .get(`/api/v1/clinical-notes/patient/${patientId}/snippets`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .query(q);
  }

  beforeAll(async () => {
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;
    adminStaffId = session.userId;

    const { dbAdmin } = await import('../../src/db/db');

    patientId = randomUUID();
    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: clinicId,
      given_name: 'NoteSnippetTest',
      family_name: 'Regression',
      date_of_birth: '1980-01-01',
    });

    episodeAId = randomUUID();
    episodeBId = randomUUID();
    await dbAdmin('episodes').insert([
      {
        id: episodeAId,
        clinic_id: clinicId,
        patient_id: patientId,
        status: 'closed',
        episode_type: 'community',
        start_date: '2024-01-01',
        end_date: '2024-06-30',
        title: 'Episode A',
      },
      {
        id: episodeBId,
        clinic_id: clinicId,
        patient_id: patientId,
        status: 'open',
        episode_type: 'community',
        start_date: '2024-07-01',
        title: 'Episode B',
      },
    ]);

    await dbAdmin('outcome_measures').insert([
      {
        id: outcomeARowId, clinic_id: clinicId, patient_id: patientId,
        episode_id: episodeAId, measure_type: 'honos',
        collection_occasion: 'review', total_score: 11, items: {},
        template_name: 'HoNOS-A', created_at: new Date('2024-02-15'),
      },
      {
        id: outcomeBRowId, clinic_id: clinicId, patient_id: patientId,
        episode_id: episodeBId, measure_type: 'honos',
        collection_occasion: 'admission', total_score: 22, items: {},
        template_name: 'HoNOS-B', created_at: new Date('2024-07-15'),
      },
    ]);

    await dbAdmin('risk_assessments').insert([
      {
        id: riskARowId, clinic_id: clinicId, patient_id: patientId,
        episode_id: episodeAId, assessment_type: 'clinical',
        overall_risk_level: 'low', risk_narrative: 'Narrative A',
        assessed_by_id: adminStaffId, assessment_date: '2024-02-10',
      },
      {
        id: riskBRowId, clinic_id: clinicId, patient_id: patientId,
        episode_id: episodeBId, assessment_type: 'clinical',
        overall_risk_level: 'high', risk_narrative: 'Narrative B',
        assessed_by_id: adminStaffId, assessment_date: '2024-07-10',
      },
    ]);

    await dbAdmin('patient_medications').insert([
      {
        id: medARowId, clinic_id: clinicId, patient_id: patientId,
        episode_id: episodeAId, drug_label: 'DrugA 10mg',
        dose: '10mg', frequency: 'daily', route: 'oral',
        status: 'active', start_date: '2024-02-01',
      },
      {
        id: medBRowId, clinic_id: clinicId, patient_id: patientId,
        episode_id: episodeBId, drug_label: 'DrugB 25mg',
        dose: '25mg', frequency: 'twice-daily', route: 'oral',
        status: 'active', start_date: '2024-07-01',
      },
    ]);
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('patient_medications').whereIn('id', [medARowId, medBRowId]).delete();
    await dbAdmin('risk_assessments').whereIn('id', [riskARowId, riskBRowId]).delete();
    await dbAdmin('outcome_measures').whereIn('id', [outcomeARowId, outcomeBRowId]).delete();
    await dbAdmin('episodes').whereIn('id', [episodeAId, episodeBId]).delete();
    await dbAdmin('patients').where({ id: patientId }).delete();
  });

  it('S1 — outcomes snippet scoped to Episode B excludes Episode A scores', async () => {
    const res = await getSnippets('outcomes', episodeBId);
    expect(res.status).toBe(200);
    const body = res.body as SnippetsResponse;
    const s = body.snippets.find((x) => x.type === 'outcomes');
    expect(s).toBeDefined();
    expect(s!.text).toContain('HoNOS-B');
    expect(s!.text).toContain('22');
    expect(s!.text).not.toContain('HoNOS-A');
    expect(s!.text).not.toContain('HoNOS-A: 11.00');
    expect(s!.recordCount).toBe(1);
  });

  it('S2 — risk snippet scoped to Episode B excludes Episode A assessment', async () => {
    const res = await getSnippets('risk', episodeBId);
    expect(res.status).toBe(200);
    const body = res.body as SnippetsResponse;
    const s = body.snippets.find((x) => x.type === 'risk');
    expect(s).toBeDefined();
    // Post-absorb: builder must use overall_risk_level (not 'severity'),
    // must omit the non-existent 'domains', and must be episode-scoped.
    expect(s!.text).toContain('high');
    expect(s!.text).toContain('Narrative B');
    expect(s!.text).not.toContain('low');
    expect(s!.text).not.toContain('Narrative A');
    expect(s!.recordCount).toBe(1);
  });

  it('S3 — medications snippet scoped to Episode B excludes Episode A active meds', async () => {
    const res = await getSnippets('meds', episodeBId);
    expect(res.status).toBe(200);
    const body = res.body as SnippetsResponse;
    const s = body.snippets.find((x) => x.type === 'meds');
    expect(s).toBeDefined();
    expect(s!.text).toContain('DrugB 25mg');
    expect(s!.text).not.toContain('DrugA 10mg');
    expect(s!.recordCount).toBe(1);
  });

  it('S4 — legacy path (episodeId omitted) returns both episodes for backward compat', async () => {
    const res = await getSnippets('outcomes,risk,meds');
    expect(res.status).toBe(200);
    const body = res.body as SnippetsResponse;
    const outcomes = body.snippets.find((x) => x.type === 'outcomes')!;
    const risk = body.snippets.find((x) => x.type === 'risk')!;
    const meds = body.snippets.find((x) => x.type === 'meds')!;

    expect(outcomes.recordCount).toBe(2);
    expect(outcomes.text).toContain('HoNOS-A');
    expect(outcomes.text).toContain('HoNOS-B');

    // Risk is .first() — returns the most recent across both episodes
    expect(risk.recordCount).toBe(1);
    expect(risk.text).toContain('Narrative B');

    expect(meds.recordCount).toBe(2);
    expect(meds.text).toContain('DrugA 10mg');
    expect(meds.text).toContain('DrugB 25mg');
  });

  it('S5 — /snippets route rejects malformed episodeId with 400 at boundary (not 500 from DB)', async () => {
    const res = await getSnippets('outcomes', 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
