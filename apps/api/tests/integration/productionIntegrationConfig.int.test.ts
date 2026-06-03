/**
 * BUG-043 regression — production integration-config boot-time
 * assertion + Layer 2 silent-mock removal.
 *
 * Coverage (15 tests):
 *   T1 — NODE_ENV=production + no eRx pathway → throws with 'eRx' in message
 *   T2 — NODE_ENV=production + no SafeScript creds → throws with 'SafeScript'
 *   T3 — NODE_ENV=production + no FCM_SERVICE_ACCOUNT_PATH → throws with 'FCM'
 *   T4 — NODE_ENV=production + no ACS_CONNECTION_STRING → throws with 'ACS'
 *   T5 — NODE_ENV=production + eRx configured but HI Service missing → throws
 *   T6 — NODE_ENV=production + HL7_LAB_PROTOCOL=mllp + no host/port → throws
 *   T7 — NODE_ENV=development + all missing → does NOT throw (WARN only)
 *   T8 — Full production config → resolves without throw
 *   T9 — fcm sendToTokens in production without FCM_SERVICE_ACCOUNT_PATH → throws
 *   T10 — acs sendSms in production without ACS_CONNECTION_STRING → throws
 *   T11 — NODE_ENV=production + ACS_CONNECTION_STRING set but ACS_FROM_PHONE
 *         unset → throws (L4 finding: mirror loadAcsConfig.mockMode)
 *   T12 — keyring-only PHI config (no PHI_ENCRYPTION_KEY) is accepted
 *   T13 — malformed PHI keyring is rejected
 *   T14 — fcm sendToTokens in test mode without config returns fail-visible summary
 *   T15 — acs sendSms in test mode without config returns fail-visible summary
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { isIntegrationReady } from './_helpers';
import {
  assertProductionIntegrationsConfigured,
  ProductionConfigError,
} from '../../src/shared/assertProductionIntegrationsConfigured';

// Env snapshot/restore pattern so each test isolates its mutations.
const ORIGINAL_ENV = { ...process.env };
function resetEnvToMinimal(): void {
  for (const k of Object.keys(process.env)) delete process.env[k];
  // Re-seed only the non-integration vars the runtime needs.
  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = ORIGINAL_ENV.DATABASE_URL ?? '';
  process.env.REDIS_URL = ORIGINAL_ENV.REDIS_URL ?? '';
  process.env.JWT_ACCESS_SECRET = ORIGINAL_ENV.JWT_ACCESS_SECRET ?? 'x'.repeat(64);
  process.env.JWT_REFRESH_SECRET = ORIGINAL_ENV.JWT_REFRESH_SECRET ?? 'y'.repeat(64);
}
function restoreEnv(): void {
  for (const k of Object.keys(process.env)) delete process.env[k];
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) process.env[k] = v;
}
function setFullProductionConfig(): void {
  process.env.NODE_ENV = 'production';
  // eRx — use Adapter pathway (simplest valid config)
  process.env.ERX_ADAPTER_URL = 'https://adapter.example/erx';
  process.env.ERX_SITE_CERT_PATH = '/etc/certs/erx-site.pfx';
  // SafeScript
  process.env.SAFESCRIPT_API_URL = 'https://api.safescript.vic.gov.au';
  process.env.SAFESCRIPT_CLIENT_ID = 'signacare';
  process.env.SAFESCRIPT_CLIENT_SECRET = 'test-secret';
  // FCM
  process.env.FCM_SERVICE_ACCOUNT_PATH = '/etc/certs/fcm-service-account.json';
  // ACS
  process.env.ACS_CONNECTION_STRING = 'endpoint=https://test.communication.azure.com/;accesskey=redacted';
  process.env.ACS_FROM_PHONE = '+61400000000';
  // HI Service
  process.env.HI_SERVICE_URL = 'https://ws.medicareaustralia.gov.au/hi';
  process.env.HI_SERVICE_CERT_PATH = '/etc/certs/hi-service.pfx';
  process.env.PHI_ENCRYPTION_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
}

describe.skipIf(!(await isIntegrationReady()))('BUG-043 production integration-config boot assertion', () => {
  beforeEach(() => {
    resetEnvToMinimal();
  });

  afterAll(() => {
    restoreEnv();
  });

  it('T1 — NODE_ENV=production + no eRx pathway → throws with eRx in remediation', async () => {
    setFullProductionConfig();
    delete process.env.ERX_ADAPTER_URL;
    delete process.env.ERX_SITE_CERT_PATH;
    delete process.env.NPDS_API_URL;
    delete process.env.ERX_REST_ENTITY_ID;
    // HI Service check is conditional on eRx configured — disable it so we isolate
    delete process.env.HI_SERVICE_URL;
    delete process.env.HI_SERVICE_CERT_PATH;
    try {
      await assertProductionIntegrationsConfigured();
      throw new Error('expected ProductionConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(ProductionConfigError);
      const e = err as ProductionConfigError;
      expect(e.remediation).toMatch(/eRx/);
      expect(e.missing.some((m) => m.name === 'eRx')).toBe(true);
    }
  });

  it('T2 — NODE_ENV=production + no SafeScript creds → throws with SafeScript', async () => {
    setFullProductionConfig();
    delete process.env.SAFESCRIPT_API_URL;
    delete process.env.SAFESCRIPT_CLIENT_ID;
    delete process.env.SAFESCRIPT_CLIENT_SECRET;
    try {
      await assertProductionIntegrationsConfigured();
      throw new Error('expected ProductionConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(ProductionConfigError);
      expect((err as ProductionConfigError).remediation).toMatch(/SafeScript/);
    }
  });

  it('T3 — NODE_ENV=production + no FCM_SERVICE_ACCOUNT_PATH → throws with FCM', async () => {
    setFullProductionConfig();
    delete process.env.FCM_SERVICE_ACCOUNT_PATH;
    try {
      await assertProductionIntegrationsConfigured();
      throw new Error('expected ProductionConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(ProductionConfigError);
      expect((err as ProductionConfigError).remediation).toMatch(/FCM/);
    }
  });

  it('T4 — NODE_ENV=production + no ACS_CONNECTION_STRING → throws with ACS', async () => {
    setFullProductionConfig();
    delete process.env.ACS_CONNECTION_STRING;
    try {
      await assertProductionIntegrationsConfigured();
      throw new Error('expected ProductionConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(ProductionConfigError);
      expect((err as ProductionConfigError).remediation).toMatch(/ACS/);
    }
  });

  it('T5 — NODE_ENV=production + eRx configured but HI Service missing → throws', async () => {
    setFullProductionConfig();
    // eRx Adapter stays configured; drop HI Service
    delete process.env.HI_SERVICE_URL;
    delete process.env.HI_SERVICE_CERT_PATH;
    try {
      await assertProductionIntegrationsConfigured();
      throw new Error('expected ProductionConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(ProductionConfigError);
      expect((err as ProductionConfigError).remediation).toMatch(/HI Service/);
    }
  });

  it('T6 — NODE_ENV=production + HL7_LAB_PROTOCOL=mllp + no host/port → throws', async () => {
    setFullProductionConfig();
    process.env.HL7_LAB_PROTOCOL = 'mllp';
    delete process.env.HL7_MLLP_HOST;
    delete process.env.HL7_MLLP_PORT;
    try {
      await assertProductionIntegrationsConfigured();
      throw new Error('expected ProductionConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(ProductionConfigError);
      expect((err as ProductionConfigError).remediation).toMatch(/HL7/);
    }
  });

  it('T7 — NODE_ENV=development + all missing → does NOT throw', async () => {
    resetEnvToMinimal();
    process.env.NODE_ENV = 'development';
    // Everything missing, but dev mode tolerates.
    await expect(assertProductionIntegrationsConfigured()).resolves.toBeUndefined();
  });

  it('T8 — Full production config → resolves without throw', async () => {
    setFullProductionConfig();
    await expect(assertProductionIntegrationsConfigured()).resolves.toBeUndefined();
  });

  it('T9 — fcm sendToTokens in production without FCM_SERVICE_ACCOUNT_PATH → throws AppError FCM_NOT_CONFIGURED', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FCM_SERVICE_ACCOUNT_PATH;
    const { sendToTokens } = await import('../../src/integrations/fcm/fcmClient');
    await expect(sendToTokens(['test-token'], { title: 't', body: 'b' })).rejects.toMatchObject({
      code: 'FCM_NOT_CONFIGURED',
    });
  });

  it('T10 — acs sendSms in production without ACS_CONNECTION_STRING → throws AppError ACS_NOT_CONFIGURED', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ACS_CONNECTION_STRING;
    const { sendSms } = await import('../../src/integrations/acs/acsClient');
    await expect(sendSms({ to: '+61400000000', body: 'test' })).rejects.toMatchObject({
      code: 'ACS_NOT_CONFIGURED',
    });
  });

  it('T11 — ACS_CONNECTION_STRING set but ACS_FROM_PHONE unset → throws (mirror loadAcsConfig mockMode)', async () => {
    setFullProductionConfig();
    delete process.env.ACS_FROM_PHONE;
    try {
      await assertProductionIntegrationsConfigured();
      throw new Error('expected ProductionConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(ProductionConfigError);
      const e = err as ProductionConfigError;
      const acs = e.missing.find((m) => m.name === 'ACS (SMS)');
      expect(acs).toBeDefined();
      expect(acs!.envVars).toContain('ACS_FROM_PHONE');
    }
  });

  it('T12 — keyring-only PHI config passes production boot assertion', async () => {
    setFullProductionConfig();
    delete process.env.PHI_ENCRYPTION_KEY;
    process.env.PHI_ENCRYPTION_KEYRING_JSON = JSON.stringify({
      v1: 'b'.repeat(64),
      v2: 'c'.repeat(64),
    });
    process.env.PHI_ENCRYPTION_ACTIVE_KEY_VERSION = 'v2';
    await expect(assertProductionIntegrationsConfigured()).resolves.toBeUndefined();
  });

  it('T13 — malformed PHI keyring fails production boot assertion', async () => {
    setFullProductionConfig();
    delete process.env.PHI_ENCRYPTION_KEY;
    process.env.PHI_ENCRYPTION_KEYRING_JSON = '{"v1":"too-short"}';
    try {
      await assertProductionIntegrationsConfigured();
      throw new Error('expected ProductionConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(ProductionConfigError);
      const e = err as ProductionConfigError;
      expect(e.missing.some((m) => m.name === 'PHI_ENCRYPTION_KEYRING_JSON')).toBe(true);
    }
  });

  it('T14 — fcm sendToTokens in test mode without config returns fail-visible summary', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.FCM_SERVICE_ACCOUNT_PATH;
    const { sendToTokens } = await import('../../src/integrations/fcm/fcmClient');
    const out = await sendToTokens(['tok-a', 'tok-b'], { title: 't', body: 'b' });
    expect(out.successCount).toBe(0);
    expect(out.failureCount).toBe(2);
    expect(out.errorMessage).toContain('FCM_NOT_CONFIGURED');
  });

  it('T15 — acs sendSms in test mode without config returns fail-visible summary', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ACS_CONNECTION_STRING;
    delete process.env.ACS_FROM_PHONE;
    const { sendSms } = await import('../../src/integrations/acs/acsClient');
    const out = await sendSms({ to: '+61400000000', body: 'test' });
    expect(out.success).toBe(false);
    expect(out.operationId).toBeUndefined();
    expect(out.errorMessage).toContain('ACS_NOT_CONFIGURED');
  });
});
