import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authedAgent, isIntegrationReady, loginAsAdmin } from './_helpers';
import { dbAdmin } from '../../src/db/db';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-SCRIBE25-003 — scribe action-item lineage dedupe', () => {
  let token = '';
  let clinicId = '';
  let staffId = '';
  let patientId = '';
  let createdPatientId: string | null = null;
  const sessionId = randomUUID();
  let priorAiScribeState: { enabled: boolean; rolloutPercentage: number } | null = null;

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
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;
    staffId = session.userId;

    const patient = await withTenantContext(clinicId, async () => (
      dbAdmin('patients')
        .where({ clinic_id: clinicId })
        .whereNull('deleted_at')
        .first('id')
    ));
    if (patient?.id) {
      patientId = patient.id as string;
    } else {
      createdPatientId = randomUUID();
      patientId = createdPatientId;
      await withTenantContext(clinicId, async () => {
        await dbAdmin('patients').insert({
          id: createdPatientId,
          clinic_id: clinicId,
          given_name: 'Lineage',
          family_name: 'Test',
          date_of_birth: '1990-01-01',
        });
      });
    }

    await enableAiScribeFlag();

    await withTenantContext(clinicId, async () => {
      await dbAdmin('scribe_sessions').insert({
        id: sessionId,
        clinic_id: clinicId,
        clinician_id: staffId,
        patient_id: patientId,
        consent_id: null,
        status: 'active',
        whisper_mode: false,
        started_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
  });

  afterAll(async () => {
    if (!READY) return;
    await withTenantContext(clinicId, async () => {
      await dbAdmin('scribe_action_items').where({ session_id: sessionId }).del();
      await dbAdmin('scribe_sessions').where({ id: sessionId }).del();
    });
    if (createdPatientId) {
      await withTenantContext(clinicId, async () => {
        await dbAdmin('patients').where({ id: createdPatientId }).del();
      });
    }
    await withTenantContext(clinicId, async () => {
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

  it('does not materialize duplicate proposals for equivalent action items', async () => {
    const payload = {
      items: [
        {
          itemType: 'task',
          description: 'Review clozapine titration and order trough level.',
          assigneeRole: 'consultant psychiatrist',
          dueDate: '2026-06-30',
        },
      ],
    };

    const first = await authedAgent(token)
      .post(`/api/v1/scribe/session/${sessionId}/action-items`)
      .send(payload);
    expect(first.status).toBe(201);
    expect(Array.isArray(first.body?.items)).toBe(true);
    expect(first.body.items.length).toBe(1);
    const firstId = first.body.items[0].id as string;
    const firstLineage = first.body.items[0].lineageKey as string;
    expect(typeof firstLineage).toBe('string');
    expect(firstLineage.length).toBeGreaterThan(8);

    const second = await authedAgent(token)
      .post(`/api/v1/scribe/session/${sessionId}/action-items`)
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body.items.length).toBe(1);
    expect(second.body.items[0].id).toBe(firstId);
    expect(second.body.items[0].lineageKey).toBe(firstLineage);

    const dbRows = await withTenantContext(clinicId, async () => (
      dbAdmin('scribe_action_items')
        .where({ session_id: sessionId })
        .select('id')
    ));
    expect(dbRows).toHaveLength(1);
  });
});
