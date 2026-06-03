/**
 * Prescribing safety — allergy + active-medication contraindication checks.
 *
 * Control: checkContraindications() in apps/api/src/features/
 * medications/checkContraindications.ts. Covers:
 *
 *   1. ALLERGY cross-reactivity via a β-lactam / sulfonamide /
 *      NSAID class matrix (e.g. penicillin → amoxicillin)
 *   2. CLOZAPINE_BASELINE_ANC — refuses to commence clozapine
 *      without a recorded clozapine_blood_results anc_value
 *
 * Called by medicationService.create() BEFORE the repository
 * INSERT. Blocked attempts produce an audit_log row with
 * action='CONTRAINDICATION_BLOCKED'. The route returns 422 with
 * a structured code (ALLERGY_CONTRAINDICATION /
 * CLOZAPINE_BASELINE_ANC_REQUIRED).
 *
 * Standard satisfied: ACHS EQuIPNational Standard 4 (Medication
 *                     Safety), RANZCP psychopharmacology guideline,
 *                     Australian Pharmaceutical Advisory Council
 *                     Medication Safety Guidelines.
 */

import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isIntegrationReady, loginAsClinician, authedAgent } from './_helpers';

const READY = await isIntegrationReady();
const RUN_TAG = `RxT_${process.pid}_${Date.now().toString(36)}`;

describe.skipIf(!READY)('Prescribing safety (allergy + DDI)', () => {
  let token: string;
  let clinicId = '';
  let clinicianId = '';
  let originalClinicianHpii: string | null = null;
  let testPatientId: string;
  let relationshipEpisodeId = '';
  const cleanupPatientIds: string[] = [];

  beforeAll(async () => {
    ({ token, clinicId, userId: clinicianId } = await loginAsClinician());
    const { dbAdmin } = await import('../../src/db/db');
    const clinicianRow = await dbAdmin('staff')
      .where({ id: clinicianId, clinic_id: clinicId })
      .first('hpii');
    originalClinicianHpii = (clinicianRow?.hpii as string | null | undefined) ?? null;
    await dbAdmin('staff')
      .where({ id: clinicianId, clinic_id: clinicId })
      .update({ hpii: '8003611234567893', updated_at: new Date() });

    const agent = authedAgent(token);
    const create = await agent.post('/api/v1/patients').send({
      givenName: 'Rx',
      familyName: `${RUN_TAG}_Subject`,
      dateOfBirth: '1975-01-01',
      gender: 'female',
    });
    if (create.status !== 201) throw new Error(`Setup: ${create.status}`);
    testPatientId = create.body.id;
    cleanupPatientIds.push(testPatientId);

    relationshipEpisodeId = randomUUID();
    await dbAdmin('episodes').insert({
      id: relationshipEpisodeId,
      clinic_id: clinicId,
      patient_id: testPatientId,
      primary_clinician_id: clinicianId,
      episode_type: 'community',
      status: 'active',
      start_date: new Date().toISOString().slice(0, 10),
      created_at: new Date(),
      updated_at: new Date(),
    } as never);

    // Seed a penicillin allergy on this patient. The POST is
    // mounted at /api/v1/allergies (NOT nested under the patient
    // — see allergies.routes.ts). The DTO is CreateAllergySchema
    // from @signacare/shared: `allergen` + `allergenType`.
    const allergyRes = await agent.post('/api/v1/allergies').send({
      patientId: testPatientId,
      allergen: 'Penicillin',
      allergenType: 'drug',
      severity: 'severe',
      reaction: 'anaphylaxis',
      status: 'active',
    });
    expect([200, 201]).toContain(allergyRes.status);
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    if (relationshipEpisodeId) {
      await dbAdmin('episodes').where({ id: relationshipEpisodeId }).del().catch(() => undefined);
    }
    const agent = authedAgent(token);
    for (const id of cleanupPatientIds) {
      try { await agent.delete(`/api/v1/patients/${id}`); } catch { /* ignore */ }
    }
    if (clinicianId) {
      await dbAdmin('staff')
        .where({ id: clinicianId, clinic_id: clinicId })
        .update({ hpii: originalClinicianHpii, updated_at: new Date() })
        .catch(() => undefined);
    }
  });

  // ────────────────────────────────────────────────────────────────
  // KNOWN GAP: allergy cross-check at prescription time
  // ────────────────────────────────────────────────────────────────
  it('POST /medications rejects amoxicillin on a penicillin-allergic patient', async () => {
    const agent = authedAgent(token);
    const res = await agent.post('/api/v1/medications').send({
      patientId: testPatientId,
      drugName: 'Amoxicillin',
      dose: '500mg',
      frequency: 'tds',
      route: 'oral',
    });
    expect(res.status).toBe(422);
    const code = String(res.body.code ?? res.body.error ?? '');
    expect(code).toMatch(/ALLERGY|CONTRAINDICATION/i);
  });

  // ────────────────────────────────────────────────────────────────
  // KNOWN GAP: DDI cross-check against active medication list
  // ────────────────────────────────────────────────────────────────
  // Note: this test is NOT marked it.fails because we can't reliably
  // get the "first" POST to succeed in this test env (the route may
  // 400 without a full clinical context). Instead it asserts
  // structurally: the medication service accepts the call without
  // ever mentioning a polypharmacy check, and that's the gap.
  it('POST /medications has no drug-class polypharmacy check', async () => {
    const agent = authedAgent(token);
    // Try to POST two antipsychotics in sequence. Whether the first
    // succeeds or fails, the SECOND call must not surface a
    // CONTRAINDICATION / DRUG_CLASS / POLYPHARMACY code — because no
    // such check exists yet.
    await agent.post('/api/v1/medications').send({
      patientId: testPatientId,
      drugName: 'Olanzapine',
      dose: '10mg',
      frequency: 'nocte',
      route: 'oral',
    });
    const second = await agent.post('/api/v1/medications').send({
      patientId: testPatientId,
      drugName: 'Risperidone',
      dose: '2mg',
      frequency: 'nocte',
      route: 'oral',
    });
    // The documented gap: the route either accepts (success) or
    // rejects with a generic code — NEVER with a polypharmacy /
    // contraindication specific code. This assertion inverts the
    // expected behavior so the day the check lands, the author
    // must flip the assertion and remove this comment.
    const code = String(second.body?.code ?? second.body?.error ?? '');
    expect(code).not.toMatch(/DRUG_CLASS|DUPLICATE_CLASS|POLYPHARMACY/i);
  });

  // ────────────────────────────────────────────────────────────────
  // KNOWN GAP: Clozapine without baseline ANC (safety guard)
  // ────────────────────────────────────────────────────────────────
  it('POST /medications for Clozapine rejects without a baseline ANC record', async () => {
    const agent = authedAgent(token);
    const res = await agent.post('/api/v1/medications').send({
      patientId: testPatientId,
      drugName: 'Clozapine',
      dose: '12.5mg',
      frequency: 'nocte',
      route: 'oral',
    });
    expect(res.status).toBe(422);
    const code = String(res.body.code ?? res.body.error ?? '');
    expect(code).toMatch(/BASELINE|ANC|CLOZAPINE/i);
  });
});
