import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../src/server';
import { CANONICAL_PERSONAS } from '../fixtures/canonical-personas';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-AUDIT action/operation normalization on canonical audit reads', () => {
  let token = '';
  let clinicId = '';
  let patientId = '';

  const legacyLlmEndpoint = `/bug-audit-legacy/${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;

    const { dbAdmin } = await import('../../src/db/db');
    const patient = await dbAdmin('patients')
      .where({ clinic_id: clinicId })
      .select('id')
      .first();
    if (!patient?.id) throw new Error('BUG-AUDIT: missing seeded patient');
    patientId = String(patient.id);
  });

  async function insertLegacyAuditRow(params: {
    action: string;
    tableName: string;
    newData: Record<string, unknown>;
  }): Promise<void> {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('audit_log').insert({
      clinic_id: clinicId,
      staff_id: CANONICAL_PERSONAS.admin.id,
      user_id: CANONICAL_PERSONAS.admin.id,
      action: params.action,
      operation: null,
      table_name: params.tableName,
      record_id: patientId,
      new_data: JSON.stringify(params.newData),
      created_at: new Date().toISOString(),
    });
  }

  it('counts lowercase legacy action rows in /reports/llm-bypass-audit', async () => {
    const before = await request(app)
      .get('/api/v1/reports/llm-bypass-audit')
      .query({ endpoint: legacyLlmEndpoint })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(before.status).toBe(200);
    const beforeMatched = Number(before.body?.totalMatched ?? 0);

    await insertLegacyAuditRow({
      action: 'llm_access_bypass_role',
      tableName: 'llm_interactions',
      newData: { endpoint: legacyLlmEndpoint, feature: 'legacy-action-row' },
    });

    const after = await request(app)
      .get('/api/v1/reports/llm-bypass-audit')
      .query({ endpoint: legacyLlmEndpoint })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(after.status).toBe(200);
    expect(Number(after.body?.totalMatched ?? 0)).toBe(beforeMatched + 1);
    expect(Array.isArray(after.body?.events)).toBe(true);
    expect(after.body.events.some((row: { endpoint?: string | null }) => row.endpoint === legacyLlmEndpoint)).toBe(true);
  });

  it('counts lowercase legacy action rows in /reports/compliance/summary forbidden metric', async () => {
    const before = await request(app)
      .get('/api/v1/reports/compliance/summary')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(before.status).toBe(200);
    const beforeForbidden = Number(before.body?.governance?.forbiddenAccessLast7Days ?? 0);

    await insertLegacyAuditRow({
      action: 'forbidden_access',
      tableName: 'security_events',
      newData: { reason: 'bug-audit-legacy-test' },
    });

    const after = await request(app)
      .get('/api/v1/reports/compliance/summary')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(after.status).toBe(200);
    const afterForbidden = Number(after.body?.governance?.forbiddenAccessLast7Days ?? 0);
    expect(afterForbidden).toBeGreaterThanOrEqual(beforeForbidden + 1);
  });
});
