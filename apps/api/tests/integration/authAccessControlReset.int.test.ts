import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { dbAdmin } from '../../src/db/db';
import { redis } from '../../src/config/redis';
import {
  authedAgent,
  isIntegrationReady,
  loginAsAdmin,
  loginAsClinician,
} from './_helpers';
import { buildAuthLimiterKey } from '../../src/middleware/rateLimiters';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('Admin targeted limiter reset + account unlock', () => {
  let adminSession: Awaited<ReturnType<typeof loginAsAdmin>>;
  let clinicianSession: Awaited<ReturnType<typeof loginAsClinician>>;
  let createdPatientAppAccountId: string | null = null;
  let createdPatientId: string | null = null;

  async function withClinicRls<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return dbAdmin.transaction(async (trx: Knex.Transaction) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [adminSession.clinicId]);
      return fn(trx);
    });
  }

  beforeAll(async () => {
    adminSession = await loginAsAdmin();
    clinicianSession = await loginAsClinician();
  });

  afterAll(async () => {
    if (!ready) return;
    if (createdPatientAppAccountId) {
      await withClinicRls(async (trx) => {
        await trx('patient_app_accounts')
          .where({ id: createdPatientAppAccountId as string })
          .del();
        return null;
      });
      createdPatientAppAccountId = null;
    }
    if (createdPatientId) {
      await withClinicRls(async (trx) => {
        await trx('patients')
          .where({ id: createdPatientId as string })
          .del();
        return null;
      });
      createdPatientId = null;
    }
  });

  it('requires admin/superadmin role', async () => {
    const res = await authedAgent(clinicianSession.token)
      .post('/api/v1/auth/admin/access-control/reset')
      .set('Idempotency-Key', `auth-access-control-rbac-${randomUUID()}`)
      .send({
        ticketId: 'INC-SEC-1001',
        reason: 'Targeted reset test for clinician RBAC denial.',
        limiter: {
          kind: 'api_ip',
          ip: '127.0.0.1',
        },
      });

    expect(res.status).toBe(403);
  });

  it('resets exactly one auth limiter key and writes an audit row', async () => {
    const targetKey = buildAuthLimiterKey({
      ip: '203.0.113.10',
      route: '/api/v1/auth/login',
      email: 'target.user@example.com',
    });
    const untouchedKey = buildAuthLimiterKey({
      ip: '203.0.113.10',
      route: '/api/v1/auth/login',
      email: 'other.user@example.com',
    });

    await redis.set(targetKey, '1', 'EX', 900);
    await redis.set(untouchedKey, '1', 'EX', 900);

    const res = await authedAgent(adminSession.token)
      .post('/api/v1/auth/admin/access-control/reset')
      .set('Idempotency-Key', `auth-access-control-limiter-${randomUUID()}`)
      .send({
        ticketId: 'INC-SEC-1002',
        reason: 'Clear a single auth limiter bucket for one affected user login flow.',
        limiter: {
          kind: 'auth_login',
          ip: '203.0.113.10',
          email: 'target.user@example.com',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.limiter?.key).toBe(targetKey);
    expect(res.body?.limiter?.deleted).toBe(1);

    const targetAfter = await redis.get(targetKey);
    const untouchedAfter = await redis.get(untouchedKey);
    expect(targetAfter).toBeNull();
    expect(untouchedAfter).toBe('1');

    const audit = await withClinicRls(async (trx) => trx('audit_log')
      .where({
        clinic_id: adminSession.clinicId,
        operation: 'UPDATE',
        table_name: 'auth_access_controls',
      })
      .orderBy('created_at', 'desc')
      .first('new_data', 'record_id'));

    expect(audit).toBeTruthy();
    const data = typeof audit.new_data === 'string' ? JSON.parse(audit.new_data) : audit.new_data;
    expect(data?.ticketId).toBe('INC-SEC-1002');
    expect(data?.limiter?.key).toBe(targetKey);
    expect(data?.limiter?.deleted).toBe(1);
  });

  it('unlocks a staff account by resetting failed attempts and lock timestamp', async () => {
    await dbAdmin('staff')
      .where({ id: clinicianSession.userId, clinic_id: adminSession.clinicId })
      .update({
        failed_login_attempts: 5,
        locked_until: new Date(Date.now() + 10 * 60 * 1000),
        updated_at: new Date(),
      });

    const res = await authedAgent(adminSession.token)
      .post('/api/v1/auth/admin/access-control/reset')
      .set('Idempotency-Key', `auth-access-control-staff-${randomUUID()}`)
      .send({
        ticketId: 'INC-SEC-1003',
        reason: 'Unlock staff account after verified identity and incident triage.',
        unlock: {
          kind: 'staff_account',
          staffId: clinicianSession.userId,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body?.unlock?.kind).toBe('staff_account');
    expect(res.body?.unlock?.staffId).toBe(clinicianSession.userId);

    const row = await dbAdmin('staff')
      .where({ id: clinicianSession.userId, clinic_id: adminSession.clinicId })
      .first('failed_login_attempts', 'locked_until');
    expect(Number(row.failed_login_attempts)).toBe(0);
    expect(row.locked_until).toBeNull();
  });

  it('unlocks a patient app account in-clinic and rejects wildcard limiter tokens', async () => {
    const patientIdForAccount = await withClinicRls(async (trx) => {
      const existing = await trx('patients')
        .where({ clinic_id: adminSession.clinicId })
        .whereNull('deleted_at')
        .first('id');
      if (existing?.id) return String(existing.id);

      const newPatientId = randomUUID();
      await trx('patients').insert({
        id: newPatientId,
        clinic_id: adminSession.clinicId,
        emr_number: `INT-PAT-${newPatientId.slice(0, 8)}`,
        given_name: 'Integration',
        family_name: 'Patient',
        date_of_birth: '1992-01-01',
        created_at: new Date(),
        updated_at: new Date(),
      });
      createdPatientId = newPatientId;
      return newPatientId;
    });

    createdPatientAppAccountId = randomUUID();
    await withClinicRls(async (trx) => {
      await trx('patient_app_accounts').insert({
        id: createdPatientAppAccountId as string,
        clinic_id: adminSession.clinicId,
        patient_id: patientIdForAccount,
        phone: `+6147${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`,
        password_hash: '$2a$10$abcdefghijklmnopqrstuv12345678901234567890123456',
        is_active: true,
        mfa_enabled: false,
        failed_login_attempts: 4,
        locked_until: new Date(Date.now() + 10 * 60 * 1000),
        created_at: new Date(),
        updated_at: new Date(),
      });
      return null;
    });

    const unlockRes = await authedAgent(adminSession.token)
      .post('/api/v1/auth/admin/access-control/reset')
      .set('Idempotency-Key', `auth-access-control-patient-${randomUUID()}`)
      .send({
        ticketId: 'INC-SEC-1004',
        reason: 'Unlock patient app account following service desk verification.',
        unlock: {
          kind: 'patient_app_account',
          accountId: createdPatientAppAccountId,
        },
      });

    expect(unlockRes.status).toBe(200);
    expect(unlockRes.body?.unlock?.kind).toBe('patient_app_account');
    expect(unlockRes.body?.unlock?.accountId).toBe(createdPatientAppAccountId);

    const account = await withClinicRls(async (trx) => trx('patient_app_accounts')
      .where({ id: createdPatientAppAccountId, clinic_id: adminSession.clinicId })
      .first('failed_login_attempts', 'locked_until'));
    expect(Number(account.failed_login_attempts)).toBe(0);
    expect(account.locked_until).toBeNull();

    const invalidRes = await authedAgent(adminSession.token)
      .post('/api/v1/auth/admin/access-control/reset')
      .set('Idempotency-Key', `auth-access-control-invalid-${randomUUID()}`)
      .send({
        ticketId: 'INC-SEC-1005',
        reason: 'Validation guard test for wildcard limiter token rejection.',
        limiter: {
          kind: 'patient_activate_code',
          code: '*',
        },
      });

    expect(invalidRes.status).toBe(422);
  });
});
