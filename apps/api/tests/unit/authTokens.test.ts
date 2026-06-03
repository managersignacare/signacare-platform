/**
 * BUG-463 — unit tests for the JWT-payload discriminated union and
 * verifyAccessToken/discriminate helpers in `apps/api/src/utils/authTokens.ts`.
 *
 * Two-axis coverage:
 *   - Type-axis (compile-time): payload narrows correctly when `kind` is
 *     checked. Asserts that staff fields are inaccessible from the
 *     patient_app variant and vice-versa via `// @ts-expect-error`.
 *   - Behavior-axis (runtime): invalid signature + expired tokens throw,
 *     `discriminate` is pure, and each issuer's payload shape resolves
 *     to the correct variant tag.
 *
 * Pre-fix RED gate: the file `apps/api/src/utils/authTokens.ts` does not
 * yet exist, so every test in this file fails at module-load time with
 * `Cannot find module '../../src/utils/authTokens'`.
 *
 * Post-fix: 8/8 GREEN.
 */

import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';

// Stub the config module BEFORE importing authTokens so the tests own
// the JWT secret. The signature-verify path in verifyAccessToken reads
// `config.jwt.accessSecret`; if config tries to load real env it fails
// the unit-suite gate.
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
vi.mock('../../src/db/db', () => ({ db: vi.fn(), dbRead: vi.fn() }));
vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  verifyAccessToken,
  discriminate,
  type AccessTokenPayload,
} from '../../src/utils/authTokens';

const ACCESS_SECRET = 'unit-test-access-secret-which-is-32-bytes-long';

const STAFF_FIXTURE = {
  id: '11111111-1111-1111-1111-111111111111',
  clinicId: '22222222-2222-2222-2222-222222222222',
  givenName: 'Ada',
  familyName: 'Lovelace',
  email: 'ada@example.com',
  role: 'clinician' as const,
  permissions: ['patient:read', 'patient:create'] as const,
};

const sign = (claims: Record<string, unknown>, opts?: jwt.SignOptions): string =>
  jwt.sign(claims, ACCESS_SECRET, { algorithm: 'HS256', expiresIn: '1h', ...opts });

describe('BUG-463 — verifyAccessToken discriminates JWT-payload variants', () => {
  it('staff JWT discriminates as kind === "staff"', () => {
    const token = sign({ ...STAFF_FIXTURE });
    const payload = verifyAccessToken(token);
    expect(payload.kind).toBe('staff');
    expect(payload.id).toBe(STAFF_FIXTURE.id);
    expect(payload.clinicId).toBe(STAFF_FIXTURE.clinicId);
    expect(payload.role).toBe('clinician');
  });

  it('break-glass JWT discriminates as kind === "staff_break_glass"', () => {
    const sessionId = 'bg-session-uuid';
    const token = sign({ ...STAFF_FIXTURE, breakGlass: true, breakGlassSessionId: sessionId });
    const payload = verifyAccessToken(token);
    expect(payload.kind).toBe('staff_break_glass');
    if (payload.kind === 'staff_break_glass') {
      // Non-optional access — TS narrows.
      expect(payload.breakGlassSessionId).toBe(sessionId);
      expect(payload.breakGlass).toBe(true);
    }
  });

  it('impersonation JWT discriminates as kind === "staff_impersonation"', () => {
    const impersonator = 'admin-uuid';
    const sessionId = 'imp-session-uuid';
    const token = sign({
      ...STAFF_FIXTURE,
      impersonator,
      impersonationSessionId: sessionId,
    });
    const payload = verifyAccessToken(token);
    expect(payload.kind).toBe('staff_impersonation');
    if (payload.kind === 'staff_impersonation') {
      expect(payload.impersonator).toBe(impersonator);
      expect(payload.impersonationSessionId).toBe(sessionId);
    }
  });

  it('patient-app JWT discriminates as kind === "patient_app"', () => {
    const patientId = '33333333-3333-3333-3333-333333333333';
    const token = sign({
      id: 'pa-account-uuid',
      patientId,
      clinicId: STAFF_FIXTURE.clinicId,
      givenName: 'Sam',
      familyName: 'Smith',
      role: 'patient',
      isPatientApp: true,
    });
    const payload = verifyAccessToken(token);
    expect(payload.kind).toBe('patient_app');
    if (payload.kind === 'patient_app') {
      // Non-optional patientId — TS narrows.
      expect(payload.patientId).toBe(patientId);
      expect(payload.isPatientApp).toBe(true);
      expect(payload.role).toBe('patient');
    }
  });

  it('TS narrows correctly inside `kind === "staff"` (compile-time check)', () => {
    const token = sign({ ...STAFF_FIXTURE });
    const payload: AccessTokenPayload = verifyAccessToken(token);
    if (payload.kind === 'staff') {
      // Inside this block, payload is StaffAccessClaims. The following
      // accesses MUST fail to compile per the discriminated-union shape:
      // @ts-expect-error — breakGlassSessionId not present on staff variant
      void payload.breakGlassSessionId;
      // @ts-expect-error — patientId not present on staff variant
      void payload.patientId;
      // @ts-expect-error — impersonator not present on staff variant
      void payload.impersonator;
    }
    // Sanity — assertion inside expect to avoid an empty-test warning
    expect(payload.kind).toBe('staff');
  });

  it('invalid signature throws', () => {
    const forged = jwt.sign({ ...STAFF_FIXTURE }, 'wrong-secret', { algorithm: 'HS256' });
    expect(() => verifyAccessToken(forged)).toThrow();
  });

  it('expired token throws', () => {
    const expired = sign({ ...STAFF_FIXTURE }, { expiresIn: '-1s' });
    expect(() => verifyAccessToken(expired)).toThrow();
  });

  it('discriminate is pure — repeated calls produce identical narrowed shape', () => {
    const raw = {
      id: 'pa-account-uuid',
      clinicId: STAFF_FIXTURE.clinicId,
      role: 'patient',
      givenName: 'Patient',
      familyName: 'App',
      iat: 1_000_000,
      exp: 1_000_000 + 3600,
      isPatientApp: true as const,
      patientId: '44444444-4444-4444-4444-444444444444',
    };
    const a = discriminate({ ...raw });
    const b = discriminate({ ...raw });
    expect(a).toEqual(b);
    expect(a.kind).toBe('patient_app');
    expect(b.kind).toBe('patient_app');
  });

  it('rejects hybrid patient/staff payloads that attempt role escalation', () => {
    const hybrid = sign({
      ...STAFF_FIXTURE,
      role: 'superadmin',
      isPatientApp: true,
      patientId: '44444444-4444-4444-4444-444444444444',
    });
    expect(() => verifyAccessToken(hybrid)).toThrow(/role" must be "patient"/i);
  });

  it('rejects patient-app payload when role is not exactly "patient"', () => {
    const malformed = sign({
      id: 'pa-account-uuid',
      patientId: '33333333-3333-3333-3333-333333333333',
      clinicId: STAFF_FIXTURE.clinicId,
      givenName: 'Sam',
      familyName: 'Smith',
      role: 'clinician',
      isPatientApp: true,
    });
    expect(() => verifyAccessToken(malformed)).toThrow(/role" must be "patient"/i);
  });
});
