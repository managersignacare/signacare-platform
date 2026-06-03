import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import {
  mintToken,
  verifyToken,
  IcalSecretMissingError,
} from '../src/features/calendar/icalTokenService';

// Phase 13 — icalTokenService unit tests. No DB, no network. The
// service takes the secret as an argument rather than reading
// config directly, so these tests are pure: no vi.stubEnv, no
// vi.resetModules, no module-cache gymnastics. The live config →
// secret wiring lives in calendarRoutes.ts and is exercised by
// the integration smoke later.
//
// Covers: round-trip, bad format, tampered signature, tampered
// payload, wrong clinician, wrong issuedAt (rotation knob),
// payload-with-wrong-field-count, and the missing-secret behaviour
// on both code paths (mint throws, verify returns null).

const SECRET = 'a'.repeat(64);
const OTHER_SECRET = 'b'.repeat(64);

const payload = {
  clinicId: '11111111-1111-1111-1111-111111111111',
  clinicianId: '22222222-2222-2222-2222-222222222222',
  issuedAt: '2026-04-15T10:00:00.000Z',
};

describe('icalTokenService — round-trip', () => {
  it('mint → verify succeeds for a valid token', () => {
    const token = mintToken(payload, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const verified = verifyToken(
      token,
      payload.clinicianId,
      payload.issuedAt,
      SECRET,
    );
    expect(verified).not.toBeNull();
    expect(verified?.clinicId).toBe(payload.clinicId);
    expect(verified?.clinicianId).toBe(payload.clinicianId);
    expect(verified?.issuedAt).toBe(payload.issuedAt);
  });

  it('same payload + same secret produces the same token (deterministic)', () => {
    expect(mintToken(payload, SECRET)).toBe(mintToken(payload, SECRET));
  });

  it('different issuedAt mints different tokens', () => {
    const a = mintToken(payload, SECRET);
    const b = mintToken(
      { ...payload, issuedAt: '2026-04-16T10:00:00.000Z' },
      SECRET,
    );
    expect(a).not.toBe(b);
  });

  it('different secret mints a different token for the same payload', () => {
    const a = mintToken(payload, SECRET);
    const b = mintToken(payload, OTHER_SECRET);
    expect(a).not.toBe(b);
  });
});

describe('icalTokenService — rejection modes', () => {
  it('returns null for a completely bogus string', () => {
    expect(
      verifyToken('not-a-token', payload.clinicianId, payload.issuedAt, SECRET),
    ).toBeNull();
    expect(
      verifyToken('', payload.clinicianId, payload.issuedAt, SECRET),
    ).toBeNull();
    expect(
      verifyToken(
        'one.two.three',
        payload.clinicianId,
        payload.issuedAt,
        SECRET,
      ),
    ).toBeNull();
  });

  it('tampered signature is rejected', () => {
    const token = mintToken(payload, SECRET);
    const [payloadPart] = token.split('.');
    const tampered = `${payloadPart}.AAAABBBBCCCCDDDD`;
    expect(
      verifyToken(
        tampered,
        payload.clinicianId,
        payload.issuedAt,
        SECRET,
      ),
    ).toBeNull();
  });

  it('tampered payload is rejected (signature no longer matches)', () => {
    const token = mintToken(payload, SECRET);
    const [, sigPart] = token.split('.');
    const badPayload = Buffer.from(
      'aaaa|bbbb|2026-04-15T10:00:00.000Z',
      'utf8',
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    expect(
      verifyToken(
        `${badPayload}.${sigPart}`,
        payload.clinicianId,
        payload.issuedAt,
        SECRET,
      ),
    ).toBeNull();
  });

  it('wrong expected clinician is rejected', () => {
    const token = mintToken(payload, SECRET);
    expect(
      verifyToken(
        token,
        '33333333-3333-3333-3333-333333333333',
        payload.issuedAt,
        SECRET,
      ),
    ).toBeNull();
  });

  it('wrong expected issuedAt is rejected (rotation knob)', () => {
    const token = mintToken(payload, SECRET);
    expect(
      verifyToken(
        token,
        payload.clinicianId,
        '2099-01-01T00:00:00.000Z',
        SECRET,
      ),
    ).toBeNull();
  });

  it('verifyToken handles a payload with the wrong field count', () => {
    const badCanonical = 'only|two';
    const badPayloadB64 = Buffer.from(badCanonical, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const validSig = createHmac('sha256', SECRET)
      .update(badCanonical)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    expect(
      verifyToken(
        `${badPayloadB64}.${validSig}`,
        payload.clinicianId,
        payload.issuedAt,
        SECRET,
      ),
    ).toBeNull();
  });

  it('token minted with secret A is rejected by verify with secret B', () => {
    const token = mintToken(payload, SECRET);
    expect(
      verifyToken(
        token,
        payload.clinicianId,
        payload.issuedAt,
        OTHER_SECRET,
      ),
    ).toBeNull();
  });
});

describe('icalTokenService — missing secret', () => {
  it('mintToken throws IcalSecretMissingError when secret is null', () => {
    expect(() => mintToken(payload, null)).toThrow(IcalSecretMissingError);
  });

  it('mintToken throws IcalSecretMissingError when secret is empty string', () => {
    expect(() => mintToken(payload, '')).toThrow(IcalSecretMissingError);
  });

  it('mintToken throws IcalSecretMissingError when secret is undefined', () => {
    expect(() => mintToken(payload, undefined)).toThrow(IcalSecretMissingError);
  });

  it('verifyToken returns null (never throws) when secret is missing', () => {
    const token = mintToken(payload, SECRET);
    expect(
      verifyToken(token, payload.clinicianId, payload.issuedAt, null),
    ).toBeNull();
    expect(
      verifyToken(token, payload.clinicianId, payload.issuedAt, ''),
    ).toBeNull();
    expect(
      verifyToken(token, payload.clinicianId, payload.issuedAt, undefined),
    ).toBeNull();
  });
});

describe('icalTokenService — rotation invariants', () => {
  it('rotating clinician issuedAt invalidates every old token', () => {
    const oldIssuedAt = '2026-04-15T10:00:00.000Z';
    const rotatedAt = '2026-04-16T09:30:00.000Z';

    const oldToken = mintToken({ ...payload, issuedAt: oldIssuedAt }, SECRET);

    // After rotation, staff_settings has rotatedAt. The old URL
    // still carries the old issuedAt and must be rejected.
    expect(
      verifyToken(oldToken, payload.clinicianId, rotatedAt, SECRET),
    ).toBeNull();

    // New token minted against the new issuedAt verifies.
    const newToken = mintToken({ ...payload, issuedAt: rotatedAt }, SECRET);
    expect(
      verifyToken(newToken, payload.clinicianId, rotatedAt, SECRET),
    ).not.toBeNull();
  });

  it('rotation is instant — no grace window, no overlap', () => {
    const atA = '2026-04-15T10:00:00.000Z';
    const atB = '2026-04-15T10:00:00.001Z';
    const tokenA = mintToken({ ...payload, issuedAt: atA }, SECRET);
    const tokenB = mintToken({ ...payload, issuedAt: atB }, SECRET);
    // Each token only verifies against its exact issuedAt.
    expect(
      verifyToken(tokenA, payload.clinicianId, atA, SECRET),
    ).not.toBeNull();
    expect(
      verifyToken(tokenA, payload.clinicianId, atB, SECRET),
    ).toBeNull();
    expect(
      verifyToken(tokenB, payload.clinicianId, atB, SECRET),
    ).not.toBeNull();
  });
});
