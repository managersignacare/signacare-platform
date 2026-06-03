import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authedAgent, isIntegrationReady, loginAsAdmin, loginAsClinician } from './_helpers';
import { dbAdmin } from '../../src/db/db';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-SCRIBE25-005 — medico-legal role + chain-of-custody controls', () => {
  let adminToken = '';
  let clinicianToken = '';
  let clinicId = '';
  let patientId = '';
  let templateId = '';
  let priorAiScribeState: { enabled: boolean; rolloutPercentage: number } | null = null;
  const createdLetterIds: string[] = [];
  let createdTemplateId: string | null = null;
  let createdPatientId: string | null = null;
  let createdEpisodeId: string | null = null;

  async function enableAiScribeFlag(): Promise<void> {
    await withTenantContext(clinicId, async () => {
      const existing = await dbAdmin('feature_flags')
        .where({ clinic_id: clinicId, name: 'ai-scribe' })
        .first('id', 'enabled', 'rollout_percentage');
      if (existing) {
        priorAiScribeState = {
          enabled: Boolean(existing.enabled),
          rolloutPercentage: Number(existing.rollout_percentage ?? 0),
        };
        await dbAdmin('feature_flags')
          .where({ id: existing.id })
          .update({ enabled: true, rollout_percentage: 100 });
        return;
      }
      priorAiScribeState = null;
      await dbAdmin('feature_flags').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        name: 'ai-scribe',
        enabled: true,
        rollout_percentage: 100,
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
  }

  beforeAll(async () => {
    const [adminSession, clinicianSession] = await Promise.all([
      loginAsAdmin(),
      loginAsClinician(),
    ]);
    adminToken = adminSession.token;
    clinicianToken = clinicianSession.token;
    clinicId = adminSession.clinicId;

    await enableAiScribeFlag();

    await withTenantContext(clinicId, async () => {
      const template = await dbAdmin('letter_templates')
        .where((qb) => qb.whereNull('clinic_id').orWhere({ clinic_id: clinicId }))
        .andWhere({ is_active: true })
        .andWhere((qb) => {
          qb.whereIn('category', ['court_mse_report', 'legal_document'])
            .orWhereILike('code', '%court%')
            .orWhereRaw('LOWER(code) = ?', ['291'])
            .orWhereILike('code', '%tribunal%');
        })
        .first('id');
      if (template?.id) {
        templateId = template.id as string;
      } else {
        createdTemplateId = randomUUID();
        templateId = createdTemplateId;
        const code = `court_bug_scribe25_${createdTemplateId.slice(0, 8)}`;
        await dbAdmin('letter_templates').insert({
          id: createdTemplateId,
          clinic_id: clinicId,
          code,
          name: 'Court MSE Report',
          category: 'referral_gp',
          description: 'Integration seed template for BUG-SCRIBE25-005',
          sections: JSON.stringify([{ key: 'body', label: 'Body', prompt: '' }]),
          system_prompt: 'Generate a medico-legal report with explicit evidence anchors.',
          default_recipients: JSON.stringify([]),
          is_active: true,
          requires_second_review: true,
          created_at: new Date(),
          updated_at: new Date(),
        } as never);
      }

      const clinicianPatient = await dbAdmin('episodes')
        .where({ clinic_id: clinicId, primary_clinician_id: clinicianSession.userId, status: 'open' })
        .whereNull('deleted_at')
        .first('patient_id');
      if (clinicianPatient?.patient_id) {
        patientId = clinicianPatient.patient_id as string;
        return;
      }

      createdPatientId = randomUUID();
      createdEpisodeId = randomUUID();
      patientId = createdPatientId;

      await dbAdmin('patients').insert({
        id: createdPatientId,
        clinic_id: clinicId,
        given_name: 'Medico',
        family_name: 'Legal',
        date_of_birth: '1989-02-14',
      });

      await dbAdmin('episodes').insert({
        id: createdEpisodeId,
        clinic_id: clinicId,
        patient_id: createdPatientId,
        episode_type: 'triage',
        status: 'open',
        start_date: new Date().toISOString().slice(0, 10),
        primary_clinician_id: clinicianSession.userId,
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
  });

  afterAll(async () => {
    if (!READY) return;
    await withTenantContext(clinicId, async () => {
      if (createdLetterIds.length > 0) {
        await dbAdmin('letter_sections').whereIn('letter_id', createdLetterIds).del();
        await dbAdmin('letters').whereIn('id', createdLetterIds).del();
        await dbAdmin('letter_audit_log').whereIn('letter_id', createdLetterIds).del();
      }
      if (createdEpisodeId) {
        await dbAdmin('episodes').where({ id: createdEpisodeId }).del();
      }
      if (createdPatientId) {
        await dbAdmin('patients').where({ id: createdPatientId }).del();
      }
      if (createdTemplateId) {
        await dbAdmin('letter_templates').where({ id: createdTemplateId }).del();
      }
      if (priorAiScribeState === null) {
        await dbAdmin('feature_flags').where({ clinic_id: clinicId, name: 'ai-scribe' }).del();
      } else {
        await dbAdmin('feature_flags')
          .where({ clinic_id: clinicId, name: 'ai-scribe' })
          .update({
            enabled: priorAiScribeState.enabled,
            rollout_percentage: priorAiScribeState.rolloutPercentage,
          });
      }
    });
  });

  it('blocks non-psychiatrist clinician from creating medico-legal drafts', async () => {
    const res = await authedAgent(clinicianToken)
      .post('/api/v1/letters')
      .send({
        templateId,
        patientId,
        subject: 'Court-requested medico-legal report',
        recipients: [{ name: 'Magistrates Court', role: 'Court' }],
      });

    expect(res.status).toBe(403);
    expect(res.body?.code).toBe('MEDICO_LEGAL_ROLE_REQUIRED');
  });

  it('writes immutable audit-chain event when authorised admin creates medico-legal draft', async () => {
    const res = await authedAgent(adminToken)
      .post('/api/v1/letters')
      .send({
        templateId,
        patientId,
        subject: 'Court-requested medico-legal report',
        recipients: [{ name: 'Magistrates Court', role: 'Court' }],
      });

    expect(res.status).toBe(201);
    const letterId = res.body?.id as string;
    createdLetterIds.push(letterId);

    const auditRow = await withTenantContext(clinicId, async () => (
      dbAdmin('audit_log')
        .where({ table_name: 'letters', record_id: letterId })
        .whereRaw("new_data::text ILIKE '%medico_legal_chain_event%'")
        .orderBy('created_at', 'desc')
        .first('id')
    ));

    expect(auditRow?.id).toBeTruthy();
  });
});
