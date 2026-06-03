import { afterEach, describe, expect, it } from 'vitest';
import { sendSms } from '../../src/integrations/acs/acsClient';
import { sendToTokens } from '../../src/integrations/fcm/fcmClient';

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

describe('BUG-ARCH-SILENT-MOCK-SUCCESS — integration clients fail visibly when unconfigured', () => {
  afterEach(() => {
    resetEnv();
  });

  it('returns failure summary for FCM when service account path is absent (non-production)', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.FCM_SERVICE_ACCOUNT_PATH;

    const out = await sendToTokens(['tok-a', 'tok-b'], { title: 'hello', body: 'world' });
    expect(out.successCount).toBe(0);
    expect(out.failureCount).toBe(2);
    expect(out.errorMessage).toContain('FCM_NOT_CONFIGURED');
  });

  it('returns failure summary for ACS when connection vars are absent (non-production)', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ACS_CONNECTION_STRING;
    delete process.env.ACS_FROM_PHONE;

    const out = await sendSms({ to: '+61400000000', body: 'test sms' });
    expect(out.success).toBe(false);
    expect(out.operationId).toBeUndefined();
    expect(out.errorMessage).toContain('ACS_NOT_CONFIGURED');
  });

  it('throws fail-closed for FCM in production when unconfigured', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FCM_SERVICE_ACCOUNT_PATH;

    await expect(sendToTokens(['tok-a'], { title: 'prod', body: 'check' })).rejects.toMatchObject({
      code: 'FCM_NOT_CONFIGURED',
    });
  });

  it('throws fail-closed for ACS in production when unconfigured', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ACS_CONNECTION_STRING;
    delete process.env.ACS_FROM_PHONE;

    await expect(sendSms({ to: '+61400000000', body: 'prod check' })).rejects.toMatchObject({
      code: 'ACS_NOT_CONFIGURED',
    });
  });
});
