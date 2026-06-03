import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { withTenantContext } from '../../src/shared/tenantContext';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_LABEL = `BUG-WF22-PWD-RESET-${Date.now()}`;

let clinicId = '';
let adminUserId = '';
let staffId = '';
let staffEmail = '';

describe.skipIf(!READY)('BUG-WF22 — password reset request/confirm flow', () => {
  beforeAll(async () => {
    const adminSession = await loginAsAdmin();
    clinicId = adminSession.clinicId;
    adminUserId = adminSession.userId;
    staffId = randomUUID();
    staffEmail = `${TEST_LABEL.toLowerCase()}@signacare.local`;

    await withTenantContext(clinicId, async () => {
      await dbAdmin('staff').insert({
        id: staffId,
        clinic_id: clinicId,
        email: staffEmail,
        given_name: 'Password',
        family_name: 'Reset',
        password_hash: await bcrypt.hash('Password1!', 10),
        role: 'clinician',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }, adminUserId);
  });

  afterAll(async () => {
    if (!READY || !clinicId) return;
    await withTenantContext(clinicId, async () => {
      if (staffId) {
        await dbAdmin('password_reset_tokens').where({ staff_id: staffId }).delete().catch(() => undefined);
        await dbAdmin('staff_sessions').where({ staff_id: staffId }).delete().catch(() => undefined);
        await dbAdmin('staff')
          .where({ id: staffId })
          .update({
            is_active: false,
            deleted_at: new Date(),
            updated_at: new Date(),
          })
          .catch(() => undefined);
      }
    }, adminUserId || undefined);
  });

  it('request endpoint returns generic ack and writes a reset token row', async () => {
    const res = await request(app)
      .post('/api/v1/auth/password-reset/request')
      .set('X-CSRF-Token', 'signacare-spa')
      .send({ email: staffEmail });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      message: 'If that address is registered, a reset link has been sent.',
    });

    const tokenRows = await withTenantContext(clinicId, async () =>
      dbAdmin('password_reset_tokens')
        .where({ staff_id: staffId })
        .whereNull('used_at')
        .orderBy('created_at', 'desc')
        .select('*'),
      adminUserId,
    );
    expect(tokenRows.length).toBeGreaterThan(0);
    expect(tokenRows[0]?.clinic_id).toBe(clinicId);
  });

  it('confirm endpoint rotates password and marks token as used', async () => {
    const rawToken = `${clinicId}.${TEST_LABEL}-raw-reset-token`;
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await withTenantContext(clinicId, async () => {
      await dbAdmin('password_reset_tokens')
        .where({ staff_id: staffId })
        .whereNull('used_at')
        .update({ used_at: new Date() });
      await dbAdmin('password_reset_tokens').insert({
        clinic_id: clinicId,
        staff_id: staffId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        requested_ip: null,
        requested_user_agent: null,
        created_at: new Date(),
      });
    }, adminUserId);

    const newPassword = 'StrongerPass1!';
    const res = await request(app)
      .post('/api/v1/auth/password-reset/confirm')
      .set('X-CSRF-Token', 'signacare-spa')
      .send({
        token: rawToken,
        newPassword,
        confirmPassword: newPassword,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    const postState = await withTenantContext(clinicId, async () => {
      const staffRow = await dbAdmin('staff')
        .where({ id: staffId })
        .first('password_hash');
      const openTokens = await dbAdmin('password_reset_tokens')
        .where({ staff_id: staffId })
        .whereNull('used_at')
        .count<{ count: string }[]>('* as count');
      return {
        staffRow,
        openTokenCount: Number(openTokens[0]?.count ?? 0),
      };
    }, adminUserId);

    expect(postState.staffRow).toBeTruthy();
    expect(await bcrypt.compare(newPassword, String(postState.staffRow?.password_hash))).toBe(true);
    expect(postState.openTokenCount).toBe(0);
  });
});
