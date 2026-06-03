/**
 * BUG-276 regression — patient-relationship gate on 2 previously-ungated
 * mutating endpoints (endpoint inventory frozen pre-kickoff per plan
 * Sub-cluster D).
 *
 * Gated endpoints:
 *   PATCH /letters/:id/sections/:sectionKey  — edit / regenerate section
 *   PATCH /scribe/session/:id                — session state transitions
 *
 * Pre-fix: both endpoints accepted any authenticated clinician in the
 * right clinic; the letter path enforced only tenant scope; the scribe
 * session path had an ownership check (clinician_id = req.user.id) but
 * not a care-relationship check.
 *
 * Post-fix: both call requirePatientRelationship(auth, patient_id)
 * BEFORE mutation. Matches BUG-036 3-scenario pattern per endpoint:
 *
 *   T1 — PATCH letters/:id/sections/:key as clinician with no relationship → 403
 *   T2 — PATCH letters/:id/sections/:key as admin (BYPASS_ROLES) → 200
 *   T3 — PATCH letters/:id/sections/:key as clinician with relationship → 200
 *   T4 — PATCH scribe/session/:id as clinician with no relationship → 403
 *   T5 — PATCH scribe/session/:id as admin (BYPASS_ROLES) → 200
 *   T6 — PATCH scribe/session/:id as originating clinician with relationship → 200
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-276 letter+scribe-session patient-relationship gate (live DB)', () => {
  let adminToken: string;
  let adminStaffId: string;
  let clinicId: string;
  let patientWithoutRel: string;
  let patientWithRel: string;
  let letterIdNoRel: string;
  let letterIdWithRel: string;
  let sectionKey: string;
  let sessionIdNoRel: string;
  let sessionIdWithRel: string;
  const seededStaffIds: string[] = [];
  const seededLetterIds: string[] = [];
  const seededSessionIds: string[] = [];
  let seededEpisodeId: string | null = null;
  let clinicianNoRelId: string;
  let clinicianNoRelToken: string;
  let clinicianWithRelId: string;
  let clinicianWithRelToken: string;
  let priorAiScribeFlag: {
    id: string;
    enabled: boolean;
    rollout_percentage: number;
  } | null = null;

  beforeAll(async () => {
    const adminSession = await loginAsAdmin();
    adminToken = adminSession.token;
    adminStaffId = adminSession.userId;
    clinicId = adminSession.clinicId;

    const { dbAdmin } = await import('../../src/db/db');

    // Determinism: this suite asserts relationship-gate behavior, so
    // the AI kill-switch must be ON for the clinic under test.
    const existingAiScribeFlag = await dbAdmin('feature_flags')
      .where({ clinic_id: clinicId, name: 'ai-scribe' })
      .first('id', 'enabled', 'rollout_percentage');
    if (existingAiScribeFlag) {
      priorAiScribeFlag = {
        id: existingAiScribeFlag.id as string,
        enabled: existingAiScribeFlag.enabled as boolean,
        rollout_percentage: Number(existingAiScribeFlag.rollout_percentage ?? 0),
      };
      await dbAdmin('feature_flags')
        .where({ id: existingAiScribeFlag.id })
        .update({ enabled: true, rollout_percentage: 100, updated_at: new Date() });
    } else {
      await dbAdmin('feature_flags').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        name: 'ai-scribe',
        description: 'BUG-276 integration precondition',
        enabled: true,
        rollout_percentage: 100,
      } as never);
    }

    // Use two distinct patients so clinician-with-rel can have a
    // relationship to one but not the other.
    const patients = await dbAdmin('patients')
      .where({ clinic_id: clinicId })
      .limit(2)
      .select('id');
    if (patients.length < 2) throw new Error('BUG-276: need 2 seeded patients');
    patientWithoutRel = patients[0].id as string;
    patientWithRel = patients[1].id as string;

    const bcrypt = (await import('bcryptjs')).default;
    const passwordHash = await bcrypt.hash('Password1!', 10);

    // Seed clinician with NO care relationship to patientWithoutRel.
    clinicianNoRelId = randomUUID();
    await dbAdmin('staff').insert({
      id: clinicianNoRelId,
      clinic_id: clinicId,
      given_name: 'BUG276NoRel',
      family_name: 'Clinician',
      email: `bug276-norel-${clinicianNoRelId.slice(0, 8)}@signacare.local`,
      password_hash: passwordHash,
      role: 'clinician',
      discipline: 'psychiatry',
    });
    seededStaffIds.push(clinicianNoRelId);

    // Seed clinician with a care relationship (episode) to patientWithRel.
    clinicianWithRelId = randomUUID();
    await dbAdmin('staff').insert({
      id: clinicianWithRelId,
      clinic_id: clinicId,
      given_name: 'BUG276WithRel',
      family_name: 'Clinician',
      email: `bug276-withrel-${clinicianWithRelId.slice(0, 8)}@signacare.local`,
      password_hash: passwordHash,
      role: 'clinician',
      discipline: 'psychiatry',
    });
    seededStaffIds.push(clinicianWithRelId);

    // Create an active episode with clinicianWithRel as primary clinician
    // → requirePatientRelationship will pass for patientWithRel.
    seededEpisodeId = randomUUID();
    await dbAdmin('episodes').insert({
      id: seededEpisodeId,
      clinic_id: clinicId,
      patient_id: patientWithRel,
      primary_clinician_id: clinicianWithRelId,
      episode_type: 'inpatient',
      status: 'active',
      start_date: new Date().toISOString().slice(0, 10),
      created_at: new Date(),
    } as never);

    // Login both clinicians to get tokens.
    const noRelLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({
        email: `bug276-norel-${clinicianNoRelId.slice(0, 8)}@signacare.local`,
        password: 'Password1!',
      });
    if (noRelLogin.status !== 200) {
      throw new Error(`BUG-276 noRel login failed: ${noRelLogin.status} ${JSON.stringify(noRelLogin.body)}`);
    }
    clinicianNoRelToken = noRelLogin.body.accessToken;

    const withRelLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({
        email: `bug276-withrel-${clinicianWithRelId.slice(0, 8)}@signacare.local`,
        password: 'Password1!',
      });
    if (withRelLogin.status !== 200) {
      throw new Error(`BUG-276 withRel login failed: ${withRelLogin.status} ${JSON.stringify(withRelLogin.body)}`);
    }
    clinicianWithRelToken = withRelLogin.body.accessToken;

    // Seed a letter for each patient + a section on each letter.
    sectionKey = 'body';
    letterIdNoRel = randomUUID();
    letterIdWithRel = randomUUID();
    // Grab any letter_templates row — test insert only needs an FK-valid
    // id. Fallback: create a throwaway template for the test.
    let templateId = (await dbAdmin('letter_templates').first('id'))?.id as string | undefined;
    if (!templateId) {
      templateId = randomUUID();
      await dbAdmin('letter_templates').insert({
        id: templateId,
        clinic_id: clinicId,
        code: 'BUG276',
        name: 'BUG-276 test template',
        category: 'referral_gp',
        description: 'BUG-276 fallback template',
        sections: JSON.stringify([{ key: 'body', label: 'Body', prompt: '' }]),
        system_prompt: 'Generate a concise clinical letter section.',
        default_recipients: JSON.stringify([]),
        is_active: true,
        requires_second_review: false,
        created_at: new Date(),
        updated_at: new Date(),
      } as never);
    }
    await dbAdmin('letters').insert([
      {
        id: letterIdNoRel,
        clinic_id: clinicId,
        patient_id: patientWithoutRel,
        author_id: adminStaffId,
        status: 'draft',
        template_id: templateId,
        subject: 'BUG-276 noRel letter',
      },
      {
        id: letterIdWithRel,
        clinic_id: clinicId,
        patient_id: patientWithRel,
        author_id: adminStaffId,
        status: 'draft',
        template_id: templateId,
        subject: 'BUG-276 withRel letter',
      },
    ] as never);
    seededLetterIds.push(letterIdNoRel, letterIdWithRel);
    await dbAdmin('letter_sections').insert([
      {
        id: randomUUID(),
        clinic_id: clinicId,
        letter_id: letterIdNoRel,
        section_key: sectionKey,
        label: 'Body',
        content: 'initial noRel',
        section_order: 1,
      },
      {
        id: randomUUID(),
        clinic_id: clinicId,
        letter_id: letterIdWithRel,
        section_key: sectionKey,
        label: 'Body',
        content: 'initial withRel',
        section_order: 1,
      },
    ] as never);

    // Seed two scribe sessions — one per patient. clinicianWithRel owns
    // both so the ownership check is satisfied; the relationship check is
    // the gate under test.
    sessionIdNoRel = randomUUID();
    sessionIdWithRel = randomUUID();
    await dbAdmin('scribe_sessions').insert([
      {
        id: sessionIdNoRel,
        clinic_id: clinicId,
        clinician_id: clinicianNoRelId,
        patient_id: patientWithoutRel,
        status: 'active',
        whisper_mode: false,
        started_at: new Date(),
      },
      {
        id: sessionIdWithRel,
        clinic_id: clinicId,
        clinician_id: clinicianWithRelId,
        patient_id: patientWithRel,
        status: 'active',
        whisper_mode: false,
        started_at: new Date(),
      },
    ] as never);
    seededSessionIds.push(sessionIdNoRel, sessionIdWithRel);
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    if (priorAiScribeFlag) {
      await dbAdmin('feature_flags')
        .where({ id: priorAiScribeFlag.id })
        .update({
          enabled: priorAiScribeFlag.enabled,
          rollout_percentage: priorAiScribeFlag.rollout_percentage,
          updated_at: new Date(),
        })
        .catch(() => undefined);
    } else {
      await dbAdmin('feature_flags')
        .where({ clinic_id: clinicId, name: 'ai-scribe' })
        .del()
        .catch(() => undefined);
    }
    await dbAdmin('scribe_sessions').whereIn('id', seededSessionIds).del().catch(() => undefined);
    await dbAdmin('letter_sections').whereIn('letter_id', seededLetterIds).del().catch(() => undefined);
    await dbAdmin('letters').whereIn('id', seededLetterIds).del().catch(() => undefined);
    if (seededEpisodeId) await dbAdmin('episodes').where({ id: seededEpisodeId }).del().catch(() => undefined);
    await dbAdmin('staff').whereIn('id', seededStaffIds).del().catch(() => undefined);
  });

  // ── PATCH /letters/:id/sections/:sectionKey ─────────────────────────────
  it('T1 — clinician with NO relationship to the letter patient → 403', async () => {
    const res = await request(app)
      .patch(`/api/v1/letters/${letterIdNoRel}/sections/${sectionKey}`)
      .set('Authorization', `Bearer ${clinicianNoRelToken}`)
      .set('X-CSRF-Token', 'test')
      .send({ content: 'T1 — should be blocked', source: 'edited' });
    expect(res.status).toBe(403);
  });

  it('T2 — admin (BYPASS_ROLES) bypasses the gate → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/letters/${letterIdNoRel}/sections/${sectionKey}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', 'test')
      .send({ content: 'T2 — admin bypass', source: 'edited' });
    expect(res.status).toBe(200);
  });

  it('T3 — clinician with relationship via episode → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/letters/${letterIdWithRel}/sections/${sectionKey}`)
      .set('Authorization', `Bearer ${clinicianWithRelToken}`)
      .set('X-CSRF-Token', 'test')
      .send({ content: 'T3 — with episode relationship', source: 'edited' });
    expect(res.status).toBe(200);
  });

  // ── PATCH /scribe/session/:id ───────────────────────────────────────────
  it('T4 — clinician with NO relationship to the session patient → 403', async () => {
    const res = await request(app)
      .patch(`/api/v1/scribe/session/${sessionIdNoRel}`)
      .set('Authorization', `Bearer ${clinicianNoRelToken}`)
      .set('X-CSRF-Token', 'test')
      .send({ action: 'pause' });
    expect(res.status).toBe(403);
  });

  it('T5 — admin (BYPASS_ROLES) bypasses the gate on scribe session → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/scribe/session/${sessionIdNoRel}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', 'test')
      .send({ action: 'pause' });
    expect(res.status).toBe(200);
  });

  it('T6 — originating clinician with relationship via episode → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/scribe/session/${sessionIdWithRel}`)
      .set('Authorization', `Bearer ${clinicianWithRelToken}`)
      .set('X-CSRF-Token', 'test')
      .send({ action: 'pause' });
    expect(res.status).toBe(200);
  });

  // ── L4-absorb: PHI-egress + sign-off surfaces now gated ──────────────────
  // Scope expanded during review absorption. Originally "2 endpoints";
  // L4 clinical-safety review correctly identified that /:id/deliver,
  // /:id/export, /:id/translations, /:id/submit, /:id/approve, /:id/reject
  // were mis-classified as "correctly skipped" in the frozen inventory.
  // Tests below pin each newly-gated endpoint with the clinician-no-rel
  // scenario so regressions are caught.

  it('T7 — POST /letters/:id/submit as clinician with NO relationship → 403', async () => {
    const res = await request(app)
      .post(`/api/v1/letters/${letterIdNoRel}/submit`)
      .set('Authorization', `Bearer ${clinicianNoRelToken}`)
      .set('X-CSRF-Token', 'test')
      .send({});
    expect(res.status).toBe(403);
  });

  it('T8 — POST /letters/:id/approve as clinician with NO relationship → 403', async () => {
    const res = await request(app)
      .post(`/api/v1/letters/${letterIdNoRel}/approve`)
      .set('Authorization', `Bearer ${clinicianNoRelToken}`)
      .set('X-CSRF-Token', 'test')
      .send({});
    // Gate fires before the SELF_APPROVAL or state-check branches, so 403.
    expect(res.status).toBe(403);
  });

  it('T9 — POST /letters/:id/reject as clinician with NO relationship → 403', async () => {
    const res = await request(app)
      .post(`/api/v1/letters/${letterIdNoRel}/reject`)
      .set('Authorization', `Bearer ${clinicianNoRelToken}`)
      .set('X-CSRF-Token', 'test')
      .send({ reason: 'test rejection — T9' });
    expect(res.status).toBe(403);
  });

  it('T10 — POST /letters/:id/translations as clinician with NO relationship → 403', async () => {
    const res = await request(app)
      .post(`/api/v1/letters/${letterIdNoRel}/translations`)
      .set('Authorization', `Bearer ${clinicianNoRelToken}`)
      .set('X-CSRF-Token', 'test')
      .send({ languageCode: 'zh', translatedText: 'T10 body', translatorModel: 'test' });
    expect(res.status).toBe(403);
  });

  it('T11 — POST /letters/:id/deliver as clinician with NO relationship → 403', async () => {
    const res = await request(app)
      .post(`/api/v1/letters/${letterIdNoRel}/deliver`)
      .set('Authorization', `Bearer ${clinicianNoRelToken}`)
      .set('X-CSRF-Token', 'test')
      .send({ channel: 'secure_link', recipientName: 'T11 GP' });
    expect(res.status).toBe(403);
  });

  it('T12 — POST /letters/:id/export as clinician with NO relationship → 403', async () => {
    const res = await request(app)
      .post(`/api/v1/letters/${letterIdNoRel}/export`)
      .set('Authorization', `Bearer ${clinicianNoRelToken}`)
      .set('X-CSRF-Token', 'test')
      .send({ format: 'plain_text' });
    expect(res.status).toBe(403);
  });
});
