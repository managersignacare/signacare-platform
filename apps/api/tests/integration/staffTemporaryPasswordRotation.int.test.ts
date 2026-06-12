import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { authedAgent, isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('staff temporary password rotation', () => {
  it('allows a newly onboarded staff member to rotate the temporary password and continue with a fresh authenticated session', async () => {
    const adminSession = await loginAsAdmin();
    const adminAgent = authedAgent(adminSession.token);
    const email = `temp-rotate-${Date.now()}@example.test`.toLowerCase();
    const newPassword = 'ChangedPass1!';
    let staffId: string | null = null;

    try {
      const createRes = await adminAgent.post('/api/v1/staff').send({
        givenName: 'Temp',
        familyName: 'Rotate',
        email,
        role: 'clinician',
      });

      expect(createRes.status).toBe(201);
      staffId = (createRes.body?.id as string | undefined) ?? null;
      const tempPassword = String(createRes.body?.temporaryPassword ?? '');
      expect(staffId).toBeTruthy();
      expect(tempPassword.length).toBeGreaterThan(0);

      const loginWithTemp = await request(app)
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({ email, password: tempPassword });

      expect(loginWithTemp.status).toBe(200);
      expect(loginWithTemp.body?.mustChangePassword).toBe(true);
      const accessToken = loginWithTemp.body?.accessToken as string | undefined;
      expect(typeof accessToken).toBe('string');

      const changeRes = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({
          currentPassword: tempPassword,
          newPassword,
          confirmPassword: newPassword,
        });

      expect(changeRes.status).toBe(200);
      expect(changeRes.body?.success).toBe(true);
      expect(changeRes.body?.user?.email).toBe(email);
      expect(typeof changeRes.body?.accessToken).toBe('string');
      expect(typeof changeRes.body?.refreshToken).toBe('string');

      const meAfterRotation = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${changeRes.body.accessToken}`)
        .set('X-CSRF-Token', 'test');

      expect(meAfterRotation.status).toBe(200);
      expect(meAfterRotation.body?.email).toBe(email);

      const loginWithNewPassword = await request(app)
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({ email, password: newPassword });

      expect(loginWithNewPassword.status).toBe(200);
      expect(loginWithNewPassword.body?.requiresMfa).toBe(false);
      expect(loginWithNewPassword.body?.mustChangePassword).toBe(false);
      expect(loginWithNewPassword.body?.user?.email).toBe(email);
    } finally {
      if (staffId) {
        await dbAdmin('staff')
          .where({ id: staffId })
          .update({
            deleted_at: new Date(),
            is_active: false,
            email: `deleted+${staffId}@example.test`,
            updated_at: new Date(),
          })
          .catch(() => undefined);
      } else {
        await dbAdmin('staff')
          .where({ email })
          .update({
            deleted_at: new Date(),
            is_active: false,
            updated_at: new Date(),
          })
          .catch(() => undefined);
      }
    }
  });
});
