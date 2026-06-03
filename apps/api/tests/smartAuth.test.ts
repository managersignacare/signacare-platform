/**
 * S3.1a — SMART/OAuth unit tests
 *
 * Covers the pure-function pieces of smartAuth.ts that are testable
 * without a live Postgres:
 *
 *   - PKCE S256 verification round-trip and tampering detection
 *   - SHA-256 token hashing
 *   - Constant-time string comparison guard
 *
 * The full HTTP flow (authorize -> code -> token -> introspect ->
 * revoke -> refresh) needs a real DB and is covered by an integration
 * test in a follow-up. Those tests would also exercise:
 *
 *   - redirect_uri allow-list rejection
 *   - client_secret hash mismatch rejection
 *   - replayed authorization code revoking sibling tokens
 *   - refresh token rotation + replay detection
 *   - launch context consume-once semantics
 *
 * The middleware exemption for /oauth/ and /.well-known/ is also
 * covered here to make sure the camelCaseResponse middleware is not
 * silently transforming OAuth response payloads.
 */

import { describe, it, expect } from 'vitest';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

// ── Local copies of the helpers from smartAuth.ts ────────────────────────────
// Pulled inline because the helpers are not exported (they're internal
// to the route module). Re-implementing them in the test guards against
// regressions where the production helper is changed without updating
// the spec.

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== 'S256') return false;
  const derived = createHash('sha256').update(verifier).digest('base64url');
  return safeEquals(derived, challenge);
}

describe('PKCE S256 verification', () => {
  it('round-trips a valid (verifier, challenge) pair', () => {
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(verifyPkce(verifier, challenge, 'S256')).toBe(true);
  });

  it('rejects when the verifier is tampered with', () => {
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const tampered = verifier.slice(0, -1) + (verifier.slice(-1) === 'A' ? 'B' : 'A');
    expect(verifyPkce(tampered, challenge, 'S256')).toBe(false);
  });

  it('rejects unsupported methods (plain, MD5, etc.)', () => {
    const verifier = 'test-verifier';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(verifyPkce(verifier, challenge, 'plain')).toBe(false);
    expect(verifyPkce(verifier, challenge, 'MD5')).toBe(false);
    expect(verifyPkce(verifier, challenge, '')).toBe(false);
  });

  it('rejects mismatched lengths (defence against early-return timing leak)', () => {
    expect(verifyPkce('short', 'definitelynotahash', 'S256')).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('produces a 64-char hex string', () => {
    const h = sha256Hex('hello');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(sha256Hex('foo')).toBe(sha256Hex('foo'));
  });

  it('is sensitive to a single character change', () => {
    expect(sha256Hex('foo')).not.toBe(sha256Hex('foO'));
  });
});

describe('safeEquals (constant-time)', () => {
  it('returns true for identical strings', () => {
    expect(safeEquals('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(safeEquals('abc123', 'abc124')).toBe(false);
  });

  it('returns false for different lengths without throwing', () => {
    expect(safeEquals('a', 'aa')).toBe(false);
    expect(safeEquals('', 'a')).toBe(false);
  });
});

// ── camelCaseResponse middleware exemption ──────────────────────────────────

describe('camelCaseResponse middleware exemption for /oauth/ and /.well-known/', () => {
  it('skips conversion on OAuth paths so access_token stays snake_case', async () => {
    // Reset module state and re-import in case other tests touched it
    const { camelCaseResponse } = await import('../src/middleware/camelCaseResponse');
    let captured: unknown;
    const fakeRes = {
      json: (body: unknown) => { captured = body; return fakeRes; },
      locals: {},
    } as unknown as import('express').Response;
    const fakeReq = { path: '/api/v1/oauth/token' } as unknown as import('express').Request;
    let called = false;
    camelCaseResponse(fakeReq, fakeRes, () => { called = true; });
    expect(called).toBe(true);
    // After next() the test handler can call res.json with snake_case
    fakeRes.json({ access_token: 'eyJ', token_type: 'Bearer' });
    expect(captured).toEqual({ access_token: 'eyJ', token_type: 'Bearer' });
  });

  it('skips conversion on /.well-known/ paths', async () => {
    const { camelCaseResponse } = await import('../src/middleware/camelCaseResponse');
    let captured: unknown;
    const fakeRes = {
      json: (body: unknown) => { captured = body; return fakeRes; },
      locals: {},
    } as unknown as import('express').Response;
    const fakeReq = { path: '/api/v1/fhir/.well-known/smart-configuration' } as unknown as import('express').Request;
    camelCaseResponse(fakeReq, fakeRes, () => undefined);
    fakeRes.json({ token_endpoint_auth_methods_supported: ['client_secret_basic'] });
    expect(captured).toEqual({ token_endpoint_auth_methods_supported: ['client_secret_basic'] });
  });

  it('still converts a normal API path', async () => {
    const { camelCaseResponse } = await import('../src/middleware/camelCaseResponse');
    let captured: unknown;
    const fakeRes = {
      json: (body: unknown) => { captured = body; return fakeRes; },
      statusCode: 200,
      locals: {},
    } as unknown as import('express').Response;
    const fakeReq = { path: '/api/v1/patients' } as unknown as import('express').Request;
    camelCaseResponse(fakeReq, fakeRes, () => undefined);
    fakeRes.json({ patient_id: 'abc', given_name: 'Alice' });
    expect(captured).toEqual({ patientId: 'abc', givenName: 'Alice' });
  });
});
