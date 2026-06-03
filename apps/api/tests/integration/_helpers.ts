/**
 * Category 2 — Integration test helpers.
 *
 * These tests boot the real Express app in-process via supertest and
 * hit a real PostgreSQL instance. They MUST NOT be part of the default
 * `pnpm test` run — they require infrastructure (Postgres + a seeded
 * admin user). vitest.config.ts excludes `tests/integration/` from the
 * default include glob; the dedicated `pnpm test:integration` script
 * runs them after the dev compose stack is up.
 *
 * Skip behavior:
 *   - If the database is unreachable, every integration suite calls
 *     `describe.skipIf(!ready)` and degrades to "0 tests run, 0 failed"
 *     so a missing dev DB never breaks CI on a developer laptop.
 *
 * Fixtures:
 *   - Default admin: admin@signacare.local / Password1!
 *     (created by seed-demo.ts after migrations run — see survey).
 *
 * The helper does NOT manage transactions or roll-back. Real RLS-aware
 * transactions are owned by rlsMiddleware on a per-request basis;
 * trying to wrap the whole test in an outer transaction would conflict
 * with that. Each test is responsible for cleaning up the rows it
 * creates (or for using values that don't collide with seed data).
 */

import request from 'supertest';
import type { SuperAgentTest } from 'supertest';
import {
  CANONICAL_PASSWORD,
  CANONICAL_PERSONAS,
  seedCanonicalPersonas,
} from '../fixtures/canonical-personas';

// IMPORTANT: importing server.ts must NOT call app.listen(). The guard
// in server.ts (`if (process.env.NODE_ENV !== 'test')`) makes this safe;
// tests/setup.ts sets NODE_ENV=test before any module is loaded.
import app from '../../src/server';
import { connectRedis } from '../../src/config/redis';

export const TEST_ADMIN_EMAIL = CANONICAL_PERSONAS.superadmin.email;
export const TEST_ADMIN_PASSWORD = CANONICAL_PASSWORD;
export const TEST_CLINICIAN_EMAIL = CANONICAL_PERSONAS.clinician.email;
export const TEST_MANAGER_EMAIL = CANONICAL_PERSONAS.manager.email;

/**
 * Probe the database and migrations state. Returns true only when:
 *   - dbAdmin can SELECT 1
 *   - the staff table exists (i.e., migrations have run)
 *   - the seeded admin row is present
 *
 * Caches the result for the lifetime of the test process so multiple
 * suites don't probe the DB N times.
 */
let probeCache: boolean | null = null;
let probePromise: Promise<boolean> | null = null;

async function flushRateLimitBucketsForReadiness(): Promise<void> {
  const { redis } = await import('../../src/config/redis');
  let cursor = '0';
  do {
    const reply = await redis.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 1000);
    cursor = reply[0];
    if (reply[1].length > 0) {
      await redis.del(...reply[1]);
    }
  } while (cursor !== '0');
}

const REQUIRED_RELATIONS_FOR_INTEGRATION = ['public.audit_events_canonical'] as const;

class IntegrationSchemaMismatchError extends Error {
  constructor(missingRelations: readonly string[]) {
    super(
      [
        'Integration schema mismatch: missing required relation(s):',
        ...missingRelations.map((relation) => `- ${relation}`),
        "Run `npm run migrate:dev` (inside apps/api) or `npm run migrate:dev -w apps/api` (repo root) before running integration suites.",
      ].join('\n'),
    );
    this.name = 'IntegrationSchemaMismatchError';
  }
}

class IntegrationReadinessFailClosedError extends Error {
  constructor(reason: string) {
    super(`Integration readiness failed in CI mode: ${reason}`);
    this.name = 'IntegrationReadinessFailClosedError';
  }
}

function assertCiReadinessOrThrow(reason: string): void {
  const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  if (isCi) {
    throw new IntegrationReadinessFailClosedError(reason);
  }
}

async function assertRequiredIntegrationRelations(): Promise<void> {
  const { dbAdmin } = await import('../../src/db/db');
  const missing: string[] = [];
  for (const relation of REQUIRED_RELATIONS_FOR_INTEGRATION) {
    const exists = await dbAdmin.raw(
      'SELECT to_regclass(?) IS NOT NULL AS ok',
      [relation],
    );
    if (!exists.rows?.[0]?.ok) missing.push(relation);
  }
  if (missing.length > 0) {
    throw new IntegrationSchemaMismatchError(missing);
  }
}

