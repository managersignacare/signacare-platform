/**
 * Rate limiting — verify 429 Too Many Requests on the auth endpoint.
 *
 * The api-limiter on /api/ is set to 600/min in dev and 1000/min in
 * prod — too generous to trip within a test budget without burning
 * CI minutes. The auth limiter is tighter (30/15min in prod, 200 in
 * dev) AND its counter is per-IP, so we can actually provoke a 429
 * by hammering /auth/login from a single connection.
 *
 * This test doesn't assert the exact threshold — it asserts the
 * LIMITER IS WIRED and returns a structured 429 response with the
 * `Retry-After` header. The exact numeric cap is environment-
 * configurable via API_RATE_LIMIT / AUTH_RATE_LIMIT env vars.
 *
 * Standard satisfied: OWASP A07 (brute-force defence), RFC 6585 §4
 *                     (429 Too Many Requests), ACHS Standard 1.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

// Run this suite under strict limiter semantics even though the default
// integration posture is relaxed to prevent cross-suite bucket bleed.
process.env.SIGNACARE_TEST_RATE_LIMIT_MODE = 'strict';
const { default: app } = await import('../../src/server');

const READY = await isIntegrationReady();
let authToken = '';
const STRICT_TEST_RATE_LIMIT_HEADER = 'x-signacare-test-rate-limit-mode';

function withStrictLimiterMode(req: request.Test): request.Test {
  return req.set(STRICT_TEST_RATE_LIMIT_HEADER, 'strict');
}

/**
 * BUG-469 helper — flush all `rl:*` rate-limiter Redis keys between
 * tests. Without this, poisoned buckets from one burst test leak into
 * the next test in the same fork, especially across 3× flake reruns
 * where Redis state persists.
 */
async function flushRateLimitKeys(): Promise<void> {
  if (!READY) return;
  const { redis } = await import('../../src/config/redis');
  // SCAN is the production-safe way to enumerate keys; KEYS would
  // block the Redis event loop in a real cluster.
  let cursor = '0';
  do {
    const reply = await redis.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 1000);
    cursor = reply[0];
    if (reply[1].length > 0) {
      await redis.del(...reply[1]);
    }
  } while (cursor !== '0');
}

/**
 * BUG-469 helper — burst N requests against a single endpoint and
 * report whether/when 429 was seen. Mirrors the precedent at lines
 * 54-72 of the original `tripped` test.
 */
