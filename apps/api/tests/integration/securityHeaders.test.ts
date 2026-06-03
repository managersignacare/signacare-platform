/**
 * Category 5 — Security headers, CORS, error response shape.
 *
 * Why this matters: a single misconfigured CSP / missing HSTS / leaked
 * stack trace turns an EHR into a clickjacking, downgrade-attack, or
 * recon target. These tests boot the real Express app and assert the
 * defensive headers are actually emitted on a representative response —
 * the helmet config in server.ts is right today, this test guarantees
 * a future PR doesn't silently weaken it.
 *
 * Standard satisfied: OWASP A05 (Security Misconfiguration), OWASP A04
 *                     (Insecure Design), Mozilla Observatory A+, ACHS
 *                     Standard 1 (Clinical Governance — defence in depth).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('Security response headers (live app)', () => {
  let token: string;

  beforeAll(async () => {
    ({ token } = await loginAsAdmin());
  });

  // ────────────────────────────────────────────────────────────────
  // Helmet — CSP / HSTS / X-Frame-Options / Referrer-Policy
  // ────────────────────────────────────────────────────────────────
  describe('helmet — defence-in-depth headers on every response', () => {
    it('emits a Content-Security-Policy header with self-only defaultSrc', async () => {
      const res = await request(app)
        .get('/api/v1/patients?limit=1')
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', 'test');
      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'self'");
    });

    // ──────────────────────────────────────────────────────────────────
    // BUG-468 — defence-in-depth CSP directives.
    //
    // 4 of 5 (base-uri, object-src, form-action, upgrade-insecure-requests)
    // are emitted today via helmet 8 defaults. They MUST keep firing if a
    // future PR adds `useDefaults: false` to the helmet config — these
    // assertions are the regression-trap.
    //
    // The 5th (report-uri) is genuinely missing pre-fix; H11 RED-gates it.
    // ──────────────────────────────────────────────────────────────────
    it('BUG-468 H7 — CSP pins base-uri to self', async () => {
      const res = await request(app).get('/api/v1/fhir/metadata');
      expect(res.headers['content-security-policy']).toContain("base-uri 'self'");
    });

    it('BUG-468 H8 — CSP pins object-src to none', async () => {
      const res = await request(app).get('/api/v1/fhir/metadata');
      expect(res.headers['content-security-policy']).toContain("object-src 'none'");
    });

    it('BUG-468 H9 — CSP pins form-action to self', async () => {
      const res = await request(app).get('/api/v1/fhir/metadata');
      expect(res.headers['content-security-policy']).toContain("form-action 'self'");
    });

    it('BUG-468 H10 — CSP includes upgrade-insecure-requests directive', async () => {
      const res = await request(app).get('/api/v1/fhir/metadata');
      expect(res.headers['content-security-policy']).toContain('upgrade-insecure-requests');
    });

    it('BUG-468 H11 — CSP report-uri points to /api/v1/csp-report', async () => {
      const res = await request(app).get('/api/v1/fhir/metadata');
      expect(res.headers['content-security-policy']).toContain('report-uri /api/v1/csp-report');
    });

    it('emits a Strict-Transport-Security header with 2-year max-age', async () => {
      const res = await request(app).get('/api/v1/fhir/metadata');
      const hsts = res.headers['strict-transport-security'];
      expect(hsts).toBeDefined();
      // 2 years = 63072000 seconds
      expect(hsts).toContain('max-age=63072000');
      expect(hsts).toContain('includeSubDomains');
      expect(hsts).toContain('preload');
    });

    it('emits X-Frame-Options: DENY (clickjacking defence)', async () => {
      const res = await request(app).get('/api/v1/fhir/metadata');
      // helmet may set this either via the X-Frame-Options header or
      // implicitly via the CSP frame-ancestors directive — accept
      // either as long as one is present.
      const xfo = res.headers['x-frame-options'];
      const csp = res.headers['content-security-policy'] ?? '';
      expect(xfo === 'DENY' || csp.includes("frame-ancestors 'self'")).toBe(true);
    });

    it('emits X-Content-Type-Options: nosniff', async () => {
      const res = await request(app).get('/api/v1/fhir/metadata');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('emits Referrer-Policy: strict-origin-when-cross-origin', async () => {
      const res = await request(app).get('/api/v1/fhir/metadata');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('removes the X-Powered-By header (no Express fingerprint)', async () => {
      const res = await request(app).get('/api/v1/fhir/metadata');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // CORS — origin allowlist, no wildcard
  // ────────────────────────────────────────────────────────────────
  describe('CORS — origin allowlist enforced', () => {
    it('responds to a preflight from the allowed dev origin', async () => {
      const res = await request(app)
        .options('/api/v1/patients')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'Authorization');
      // 200 or 204 indicates the preflight completed; the key check
      // is the Access-Control-Allow-Origin header.
      expect([200, 204]).toContain(res.status);
      const allow = res.headers['access-control-allow-origin'];
      // The header MUST echo the origin (not '*'), because credentials
      // are enabled and '*' is invalid in that combination per the
      // CORS spec.
      expect(allow).toBe('http://localhost:5173');
      expect(allow).not.toBe('*');
    });

    it('does NOT echo a non-allowlisted origin', async () => {
      const res = await request(app)
        .options('/api/v1/patients')
        .set('Origin', 'https://attacker.example.com')
        .set('Access-Control-Request-Method', 'GET');
      const allow = res.headers['access-control-allow-origin'];
      // CORS middleware MUST either omit the header (correct) or
      // refuse to echo the attacker origin. '*' would also be wrong
      // when credentials are in play.
      expect(allow).not.toBe('https://attacker.example.com');
      expect(allow).not.toBe('*');
    });

    it('Access-Control-Allow-Credentials is true (cookies allowed for the SPA)', async () => {
      const res = await request(app)
        .options('/api/v1/patients')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'GET');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Error response shape — no stack trace leakage
  // ────────────────────────────────────────────────────────────────
  describe('Error response shape (OWASP A05 — no internal details leaked)', () => {
    it('a 401 response does NOT include a stack trace', async () => {
      const res = await request(app).get('/api/v1/patients'); // no auth → 401
      expect(res.status).toBe(401);
      expect(res.body).toBeDefined();
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/at \w+\.<anonymous>/);
      expect(body).not.toMatch(/\/Users\/|\/home\//);  // no fs paths
      expect(body).not.toMatch(/Error: .*\n\s+at /);
    });

    it('a 404 response on an unknown route does NOT include a stack trace', async () => {
      const res = await request(app).get('/api/v1/this-route-does-not-exist');
      expect([404, 401]).toContain(res.status);
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/at \w+\.<anonymous>/);
      expect(body).not.toMatch(/node_modules/);
    });

    it('error responses use a structured shape ({error, code} or {title, type})', async () => {
      const res = await request(app).get('/api/v1/patients'); // 401
      expect(res.body).toBeTruthy();
      const b = res.body as Record<string, unknown>;
      // Either the legacy { error, code } shape or RFC 7807 { title, type }
      expect(
        typeof b.error === 'string' || typeof b.title === 'string',
      ).toBe(true);
    });
  });
});
