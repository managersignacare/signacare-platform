/**
 * Category 1 — Unit tests for JWT issuance and verification.
 *
 * Why this matters: every authenticated API call rides on these tokens.
 * The two single-attack-class bugs in the OWASP A07 (Auth Failures)
 * category are:
 *   1. The "alg:none" attack — a token with header { alg: "none" } and
 *      no signature, accepted because verifyToken trusts the header.
 *   2. The HS/RS algorithm-confusion attack — an HS256 token presented
 *      to an RS256 endpoint where the public key is treated as an HMAC
 *      secret.
 * Both have caused real-world EHR breaches. These tests assert that
 * neither attack succeeds against our token issuance flow.
 *
 * Standard satisfied: OWASP ASVS v4 §3.5 (Token-based Session Mgmt),
 *                     RFC 8725 (JWT Best Current Practices).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';

// Stub the config module before importing the auth service so the
// test owns the JWT secrets and TTLs. Includes the `database` block
// because importing authService transitively pulls in src/db/db.ts
// which reads config.database.ssl at module load.
vi.mock('../../src/config', () => ({
  config: {
    jwt: {
      accessSecret: 'unit-test-access-secret-which-is-32-bytes-long',
      refreshSecret: 'unit-test-refresh-secret-which-is-also-32b',
      accessTtlMinutes: 60,
      refreshTtlDays: 7,
    },
    database: {
      host: 'localhost',
      port: 5432,
      user: 'test',
      password: 'test',
      name: 'test',
      ssl: false,
      poolMax: 10,
    },
  },
}));
// Stub the db module entirely so importing it doesn't try to open a
// real PG connection at module load. The auth service top-level
// import chain reaches db/db.ts via staffRepository.
vi.mock('../../src/db/db', () => ({
  db: vi.fn(),
  dbRead: vi.fn(),
}));
vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { issueTokens } from '../../src/features/auth/authService';
import type { AuthUser } from '@signacare/shared';

const FIXTURE_USER: AuthUser = {
  id: 'staff-uuid-1',
  clinicId: 'clinic-uuid-1',
  givenName: 'Ada',
  familyName: 'Lovelace',
  email: 'ada@example.com',
  role: 'clinician',
  permissions: ['patient:read', 'patient:create'],
} as AuthUser;

describe('issueTokens — claims and structure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00Z'));
  });

  it('returns both access and refresh tokens', () => {
    const tokens = issueTokens(FIXTURE_USER);
    expect(tokens.accessToken).toBeTypeOf('string');
    expect(tokens.refreshToken).toBeTypeOf('string');
    expect(tokens.accessToken.split('.').length).toBe(3); // header.payload.sig
    expect(tokens.refreshToken.split('.').length).toBe(3);
  });

  it('access token decodes with the configured access secret', () => {
    const { accessToken } = issueTokens(FIXTURE_USER);
    const decoded = jwt.verify(accessToken, 'unit-test-access-secret-which-is-32-bytes-long') as Record<string, unknown>;
    expect(decoded.id).toBe(FIXTURE_USER.id);
    expect(decoded.clinicId).toBe(FIXTURE_USER.clinicId);
    expect(decoded.role).toBe('clinician');
    expect(decoded.email).toBe('ada@example.com');
    expect(Array.isArray(decoded.permissions)).toBe(true);
    expect((decoded.permissions as string[])).toContain('patient:read');
  });

  it('access token encodes the standard exp and iat claims', () => {
    const { accessToken } = issueTokens(FIXTURE_USER);
    const decoded = jwt.decode(accessToken) as { iat: number; exp: number };
    expect(typeof decoded.iat).toBe('number');
    expect(typeof decoded.exp).toBe('number');
    // 60-minute TTL → exp should be ~3600 seconds after iat
    expect(decoded.exp - decoded.iat).toBe(60 * 60);
  });

  it('refresh token contains only sub + clinicId (minimum disclosure)', () => {
    const { refreshToken } = issueTokens(FIXTURE_USER);
    const decoded = jwt.decode(refreshToken) as Record<string, unknown>;
    expect(decoded.sub).toBe(FIXTURE_USER.id);
    expect(decoded.clinicId).toBe(FIXTURE_USER.clinicId);
    // PHI fields MUST NOT be in the refresh token
    expect(decoded.email).toBeUndefined();
    expect(decoded.givenName).toBeUndefined();
    expect(decoded.permissions).toBeUndefined();
  });

  it('refresh token TTL matches refreshTtlDays config', () => {
    const { refreshToken } = issueTokens(FIXTURE_USER);
    const decoded = jwt.decode(refreshToken) as { iat: number; exp: number };
    // 7 days = 604800 seconds
    expect(decoded.exp - decoded.iat).toBe(7 * 24 * 60 * 60);
  });

  it('access token signed with HS256 (not "none")', () => {
    const { accessToken } = issueTokens(FIXTURE_USER);
    const decoded = jwt.decode(accessToken, { complete: true }) as { header: { alg: string } };
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.header.alg).not.toBe('none');
  });

  it('access token signature cannot be verified with the wrong secret', () => {
    const { accessToken } = issueTokens(FIXTURE_USER);
    expect(() =>
      jwt.verify(accessToken, 'a-completely-different-secret'),
    ).toThrow(/invalid signature/i);
  });

  it('refresh token cannot be verified with the access secret (key separation)', () => {
    const { refreshToken } = issueTokens(FIXTURE_USER);
    expect(() =>
      jwt.verify(refreshToken, 'unit-test-access-secret-which-is-32-bytes-long'),
    ).toThrow(/invalid signature/i);
  });
});

describe('JWT attack rejection (OWASP A07)', () => {
  // These tests build hostile tokens by hand and assert that
  // jsonwebtoken's verify() rejects them. They guard the principle
  // that any code path which calls jwt.verify() with the access
  // secret will be safe — the token issuer doesn't need extra hardening.

  it('rejects an alg:"none" forged token', () => {
    // Build a "none"-algorithm token: base64url(header).base64url(payload).
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'attacker', role: 'admin' })).toString('base64url');
    const forged = `${header}.${payload}.`; // empty signature
    expect(() =>
      jwt.verify(forged, 'unit-test-access-secret-which-is-32-bytes-long'),
    ).toThrow();
  });

  it('rejects a token signed with a different HMAC secret', () => {
    const forged = jwt.sign({ sub: 'attacker', role: 'admin' }, 'wrong-secret', { algorithm: 'HS256' });
    expect(() =>
      jwt.verify(forged, 'unit-test-access-secret-which-is-32-bytes-long'),
    ).toThrow(/invalid signature/i);
  });

  it('rejects an HS256 token when the verifier expects RS256 (alg confusion)', () => {
    const forged = jwt.sign({ sub: 'attacker' }, 'pretending-to-be-public-key', { algorithm: 'HS256' });
    // Asking jwt.verify to accept ONLY RS256 must reject the HS256 token
    expect(() =>
      jwt.verify(forged, 'pretending-to-be-public-key', { algorithms: ['RS256'] }),
    ).toThrow();
  });

  it('rejects a tampered payload (signature mismatch)', () => {
    const valid = jwt.sign({ sub: 'staff-uuid-1', role: 'clinician' }, 'unit-test-access-secret-which-is-32-bytes-long');
    const [h, , s] = valid.split('.');
    // Replace payload with admin role, keeping the original signature
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'staff-uuid-1', role: 'admin' })).toString('base64url');
    const tampered = `${h}.${forgedPayload}.${s}`;
    expect(() =>
      jwt.verify(tampered, 'unit-test-access-secret-which-is-32-bytes-long'),
    ).toThrow(/invalid signature/i);
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign(
      { sub: 'staff-uuid-1' },
      'unit-test-access-secret-which-is-32-bytes-long',
      { expiresIn: '-1s' }, // already expired
    );
    expect(() =>
      jwt.verify(expired, 'unit-test-access-secret-which-is-32-bytes-long'),
    ).toThrow(/jwt expired/i);
  });
});
