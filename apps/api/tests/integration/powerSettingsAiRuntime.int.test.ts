import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { issueTokens } from '../../src/features/auth/authService';

const READY = await isIntegrationReady();

type OriginalClinicSettingsRow = {
  clinic_id: string;
  scribe_consent_mode: string;
  ai_chat_classifier_mode: string;
  scribe_audio_retention: string;
  email_sender_mode: string | null;
  clinic_sender_email: string | null;
  clinic_sender_name: string | null;
  ai_llm_backend: string | null;
  scribe_runtime_mode: string | null;
  local_style_adapter_model_name: string | null;
  created_at: Date | string;
  updated_at: Date | string;
} | null;

const BASELINE_INSERT = {
  scribe_consent_mode: 'clinician_attestation',
  ai_chat_classifier_mode: 'regex_keyword',
  scribe_audio_retention: 'immediate_delete',
  email_sender_mode: 'staff_delegated',
  clinic_sender_email: null,
  clinic_sender_name: null,
};

describe.skipIf(!READY)('Power Settings AI runtime endpoints', () => {
  let clinicId: string;
  let superadminToken: string;
  let adminToken: string;
  let adminStaffId: string;
  let originalRow: OriginalClinicSettingsRow = null;

  async function mintToken(opts: { staffId: string; clinicId: string; role: string }): Promise<string> {
    const { dbAdmin } = await import('../../src/db/db');
    const staff = await dbAdmin('staff')
      .where({ id: opts.staffId, clinic_id: opts.clinicId })
      .first('email', 'given_name', 'family_name');
    if (!staff) {
      throw new Error(`Unable to mint token: staff ${opts.staffId} not found in clinic ${opts.clinicId}`);
    }

    const { accessToken } = issueTokens({
      id: opts.staffId,
      clinicId: opts.clinicId,
      role: opts.role as Parameters<typeof issueTokens>[0]['role'],
      permissions: [],
      email: String(staff.email),
      givenName: String(staff.given_name),
      familyName: String(staff.family_name),
    } as Parameters<typeof issueTokens>[0]);

    const { redis } = await import('../../src/config/redis');
    await redis.set(`idle:${opts.staffId}`, '1', 'EX', 60 * 60);
    return accessToken;
  }

  async function upsertKnownClinicSettings(values: {
    ai_llm_backend: string;
    scribe_runtime_mode: string;
    local_style_adapter_model_name: string | null;
  }): Promise<void> {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('clinic_settings')
      .insert({
        clinic_id: clinicId,
        ...BASELINE_INSERT,
        ...values,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict('clinic_id')
      .merge({
        ...values,
        updated_at: new Date(),
      });
  }

  beforeAll(async () => {
    const session = await loginAsAdmin();
    clinicId = session.clinicId;
    superadminToken = session.token;

    const { dbAdmin } = await import('../../src/db/db');
    originalRow = await dbAdmin('clinic_settings')
      .where({ clinic_id: clinicId })
      .first(
        'clinic_id',
        'scribe_consent_mode',
        'ai_chat_classifier_mode',
        'scribe_audio_retention',
        'email_sender_mode',
        'clinic_sender_email',
        'clinic_sender_name',
        'ai_llm_backend',
        'scribe_runtime_mode',
        'local_style_adapter_model_name',
        'created_at',
        'updated_at',
      ) as OriginalClinicSettingsRow;

    adminStaffId = randomUUID();
    await dbAdmin('staff').insert({
      id: adminStaffId,
      clinic_id: clinicId,
      email: `pwr-ai-${adminStaffId.slice(0, 6)}@signacare.local`,
      password_hash: 'stub',
      given_name: 'Power',
      family_name: 'Admin',
      role: 'admin',
      is_active: true,
    });

    adminToken = await mintToken({
      staffId: adminStaffId,
      clinicId,
      role: 'admin',
    });
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');

    if (originalRow) {
      await dbAdmin('clinic_settings')
        .where({ clinic_id: clinicId })
        .update({
          scribe_consent_mode: originalRow.scribe_consent_mode,
          ai_chat_classifier_mode: originalRow.ai_chat_classifier_mode,
          scribe_audio_retention: originalRow.scribe_audio_retention,
          email_sender_mode: originalRow.email_sender_mode ?? 'staff_delegated',
          clinic_sender_email: originalRow.clinic_sender_email,
          clinic_sender_name: originalRow.clinic_sender_name,
          ai_llm_backend: originalRow.ai_llm_backend ?? 'local_ollama',
          scribe_runtime_mode: originalRow.scribe_runtime_mode ?? 'standard',
          local_style_adapter_model_name: originalRow.local_style_adapter_model_name,
          updated_at: new Date(),
        });
      await dbAdmin('clinic_settings')
        .where({ clinic_id: clinicId })
        .update({ created_at: originalRow.created_at, updated_at: originalRow.updated_at });
    } else {
      await dbAdmin('clinic_settings').where({ clinic_id: clinicId }).del();
    }

    await dbAdmin('staff')
      .where({ id: adminStaffId })
      .update({
        is_active: false,
        deleted_at: new Date(),
        updated_at: new Date(),
      });
  });

  function getAsSuper() {
    return request(app)
      .get(`/api/v1/power-settings/clinics/${clinicId}/ai-runtime`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile');
  }

  function putAsSuper(body: unknown) {
    return request(app)
      .put(`/api/v1/power-settings/clinics/${clinicId}/ai-runtime`)
      .set('Authorization', `Bearer ${superadminToken}`)
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send(body);
  }

  function putAsAdmin(body: unknown) {
    return request(app)
      .put(`/api/v1/power-settings/clinics/${clinicId}/ai-runtime`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send(body);
  }

  it('GET returns the configured runtime settings for the target clinic', async () => {
    await upsertKnownClinicSettings({
      ai_llm_backend: 'local_ollama',
      scribe_runtime_mode: 'standard',
      local_style_adapter_model_name: 'style-a:latest',
    });

    const res = await getAsSuper();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      clinicId,
      llmBackend: 'local_ollama',
      scribeRuntimeMode: 'standard',
      localStyleAdapterModelName: 'style-a:latest',
    });
  });

  it('PUT updates backend + scribe mode and writes an audit row', async () => {
    const res = await putAsSuper({
      llmBackend: 'azure_openai',
      scribeRuntimeMode: 'agentic',
      localStyleAdapterModelName: 'style-b:latest',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      clinicId,
      llmBackend: 'azure_openai',
      scribeRuntimeMode: 'agentic',
      localStyleAdapterModelName: 'style-b:latest',
    });

    const { dbAdmin } = await import('../../src/db/db');
    const row = await dbAdmin('clinic_settings')
      .where({ clinic_id: clinicId })
      .first('ai_llm_backend', 'scribe_runtime_mode', 'local_style_adapter_model_name');
    expect(row).toMatchObject({
      ai_llm_backend: 'azure_openai',
      scribe_runtime_mode: 'agentic',
      local_style_adapter_model_name: 'style-b:latest',
    });

    const auditRows = await dbAdmin('audit_log')
      .where({ table_name: 'clinic_settings', record_id: clinicId })
      .orderBy('created_at', 'desc')
      .limit(5);
    const latest = auditRows[0];
    expect(latest).toBeDefined();
    const newData = typeof latest.new_data === 'string'
      ? JSON.parse(latest.new_data)
      : latest.new_data;
    expect(newData).toMatchObject({
      ai_llm_backend: 'azure_openai',
      scribe_runtime_mode: 'agentic',
      local_style_adapter_model_name: 'style-b:latest',
    });
  });

  it('PUT allows explicitly clearing a stored local style adapter', async () => {
    await upsertKnownClinicSettings({
      ai_llm_backend: 'azure_openai',
      scribe_runtime_mode: 'agentic',
      local_style_adapter_model_name: 'style-c:latest',
    });

    const res = await putAsSuper({
      localStyleAdapterModelName: null,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      clinicId,
      llmBackend: 'azure_openai',
      scribeRuntimeMode: 'agentic',
      localStyleAdapterModelName: null,
    });

    const { dbAdmin } = await import('../../src/db/db');
    const row = await dbAdmin('clinic_settings')
      .where({ clinic_id: clinicId })
      .first('local_style_adapter_model_name');
    expect(row?.local_style_adapter_model_name).toBeNull();
  });

  it('rejects non-superadmin writes', async () => {
    const res = await putAsAdmin({
      llmBackend: 'local_ollama',
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});
