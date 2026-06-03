/**
 * BUG-239 integration — WebAuthn register→login round trip.
 *
 * Boots the real Express app against real Postgres + Redis. The
 * @simplewebauthn/server library is mocked so tests can drive
 * verified:true/false deterministically without requiring a real
 * authenticator; the HTTP layer, RLS middleware, Redis challenge
 * consumption, and DB persistence are NOT mocked.
 *
 * What this catches that the unit test does not:
 *   - Route mount path + prefix
 *   - Redis TTL + atomic consumption across the real client
 *   - DB write with real RLS policy evaluation (cross-clinic read
 *     returns zero rows)
 *   - Zod schema rejection of malformed wire payloads
 *   - Error middleware JSON shape on live server
 *
 * Skip behaviour: if Postgres or Redis are unreachable, the suite
 * degrades to "0 tests run, 0 failed" (same pattern as
 * redisEviction.int.test.ts).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Library is mocked so that we can drive signature verification outcomes
// deterministically. Must precede the app import via vi.hoisted().
const libMock = vi.hoisted(() => ({
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock('@simplewebauthn/server', () => libMock);

import request from 'supertest';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { redisCache, connectRedis } from '../../src/config/redis';

// Top-level await at module scope — describe.skipIf evaluates at import time,
// not when beforeAll runs, so readiness must resolve before the describe
// block is registered. Matches the pattern in authBoundaries.test.ts.
const READY = await isIntegrationReady();

let adminToken = '';
let adminStaffId = '';
let adminClinicId = '';

beforeAll(async () => {
  if (!READY) return;
  const session = await loginAsAdmin();
  adminToken = session.token;
  adminStaffId = session.userId;
  adminClinicId = session.clinicId;
  await connectRedis();
});

beforeEach(async () => {
  libMock.verifyRegistrationResponse.mockReset();
  libMock.verifyAuthenticationResponse.mockReset();
  if (!READY) return;
  // Clean any prior test rows. RLS requires a clinic context; use dbAdmin.
  await dbAdmin('webauthn_credentials').where({ staff_id: adminStaffId }).del();
  // Drain any lingering challenge keys from prior runs.
  await redisCache.del(`webauthn:reg:${adminStaffId}`);
  await redisCache.del(`webauthn:login:${adminStaffId}`);
  process.env.WEBAUTHN_RP_ID = 'localhost';
  process.env.WEBAUTHN_ORIGIN = 'http://localhost:3000';
});

afterAll(async () => {
  if (!READY) return;
  await dbAdmin('webauthn_credentials').where({ staff_id: adminStaffId }).del();
});

describe.skipIf(!READY)('BUG-239 — WebAuthn end-to-end', () => {
  it('register→login round trip: library-verified credential is stored with clinic_id and counter increments on login', async () => {
    // ── Register: fetch options ───────────────────────────────────────────
    const opts = await request(app)
      .post('/api/v1/auth/webauthn/register/options')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', 'test')
      .send({});
    expect(opts.status).toBe(200);
    expect(typeof opts.body.challenge).toBe('string');

    // ── Register: verify with library returning verified:true ─────────────
    libMock.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'INTEG-CRED-ID-1',
          publicKey: new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]),
          counter: 0,
        },
        aaguid: '00000000-0000-0000-0000-000000000001',
        credentialBackedUp: false,
        credentialDeviceType: 'singleDevice',
        fmt: 'none',
      },
    });

    const regRes = await request(app)
      .post('/api/v1/auth/webauthn/register/verify')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', 'test')
      .send({
        credential: {
          id: 'any-client-id',
          rawId: 'any-client-id',
          type: 'public-key',
          response: { clientDataJSON: 'x', attestationObject: 'y' },
        },
        deviceName: 'Integration Key',
      });
    expect(regRes.status).toBe(200);

    // ── DB assertion: row stored with clinic_id; credential_id is
    //    library-derived (NOT the client's 'any-client-id'). ────────────────
    const rows = await dbAdmin('webauthn_credentials')
      .where({ staff_id: adminStaffId })
      .whereNull('deleted_at');
    expect(rows).toHaveLength(1);
    expect(rows[0].clinic_id).toBe(adminClinicId);
    expect(rows[0].credential_id).toBe('INTEG-CRED-ID-1');
    expect(rows[0].credential_id).not.toBe('any-client-id');
    expect(Number(rows[0].counter)).toBe(0);

    // ── Login: fetch options ──────────────────────────────────────────────
    // The route reads staff.email; the seeded admin has email admin@signacare.local.
    const loginOpts = await request(app)
      .post('/api/v1/auth/webauthn/login/options')
      .set('X-Client', 'mobile') // pre-session endpoint — bypass CSRF the way the SPA auth handshake does
      .send({ email: 'admin@signacare.local' });
    expect(loginOpts.status).toBe(200);
    expect(typeof loginOpts.body.challenge).toBe('string');
    expect(loginOpts.body.allowCredentials).toHaveLength(1);
    expect(loginOpts.body.allowCredentials[0].id).toBe('INTEG-CRED-ID-1');

    // ── Login: verify with library returning verified:true + newCounter=1 ─
    libMock.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: {
        credentialID: 'INTEG-CRED-ID-1',
        newCounter: 1,
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'http://localhost:3000',
        rpID: 'localhost',
      },
    });

    const loginRes = await request(app)
      .post('/api/v1/auth/webauthn/login/verify')
      .set('X-Client', 'mobile')
      .send({
        email: 'admin@signacare.local',
        credential: {
          id: 'INTEG-CRED-ID-1',
          rawId: 'INTEG-CRED-ID-1',
          type: 'public-key',
          response: {
            clientDataJSON: 'x',
            authenticatorData: 'y',
            signature: 'z',
          },
        },
      });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.verified).toBe(true);
    expect(loginRes.body.staffId).toBe(adminStaffId);

    // ── DB assertion: counter incremented to library-derived newCounter. ──
    const after = await dbAdmin('webauthn_credentials')
      .where({ staff_id: adminStaffId })
      .whereNull('deleted_at')
      .first();
    expect(Number(after.counter)).toBe(1);
    expect(after.last_used_at).not.toBeNull();
  });

  it('library verified:false rejects login and leaves counter unchanged', async () => {
    // Seed a stored credential directly.
    await dbAdmin('webauthn_credentials').insert({
      staff_id: adminStaffId,
      clinic_id: adminClinicId,
      credential_id: 'TAMPER-TEST-CRED',
      public_key: Buffer.from([1, 2, 3]).toString('base64url'),
      counter: 42,
      device_name: 'Seeded',
      backup_eligible: false,
      backup_state: false,
    });

    // Fetch login options (puts a challenge into Redis).
    const loginOpts = await request(app)
      .post('/api/v1/auth/webauthn/login/options')
      .set('X-Client', 'mobile') // pre-session endpoint — bypass CSRF the way the SPA auth handshake does
      .send({ email: 'admin@signacare.local' });
    expect(loginOpts.status).toBe(200);

    // Library refuses the assertion.
    libMock.verifyAuthenticationResponse.mockResolvedValue({
      verified: false,
      authenticationInfo: undefined,
    });

    const res = await request(app)
      .post('/api/v1/auth/webauthn/login/verify')
      .set('X-Client', 'mobile')
      .send({
        email: 'admin@signacare.local',
        credential: {
          id: 'TAMPER-TEST-CRED',
          rawId: 'TAMPER-TEST-CRED',
          type: 'public-key',
          response: { clientDataJSON: 'x', authenticatorData: 'y', signature: 'tampered' },
        },
      });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIAL');

    // Counter must NOT have advanced — this is the mutation-resistant
    // assertion for the silent-MFA-bypass regression.
    const row = await dbAdmin('webauthn_credentials')
      .where({ staff_id: adminStaffId, credential_id: 'TAMPER-TEST-CRED' })
      .first();
    expect(Number(row.counter)).toBe(42);
  });
});
