/**
 * BUG-468 — integration tests for the CSP-violation report endpoint
 * `POST /api/v1/csp-report`.
 *
 * Pre-fix RED gate: the route file `apps/api/src/features/security/cspReportRoutes.ts`
 * does NOT exist; the import chain in server.ts fails to resolve, so every
 * test fails at the module-load boundary OR at the route-not-found 404.
 *
 * Post-fix: 6/6 GREEN.
 *
 * The endpoint is unauthenticated by W3C `report-uri` design — browsers
 * cannot necessarily attach cookies cross-origin during a CSP violation.
 * Authentication absence is asserted explicitly by C5.
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { isIntegrationReady } from './_helpers';
import { logger } from '../../src/utils/logger';

const READY = await isIntegrationReady();

const SAMPLE_REPORT = {
  'csp-report': {
    'document-uri': 'https://signacare.io/patients',
    referrer: 'https://signacare.io/login',
    'violated-directive': 'script-src',
    'effective-directive': 'script-src-elem',
    'original-policy': "default-src 'self'; script-src 'self'",
    disposition: 'enforce',
    'blocked-uri': 'https://evil.example/x.js',
    'line-number': 12,
    'column-number': 7,
    'source-file': 'https://signacare.io/index.html',
    'status-code': 200,
    'script-sample': '',
  },
};

describe.skipIf(!READY)('BUG-468 — CSP-violation report endpoint', () => {
  // ────────────────────────────────────────────────────────────────────────
  // C1 — happy path: legacy `application/csp-report` MIME (Chrome shape).
  // ────────────────────────────────────────────────────────────────────────
  it('C1 POST /api/v1/csp-report with application/csp-report → 204', async () => {
    const res = await request(app)
      .post('/api/v1/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(JSON.stringify(SAMPLE_REPORT));
    expect(res.status).toBe(204);
  });

  // ────────────────────────────────────────────────────────────────────────
  // C2 — observability contract: structured warn log emitted with
  // `type: 'csp_violation'` + the violated directive + blocked URI.
  // ────────────────────────────────────────────────────────────────────────
  it('C2 emits structured pino warn with csp_violation type', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    await request(app)
      .post('/api/v1/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(JSON.stringify(SAMPLE_REPORT));

    const matchingCall = warnSpy.mock.calls.find((call) => {
      const payload = call[0] as Record<string, unknown> | undefined;
      return payload && payload['type'] === 'csp_violation';
    });
    expect(matchingCall).toBeDefined();
    const payload = matchingCall![0] as Record<string, unknown>;
    expect(payload['violatedDirective']).toBe('script-src');
    expect(payload['blockedUri']).toBe('https://evil.example/x.js');
    warnSpy.mockRestore();
  });

  // ────────────────────────────────────────────────────────────────────────
  // C3 — Firefox shape (application/json MIME with the same body shape).
  // ────────────────────────────────────────────────────────────────────────
  it('C3 POST with application/json (Firefox shape) → 204', async () => {
    const res = await request(app)
      .post('/api/v1/csp-report')
      .set('Content-Type', 'application/json')
      .send(SAMPLE_REPORT);
    expect(res.status).toBe(204);
  });

  // ────────────────────────────────────────────────────────────────────────
  // C4 — malformed body (missing csp-report key) → 400 Zod parse fail.
  // ────────────────────────────────────────────────────────────────────────
  it('C4 POST with malformed body → 400', async () => {
    const res = await request(app)
      .post('/api/v1/csp-report')
      .set('Content-Type', 'application/json')
      .send({ foo: 'bar' });
    expect(res.status).toBe(400);
  });

  // ────────────────────────────────────────────────────────────────────────
  // C5 — endpoint is unauthenticated by W3C design. POST without any auth
  // headers must still succeed (204).
  // ────────────────────────────────────────────────────────────────────────
  it('C5 POST without auth headers → 204 (endpoint is unauthenticated)', async () => {
    const res = await request(app)
      .post('/api/v1/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(JSON.stringify(SAMPLE_REPORT));
    expect(res.status).toBe(204);
  });

  // ────────────────────────────────────────────────────────────────────────
  // C6 — vendor-extended fields don't break Zod parse (`.passthrough()`).
  // ────────────────────────────────────────────────────────────────────────
  it('C6 vendor-extended fields don\'t break parse → 204', async () => {
    const extended = {
      'csp-report': {
        ...SAMPLE_REPORT['csp-report'],
        // Vendor-specific extension field that's not in the legacy spec.
        'vendor-extension-flag': 'firefox-90-extra',
        'unknown-future-field': { nested: true },
      },
    };
    const res = await request(app)
      .post('/api/v1/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(JSON.stringify(extended));
    expect(res.status).toBe(204);
  });
});