export async function isIntegrationReady(): Promise<boolean> {
  if (probeCache !== null) return probeCache;
  if (probePromise) return probePromise;
  probePromise = (async () => {
  try {
    await seedCanonicalPersonas();
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin.raw('SELECT 1');
    const exists = await dbAdmin.raw(
      "SELECT to_regclass('public.staff') IS NOT NULL AS ok",
    );
    if (!exists.rows?.[0]?.ok) {
      probeCache = false;
      assertCiReadinessOrThrow("required relation 'public.staff' is missing");
      return probeCache;
    }
    const admin = await dbAdmin('staff')
      .where({ email: TEST_ADMIN_EMAIL })
      .first();
    if (!admin) {
      probeCache = false;
      assertCiReadinessOrThrow(`required seeded admin '${TEST_ADMIN_EMAIL}' is missing`);
      return probeCache;
    }
    // BUG-C1 schema parity: passing login/seed checks is not enough.
    // Integration suites assume canonical audit surfaces exist.
    await assertRequiredIntegrationRelations();
    // The login route uses Redis (rate limiter + session store) and
    // server.ts's startServer() — which normally calls connectRedis() —
    // is gated off in NODE_ENV=test. Initialize Redis as part of the
    // readiness probe so the whole suite skips cleanly when Redis is
    // missing rather than logging confusing 500s.
    const redisOk = await connectRedis();
    if (!redisOk) {
      probeCache = false;
      assertCiReadinessOrThrow('Redis connection probe failed');
      return probeCache;
    }
    // Readiness should not depend on leftover limiter buckets from
    // prior local runs. Clear rl:* before the login smoke probe.
    await flushRateLimitBucketsForReadiness();
    // Final smoke: try the login once. If the in-process app can't
    // complete an end-to-end auth round trip (the recurring 500 we
    // see when multiple files share the same fork), mark the suite
    // as not-ready so describe.skipIf cleanly skips instead of
    // surfacing every test as a beforeAll failure.
    try {
      await loginAsAdmin();
      probeCache = true;
    } catch (err) {
      probeCache = false;
      // Keep readiness fail-closed behavior, but never hide the root
      // cause. Silent skips make integration-health regressions look
      // green while the auth smoke is actually broken.
      // eslint-disable-next-line no-console
      console.warn(
        '[_helpers.ts] readiness login smoke failed:',
        err instanceof Error ? err.message : err,
      );
      assertCiReadinessOrThrow(
        err instanceof Error ? `login smoke failed: ${err.message}` : 'login smoke failed',
      );
    }
    return probeCache;
  } catch (err) {
    if (err instanceof IntegrationSchemaMismatchError) {
      throw err;
    }
    if (err instanceof IntegrationReadinessFailClosedError) {
      throw err;
    }
    probeCache = false;
    assertCiReadinessOrThrow(err instanceof Error ? err.message : 'unknown readiness probe error');
    return probeCache;
  }
  })();

  try {
    return await probePromise;
  } finally {
    probePromise = null;
  }
}

/**
 * Hits POST /api/v1/auth/login with the seeded admin credentials and
 * returns the bearer token. Throws if the login flow fails — that's a
 * setup error, not a test assertion.
 *
 * The result is cached for the lifetime of the test process. This is
 * intentional: when multiple integration files run in the same fork,
 * doing N logins back-to-back triggers state interactions in the
 * in-process server (audit-write batching, refresh-token rotation, etc.)
 * that surface as flaky 500s. Sharing one valid token across all
 * tests avoids that and is also closer to how a real long-lived
 * clinical session behaves.
 */
type CachedSession = {
  token: string;
  clinicId: string;
  userId: string;
};

const cachedSessionsByEmail = new Map<string, CachedSession>();
const inflightSessionsByEmail = new Map<string, Promise<CachedSession>>();

