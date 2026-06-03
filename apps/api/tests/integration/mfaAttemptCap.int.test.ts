import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { redis } from '../../src/config/redis';
import { withTenantContext } from '../../src/shared/tenantContext';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const MFA_SECRET = 'JBSWY3DPEHPK3PXP';
const TEST_PASSWORD = 'Password1!';

let clinicId = '';
let staffId = '';
let staffEmail = '';

function attemptsKeyFor(staffIdInput: string): string {
  return `auth:mfa_attempts:${staffIdInput}`;
}

describe.skipIf(!READY)('BUG-WF21-OTP-CAP-MISSING — MFA attempt cap', () => {
  beforeAll(async () => {
    const session = await loginAsAdmin();
    clinicId = session.clinicId;
    staffId = randomUUID();
    staffEmail = `mfa-cap-${Date.now()}@signacare.local`;

    await withTenantContext(clinicId, async () => {
      await dbAdmin('staff').insert({
        id: staffId,
        clinic_id: clinicId,
        email: staffEmail,
        given_name: 'Mfa',
        family_name: 'Cap',
        role: 'clinician',
        is_active: true,
        password_hash: await bcrypt.hash(TEST_PASSWORD, 10),
        mfa_enabled: true,
        mfa_secret: MFA_SECRET,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }, staffId);
  });

  afterAll(async () => {
    try {
      await redis.del(attemptsKeyFor(staffId));
    } catch {
      // best-effort cleanup
    }
    await withTenantContext(clinicId, async () => {
      await dbAdmin('staff_sessions').where({ staff_id: staffId }).del();
      await dbAdmin('staff').where({ id: staffId }).del();
    }, staffId);
  });

  it('returns 429 after max invalid MFA attempts within temp-token window', async () => {
    await redis.del(attemptsKeyFor(staffId));

    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({ email: staffEmail, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body?.requiresMfa).toBe(true);
    const tempToken = String(login.body?.tempToken ?? '');
    expect(tempToken.length).toBeGreaterThan(10);

    for (let i = 0; i < 5; i += 1) {
      const invalid = await request(app)
        .post('/api/v1/auth/mfa/verify')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({ tempToken, token: '000000' });
      expect(invalid.status).toBe(401);
      expect(invalid.body?.code).toBe('INVALID_CREDENTIALS');
    }

    const blocked = await request(app)
      .post('/api/v1/auth/mfa/verify')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({ tempToken, token: '000000' });
    expect(blocked.status).toBe(429);
    expect(blocked.body?.code).toBe('MFA_ATTEMPTS_EXCEEDED');
  });

  it('clears attempt counter after a valid MFA code', async () => {
    await redis.del(attemptsKeyFor(staffId));

    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({ email: staffEmail, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body?.requiresMfa).toBe(true);
    const tempToken = String(login.body?.tempToken ?? '');
    expect(tempToken.length).toBeGreaterThan(10);

    const invalid = await request(app)
      .post('/api/v1/auth/mfa/verify')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({ tempToken, token: '000000' });
    expect(invalid.status).toBe(401);

    const candidateToken = speakeasy.totp({ secret: MFA_SECRET, encoding: 'base32' });
    const validToken = speakeasy.totp.verify({
      secret: MFA_SECRET,
      encoding: 'base32',
      token: candidateToken,
      window: 1,
    })
      ? candidateToken
      : null;
    expect(validToken).not.toBeNull();

    const success = await request(app)
      .post('/api/v1/auth/mfa/verify')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({ tempToken, token: validToken });
    expect(success.status).toBe(200);

    const attempts = await redis.get(attemptsKeyFor(staffId));
    expect(attempts).toBeNull();
  });
});