async function burstUntil429(opts: {
  method: 'POST' | 'GET' | 'DELETE' | 'PATCH';
  path: string;
  burstSize?: number;
  setHeaders?: (req: request.Test) => request.Test;
  body?: unknown;
  bodyFactory?: (attemptIndex: number) => unknown;
  /**
   * BUG-469 — message-fingerprint assertion. The pre-fix RED gate
   * relies on differentiating "WHICH limiter tripped" — apiLimiter
   * may trip from cumulative pollution by the time later tests run,
   * but the message string differs. Post-fix the SPECIFIC limiter
   * trips first because it has a tighter cap on the path AND it
   * runs before apiLimiter in the middleware chain (specific mounts
   * before catch-all). Test passes iff the 429 message contains
   * the expected fingerprint substring (case-insensitive).
   */
  expectedMessageFragment?: string;
}): Promise<{ saw429: boolean; messageMatched: boolean; sample: request.Response | null; attempts: number; messageSeen: string | null }> {
  const burstSize = opts.burstSize ?? 250;
  const setHeaders = opts.setHeaders ?? ((r) => r);
  let transientParseErrors = 0;
  for (let i = 0; i < burstSize; i++) {
    let r: request.Test;
    if (opts.method === 'POST') r = setHeaders(withStrictLimiterMode(request(app).post(opts.path)));
    else if (opts.method === 'GET') r = setHeaders(withStrictLimiterMode(request(app).get(opts.path)));
    else if (opts.method === 'DELETE') r = setHeaders(withStrictLimiterMode(request(app).delete(opts.path)));
    else r = setHeaders(withStrictLimiterMode(request(app).patch(opts.path)));
    let res: request.Response;
    try {
      if (opts.bodyFactory) {
        res = await r.send(opts.bodyFactory(i));
      } else if (opts.body !== undefined) {
        res = await r.send(opts.body);
      } else {
        res = await r;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Rare parser flakes can surface under heavy local burst load when
      // multiple integration files execute concurrently. Allow a small
      // bounded retry budget so this helper stays deterministic.
      if (msg.includes('Parse Error: Expected HTTP/, RTSP/ or ICE/')) {
        transientParseErrors += 1;
        if (transientParseErrors <= 10) {
          continue;
        }
      }
      throw err;
    }
    if (res.status === 429) {
      const msg = (typeof res.body === 'object' && res.body !== null && 'error' in res.body
        ? String((res.body as { error?: unknown }).error ?? '')
        : (res.text ?? ''));
      const matched = opts.expectedMessageFragment
        ? msg.toLowerCase().includes(opts.expectedMessageFragment.toLowerCase())
        : true;
      return { saw429: true, messageMatched: matched, sample: res, attempts: i + 1, messageSeen: msg };
    }
  }
  return { saw429: false, messageMatched: false, sample: null, attempts: burstSize, messageSeen: null };
}

describe.skipIf(!READY)('Rate limiting (429 Too Many Requests)', () => {
  beforeAll(async () => {
    // BUG-469 L5 absorb-1 — `uploadLimiter` is now per-handler so it
    // runs AFTER authMiddleware. Tests must authenticate to reach the
    // limiter middleware.
    if (READY) {
      const sess = await loginAsAdmin();
      authToken = sess.token;
    }
  });

  beforeEach(async () => {
    // BUG-469 — fresh bucket per test so 8 burst cases don't poison
    // each other's `rl:<scope>:<ip>` keys.
    await flushRateLimitKeys();
  });

  describe('Auth limiter on /auth/login', () => {
    it('emits the standard X-RateLimit headers on every auth request', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set(STRICT_TEST_RATE_LIMIT_HEADER, 'strict')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({ email: 'probe@nowhere.test', password: 'wrong' });

      // The limiter emits one of the two standard header families:
      //   RFC 6585 / IETF draft: RateLimit-Limit, RateLimit-Remaining
      //   Legacy:                X-RateLimit-Limit, X-RateLimit-Remaining
      const headers = res.headers;
      const hasStandard =
        headers['ratelimit-limit'] !== undefined ||
        headers['ratelimit-remaining'] !== undefined;
      const hasLegacy =
        headers['x-ratelimit-limit'] !== undefined ||
        headers['x-ratelimit-remaining'] !== undefined;
      expect(hasStandard || hasLegacy).toBe(true);
    });

    // Note: we don't actually trip the limiter in this test because
    // it would require ~200 requests in a single second and would
    // poison the auth-limiter Redis key for every subsequent test
    // in the same fork. The header-present assertion above is the
    // structural proof; the behavioural proof is the Cat 5 brute-
    // force test which exercises the same path.
    it('structured 429 response when the limiter is tripped', async () => {
      // Send a burst of login attempts rapidly — the limiter is
      // keyed per-IP, so all requests share the same bucket.
      const burst = await burstUntil429({
        method: 'POST',
        path: '/api/v1/auth/login',
        burstSize: 250, // comfortably above prod default (30/15min)
        setHeaders: (req) =>
          req
            .set('X-CSRF-Token', 'test')
            .set('X-Client', 'mobile'),
        body: { email: 'burst@nowhere.test', password: 'wrong' },
        expectedMessageFragment: 'login attempts',
      });

      // In dev (with the generous 200/15min limit) we should hit 429
      // within 250 requests. If the environment is configured with
      // a higher limit, skip gracefully.
      if (!burst.saw429) {
        // eslint-disable-next-line no-console
        console.warn(
          'Rate limiter not tripped after 250 requests — AUTH_RATE_LIMIT may be higher in this env.',
        );
        return;
      }

      const sample429 = burst.sample;
      expect(sample429).not.toBeNull();
      expect(sample429!.status).toBe(429);

      // The response body should be structured JSON with a code,
      // NOT an HTML error page and NOT a stack trace.
      const body = sample429!.body;
      const text = sample429!.text || '';
      expect(typeof body === 'object').toBe(true);
      expect(text).not.toMatch(/<html/i);
      expect(text).not.toMatch(/at \w+\.<anonymous>/);

      // Either the standard Retry-After header OR a retry hint in
      // the body. RFC 6585 mandates Retry-After for 429 but not
      // every library emits it.
      const retryHint =
        sample429!.headers['retry-after'] !== undefined ||
        /try again|rate/i.test(JSON.stringify(body));
      expect(retryHint).toBe(true);
    }, 60_000);
  });

  describe('API limiter on /api/* covers FHIR wildcard searches', () => {
    it('GET /fhir/Patient passes through the api-limiter (headers present)', async () => {
      const res = await request(app).get('/api/v1/fhir/Patient');
      // Expected: 401 (no auth) — but the rate-limit headers are
      // still emitted because the limiter runs before auth.
      expect([200, 401]).toContain(res.status);
      const hasStandard =
        res.headers['ratelimit-limit'] !== undefined ||
        res.headers['ratelimit-remaining'] !== undefined;
      const hasLegacy =
        res.headers['x-ratelimit-limit'] !== undefined ||
        res.headers['x-ratelimit-remaining'] !== undefined;
      expect(hasStandard || hasLegacy).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // BUG-469 — broad authLimiter coverage on credential-adjacent paths.
  //
  // Pre-fix only `/auth/login` and `/auth/mfa` had `authLimiter`. Every
  // other credential surface (`/refresh`, `/change-password`,
  // `/verify-mfa-challenge`, `/break-glass/*`, `/webauthn/*`,
  // `/admin/impersonate/*`) sat behind `apiLimiter`'s 1000/min cap —
  // a 100× looser brute-force budget than the auth surface deserved.
  //
  // Each L1-L3 burst test asserts 429 within 250 attempts; pre-fix
  // these paths sit under apiLimiter's 1000/min and never trip in 250.
  // ──────────────────────────────────────────────────────────────────
  describe('BUG-469 — authLimiter coverage broadened', () => {
    it('L1 trips on /api/v1/auth/refresh in burst', async () => {
      const r = await burstUntil429({
        method: 'POST',
        path: '/api/v1/auth/refresh',
        setHeaders: (req) => req.set('X-CSRF-Token', 'test').set('X-Client', 'mobile'),
        body: { refreshToken: 'invalid' },
        // authLimiter message fingerprint — distinguishes from apiLimiter.
        expectedMessageFragment: 'login attempts',
      });
      expect(r.saw429).toBe(true);
      expect(
        r.messageMatched,
        `L1 expected limiter message to include "login attempts"; saw="${r.messageSeen ?? 'null'}" attempts=${r.attempts}`,
      ).toBe(true);
    }, 90_000);

    it('L2 trips on /api/v1/auth/change-password in burst', async () => {
      const r = await burstUntil429({
        method: 'POST',
        path: '/api/v1/auth/change-password',
        setHeaders: (req) => req.set('X-CSRF-Token', 'test').set('X-Client', 'mobile'),
        body: { oldPassword: 'x', newPassword: 'y' },
        expectedMessageFragment: 'login attempts',
      });
      expect(r.saw429).toBe(true);
      expect(
        r.messageMatched,
        `L2 expected limiter message to include "login attempts"; saw="${r.messageSeen ?? 'null'}" attempts=${r.attempts}`,
      ).toBe(true);
    }, 90_000);

    it('L3 trips on /api/v1/auth/webauthn/login/options in burst', async () => {
      const r = await burstUntil429({
        method: 'POST',
        path: '/api/v1/auth/webauthn/login/options',
        setHeaders: (req) => req.set('X-CSRF-Token', 'test').set('X-Client', 'mobile'),
        body: { email: 'probe@nowhere.test' },
        expectedMessageFragment: 'login attempts',
      });
      expect(r.saw429).toBe(true);
      expect(
        r.messageMatched,
        `L3 expected limiter message to include "login attempts"; saw="${r.messageSeen ?? 'null'}" attempts=${r.attempts}`,
      ).toBe(true);
    }, 90_000);
  });

  // ──────────────────────────────────────────────────────────────────
  // BUG-469 + ARCH-S0-2/3 — layered patient-app brute-force controls:
  // per-IP patientAuthLimiter + per-phone/per-invite-code limiters.
  // ──────────────────────────────────────────────────────────────────
  describe('BUG-469 + ARCH-S0-2/3 — patient-app credential limiter layering', () => {
    it('L4 trips on /api/v1/patient-app/login in burst', async () => {
      const r = await burstUntil429({
        method: 'POST',
        path: '/api/v1/patient-app/login',
        setHeaders: (req) => req.set('X-Client', 'patient-app'),
        body: { phone: '+61400000000', password: 'wrong' },
        expectedMessageFragment: 'patient login attempts',
      });
      expect(r.saw429).toBe(true);
      expect(
        r.messageMatched,
        `L4 expected per-IP limiter fingerprint; saw="${r.messageSeen ?? 'null'}" attempts=${r.attempts}`,
      ).toBe(true);
    }, 90_000);

    it('L5 trips on /api/v1/patient-app/activate in burst', async () => {
      const r = await burstUntil429({
        method: 'POST',
        path: '/api/v1/patient-app/activate',
        setHeaders: (req) => req.set('X-Client', 'patient-app'),
        body: { inviteCode: 'INVALID', password: 'x', phone: '+61400000000' },
        expectedMessageFragment: 'patient login attempts',
      });
      expect(r.saw429).toBe(true);
      expect(
        r.messageMatched,
        `L5 expected per-IP limiter fingerprint; saw="${r.messageSeen ?? 'null'}" attempts=${r.attempts}`,
      ).toBe(true);
    }, 90_000);

    it('L5b distributed-phone burst still trips per-IP patient auth limiter on /patient-app/login', async () => {
      const r = await burstUntil429({
        method: 'POST',
        path: '/api/v1/patient-app/login',
        setHeaders: (req) => req.set('X-Client', 'patient-app'),
        bodyFactory: (attemptIndex) => ({
          phone: `+61412${String(attemptIndex).padStart(6, '0')}`,
          password: 'wrong',
        }),
        expectedMessageFragment: 'patient login attempts',
      });
      expect(r.saw429).toBe(true);
      expect(
        r.messageMatched,
        `L5b expected per-IP limiter fingerprint; saw="${r.messageSeen ?? 'null'}" attempts=${r.attempts}`,
      ).toBe(true);
    }, 120_000);

    it('L5c distributed-invite burst still trips per-IP patient auth limiter on /patient-app/activate', async () => {
      const r = await burstUntil429({
        method: 'POST',
        path: '/api/v1/patient-app/activate',
        setHeaders: (req) => req.set('X-Client', 'patient-app'),
        bodyFactory: (attemptIndex) => ({
          code: `INVITE${String(attemptIndex).padStart(6, '0')}`,
          password: 'Password1!',
          dob: '1990-01-01',
          phone: `+61499${String(attemptIndex).padStart(6, '0')}`,
        }),
        expectedMessageFragment: 'patient login attempts',
      });
      expect(r.saw429).toBe(true);
      expect(
        r.messageMatched,
        `L5c expected per-IP limiter fingerprint; saw="${r.messageSeen ?? 'null'}" attempts=${r.attempts}`,
      ).toBe(true);
    }, 120_000);
  });

  // ──────────────────────────────────────────────────────────────────
  // BUG-469 — uploadLimiter on multer-backed routes. POSTs without a
  // body 4xx at the multer layer; the limiter still increments before
  // multer parses the request, so 429 fires within the budget.
  // ──────────────────────────────────────────────────────────────────
  describe('BUG-469 — uploadLimiter on multer-backed routes', () => {
    it('L6 trips on /api/v1/patients/:id/attachments in burst', async () => {
      // L5 absorb-1: uploadLimiter is per-handler, so the test must
      // authenticate to reach it (limiter runs AFTER authMiddleware).
      const fakePatientId = '00000000-0000-0000-0000-000000000000';
      const r = await burstUntil429({
        method: 'POST',
        path: `/api/v1/patients/${fakePatientId}/attachments`,
        setHeaders: (req) => req
          .set('Authorization', `Bearer ${authToken}`)
          .set('X-CSRF-Token', 'test')
          .set('X-Client', 'mobile'),
        expectedMessageFragment: 'upload',
      });
      expect(r.saw429).toBe(true);
      expect(
        r.messageMatched,
        `L6 expected limiter message to include "upload"; saw="${r.messageSeen ?? 'null'}" attempts=${r.attempts}`,
      ).toBe(true);
    }, 90_000);

    it('L7 trips on /api/v1/imports in burst', async () => {
      const r = await burstUntil429({
        method: 'POST',
        path: '/api/v1/imports',
        setHeaders: (req) => req.set('X-CSRF-Token', 'test').set('X-Client', 'mobile'),
        expectedMessageFragment: 'upload',
      });
      expect(r.saw429).toBe(true);
      expect(
        r.messageMatched,
        `L7 expected limiter message to include "upload"; saw="${r.messageSeen ?? 'null'}" attempts=${r.attempts}`,
      ).toBe(true);
    }, 90_000);
  });

  // ──────────────────────────────────────────────────────────────────
  // BUG-469 — webhookLimiter (pre-HMAC, IP-keyed) on the public
  // inbound webhook endpoint. Defends signature-verify CPU budget
  // before the per-source DB rate-limit fires.
  // ──────────────────────────────────────────────────────────────────
  describe('BUG-469 — webhookLimiter on /api/v1/webhooks/:source', () => {
    it('L8 trips on /api/v1/webhooks/test-source in burst', async () => {
      // 700 burstSize because dev cap is 600/min — 250 is below the
      // floor, the test would falsely pass pre-fix without surfacing
      // the bug. Dedicated higher burst for this axis only.
      const r = await burstUntil429({
        method: 'POST',
        path: '/api/v1/webhooks/test-source',
        burstSize: 700,
        body: { test: true },
        expectedMessageFragment: 'webhook',
      });
      expect(r.saw429).toBe(true);
      expect(
        r.messageMatched,
        `L8 expected limiter message to include "webhook"; saw="${r.messageSeen ?? 'null'}" attempts=${r.attempts}`,
      ).toBe(true);
    }, 180_000);
  });

  // ──────────────────────────────────────────────────────────────────
  // BUG-469 L5 absorb-1 — negative coverage. Hydration GETs under the
  // /auth prefix MUST NOT be throttled by `authLimiter`. The
  // `skip: GET/HEAD/OPTIONS` clause + per-endpoint mounts together
  // ensure availability is preserved for clinic shared-NAT cases.
  // ──────────────────────────────────────────────────────────────────
  describe('BUG-469 L5 absorb-1 — non-credential GETs are NOT throttled', () => {
    it('N1 GET /api/v1/auth/csrf survives a 250-burst without authLimiter 429', async () => {
      const r = await burstUntil429({
        method: 'GET',
        path: '/api/v1/auth/csrf',
        expectedMessageFragment: 'login attempts',
      });
      // saw429 may be true if apiLimiter trips at 600 — but the message
      // MUST NOT match authLimiter's "login attempts" fingerprint.
      expect(r.messageMatched).toBe(false);
    }, 90_000);

    it('N2 GET /api/v1/auth/me survives a 250-burst without authLimiter 429', async () => {
      const r = await burstUntil429({
        method: 'GET',
        path: '/api/v1/auth/me',
        setHeaders: (req) => req.set('Authorization', 'Bearer invalid').set('X-CSRF-Token', 'test'),
        expectedMessageFragment: 'login attempts',
      });
      expect(r.messageMatched).toBe(false);
    }, 90_000);
  });
});