async function ensureNominatedAdminForCachedSession(
  session: { clinicId: string; userId: string },
): Promise<void> {
  try {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [session.clinicId]);
      const clinic = await trx('clinics')
        .where({ id: session.clinicId })
        .select('nominated_admin_staff_id')
        .first();
      if (clinic && clinic.nominated_admin_staff_id !== session.userId) {
        await trx('clinics')
          .where({ id: session.clinicId })
          .update({ nominated_admin_staff_id: session.userId });
      }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[_helpers.ts] nominated-admin bootstrap failed — adjacent tests may 403. Error:',
      err instanceof Error ? err.message : err,
    );
  }
}

async function loginAsCanonicalPersona(email: string): Promise<CachedSession> {
  const cached = cachedSessionsByEmail.get(email);
  if (cached) return cached;
  const inflight = inflightSessionsByEmail.get(email);
  if (inflight) return inflight;

  const task = (async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile') // body-token mode (no cookie)
      .send({ email, password: TEST_ADMIN_PASSWORD });

    if (res.status !== 200) {
      throw new Error(
        `Canonical persona login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    const token = res.body?.accessToken as string | undefined;
    if (!token) throw new Error('No accessToken in login response');

    const session = {
      token,
      clinicId: res.body.user.clinicId,
      userId: res.body.user.id,
    };
    cachedSessionsByEmail.set(email, session);
    return session;
  })();
  inflightSessionsByEmail.set(email, task);
  try {
    return await task;
  } finally {
    inflightSessionsByEmail.delete(email);
  }
}

export async function loginAsAdmin(): Promise<CachedSession> {
  const session = await loginAsCanonicalPersona(TEST_ADMIN_EMAIL);
  // Phase 0.5.B bootstrap: ensure the seeded admin is the nominated admin
  // for this clinic. Re-run idempotently on every loginAsAdmin call
  // (including cached-session path) to neutralise cross-suite mutations.
  await ensureNominatedAdminForCachedSession(session);

  return session;
}

export async function loginAsClinician(): Promise<CachedSession> {
  return loginAsCanonicalPersona(TEST_CLINICIAN_EMAIL);
}

export async function loginAsManager(): Promise<CachedSession> {
  return loginAsCanonicalPersona(TEST_MANAGER_EMAIL);
}

/**
 * Returns a supertest agent with the Authorization + CSRF headers
 * pre-set, so individual tests just call agent.get/post/etc directly.
 */
export function authedAgent(token: string): SuperAgentTest {
  const agent = request.agent(app);
  // supertest's agent doesn't expose .set() globally, so we wrap with
  // a Proxy that injects headers on every method call. The simpler
  // pattern below uses a tiny wrapper object that mirrors the methods
  // we actually need.
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-CSRF-Token': 'test',
  };
  // Cast the wrapper as SuperAgentTest — we only implement the methods
  // we use, which are typed via the cast.
  const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head']);
  return new Proxy(agent, {
    get(target: Record<string | symbol, unknown>, prop: string | symbol) {
      const orig = target[prop];
      if (typeof orig !== 'function') return orig;
      if (typeof prop !== 'string' || !httpMethods.has(prop)) {
        return orig.bind(target);
      }
      return (...args: unknown[]) => {
        const req = (
          orig as (...fnArgs: unknown[]) => { set: (name: string, value: string) => void }
        ).apply(target, args);
        Object.entries(headers).forEach(([k, v]) => req.set(k, v));
        return req;
      };
    },
  }) as unknown as SuperAgentTest;
}

/**
 * Helper for asserting RFC 7807 problem-details responses (used by
 * the constraint-enforcement tests). The API mostly returns
 * { error, code, ... } shaped errors today; this helper accepts
 * either shape so the tests are robust to incremental migration to
 * application/problem+json.
 */
export function assertErrorBody(body: unknown, expectedCode?: string): void {
  expect(body).toBeTruthy();
  const b = body as Record<string, unknown>;
  expect(typeof b.error === 'string' || typeof b.title === 'string').toBe(true);
  if (expectedCode) {
    const code = (b.code ?? b.type) as string | undefined;
    expect(code).toContain(expectedCode);
  }
}

// Re-export expect from vitest so the assertErrorBody helper above
// can use it without forcing every consumer to import it twice.
import { expect } from 'vitest';
