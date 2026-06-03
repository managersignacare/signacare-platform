import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authedAgent, isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const RUN_TAG = `WF31_${process.pid}_${Date.now().toString(36)}`;

describe.skipIf(!READY)('BUG-WF31 — registration validation hardening', () => {
  let token = '';
  const createdPatientIds: string[] = [];

  beforeAll(async () => {
    ({ token } = await loginAsAdmin());
  });

  afterAll(async () => {
    if (createdPatientIds.length === 0) return;
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('patients').whereIn('id', createdPatientIds).delete().catch(() => undefined);
  });

  it('rejects quick-register when dateOfBirth is in the future', async () => {
    const agent = authedAgent(token);
    const res = await agent.post('/api/v1/patients/quick-register').send({
      givenName: 'Future',
      familyName: `${RUN_TAG}_DOB`,
      dateOfBirth: '2099-01-01',
      phoneMobile: '0400 123 456',
    });

    expect(res.status).toBe(422);
    expect(res.body?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects quick-register when phone format is invalid', async () => {
    const agent = authedAgent(token);
    const res = await agent.post('/api/v1/patients/quick-register').send({
      givenName: 'Bad',
      familyName: `${RUN_TAG}_PHONE`,
      dateOfBirth: '1990-05-05',
      phoneMobile: 'abc@@@',
    });

    expect(res.status).toBe(422);
    expect(res.body?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects duplicate-check payload when Medicare checksum is invalid', async () => {
    const agent = authedAgent(token);
    const res = await agent.post('/api/v1/patients/duplicates/check').send({
      givenName: 'Noah',
      familyName: `${RUN_TAG}_DUP`,
      dateOfBirth: '1990-01-01',
      medicareNumber: '2123456711',
      medicareIrn: '1',
    });

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('VALIDATION_ERROR');
  });

  it('accepts valid quick-register payload after hardening', async () => {
    const agent = authedAgent(token);
    const res = await agent.post('/api/v1/patients/quick-register').send({
      givenName: 'Valid',
      familyName: `${RUN_TAG}_OK`,
      dateOfBirth: '1988-03-02',
      phoneMobile: '+61 400 123 456',
    });

    expect(res.status).toBe(201);
    expect(res.body?.id).toMatch(/^[0-9a-f-]{36}$/i);
    createdPatientIds.push(String(res.body.id));
  });
});
