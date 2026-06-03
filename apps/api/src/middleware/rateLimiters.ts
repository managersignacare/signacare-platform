// apps/api/src/middleware/rateLimiters.ts
//
// BUG-469 L5 absorb-1 — extracts the rate-limiter SSoT out of server.ts
// so route files can attach limiters per-endpoint instead of relying
// on blanket `app.use(prefix, limiter)` mounts at the boot layer.
//
// Why this exists:
// L5 reviewer flagged the prefix-as-policy anti-pattern in the original
// BUG-469 implementation: `app.use('/api/v1/auth', authLimiter)` would
// blanket every GET (`/me`, `/csrf`, `/mfa/status`, `/webauthn/credentials`,
// `/break-glass/active`, `/break-glass/audit`) at the harshest cap in
// the system. In a clinic on shared NAT, routine `/me` re-checks would
// exhaust the cap → availability regression. Same problem with
// `/scribe` (~30 non-upload routes) and `/referrals` (~30 non-upload
// routes) being capped at 30/min/IP because a single multer route
// lives under the prefix.
//
// The fix is per-endpoint attach: each multer route imports
// `uploadLimiter` and adds it as middleware on its own handler.
// The auth limiter retains prefix mounts only on credential verbs
// (login / mfa / refresh / change-password / verify-* challenges /
// break-glass / webauthn login+register) AND skips safe (GET/HEAD/OPTIONS)
// methods so a future endpoint added under one of those prefixes won't
// silently inherit the cap.
//
// SSoT shape: the four limiters defined here are the authoritative
// instances; server.ts imports + mounts them. Route files import the
// upload limiter for in-route attach. No duplication.

import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import type { Request } from 'express';
import { redis } from '../config/redis';

/**
 * Internal — Redis-backed limiter store with fail-open semantics.
 *
 * Important: limiter instances are created at module-eval time. If we gate
 * store construction on a later "redis connected" flag, every limiter gets
 * locked to the in-memory store for process lifetime. That causes request-
 * bucket drift between tests/processes and defeats Redis key flush probes.
 *
 * The store is therefore always instantiated. When Redis is unavailable,
 * sendCommand fails open (returns 0) so request flow is not blocked.
 */
export function setRedisAvailable(available?: boolean): void {
  void available;
  // Compatibility no-op: server.ts still calls this hook.
}

const redisStore = (): InstanceType<typeof RedisStore> => {
  return new RedisStore({
    sendCommand: async (...args: string[]): Promise<string | number | boolean | (string | number | boolean)[]> => {
      try {
        const result = await redis.call(args[0], ...args.slice(1));
        return result as string | number | boolean | (string | number | boolean)[];
      } catch {
        return 0; // fail-open per BUG-472 (sibling re-evaluation row)
      }
    },
  });
};

const isTest = process.env.NODE_ENV === 'test';
const isDevelopment = process.env.NODE_ENV === 'development';
const STRICT_TEST_HEADER = 'x-signacare-test-rate-limit-mode';

/**
 * Integration suites share one Redis/IP bucket across many files.
 * Default test posture is RELAXED to prevent cross-suite 429 poisoning.
 *
 * Opt into strict limiter semantics for specific requests via either:
 *   1) process env: SIGNACARE_TEST_RATE_LIMIT_MODE=strict
 *   2) request header: x-signacare-test-rate-limit-mode: strict
 */
function isStrictTestRequest(req: Request): boolean {
  if (!isTest) return false;
  const envMode = (process.env.SIGNACARE_TEST_RATE_LIMIT_MODE ?? '').toLowerCase();
  if (envMode === 'strict') return true;
  const headerMode = req.header(STRICT_TEST_HEADER);
  return typeof headerMode === 'string' && headerMode.toLowerCase() === 'strict';
}

function normaliseIp(ip: string | undefined): string {
  if (!ip) return 'unknown';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function normalisePhone(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const digitsOnly = value.replace(/[^0-9+]/g, '');
  return digitsOnly.length > 0 ? digitsOnly : 'unknown';
}

function normaliseInviteCode(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : 'unknown';
}

function normaliseEmail(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : 'unknown';
}

function resolveAuthLimiterRouteFromRequest(req: Request): string {
  return (req.baseUrl || req.path || req.originalUrl || 'unknown')
    .split('?')[0]
    .toLowerCase();
}

export function buildApiLimiterKey(ip: string | undefined): string {
  return `rl:api:${normaliseIp(ip)}`;
}

export function buildAuthLimiterScope(routeInput: string, emailInput: unknown): string {
  const route = routeInput.split('?')[0].toLowerCase();

  // Keep login/webAuthn buckets per-email (with IP) so one noisy account
  // flow does not lock out all sign-ins behind the same clinic NAT.
  if (
    route.endsWith('/api/v1/auth/login')
    || route.endsWith('/api/v1/auth/webauthn/login/options')
    || route.endsWith('/api/v1/auth/webauthn/register/options')
  ) {
    return `${route}:${normaliseEmail(emailInput)}`;
  }

  return route;
}

export function buildAuthLimiterKey(input: {
  ip: string | undefined;
  route: string;
  email: unknown;
}): string {
  return `rl:auth:${normaliseIp(input.ip)}:${buildAuthLimiterScope(input.route, input.email)}`;
}

export function buildPatientAuthLimiterKey(ip: string | undefined): string {
  return `rl:patient-auth:${normaliseIp(ip)}`;
}

export function buildPatientLoginPhoneLimiterKey(phone: unknown): string {
  return `rl:patient-login-phone:${normalisePhone(phone)}`;
}

export function buildPatientActivateCodeLimiterKey(
  codeInput: unknown,
  inviteCodeInput: unknown,
  invitationTokenInput?: unknown,
): string {
  const code = normaliseInviteCode(codeInput);
  const legacyInviteCode = normaliseInviteCode(inviteCodeInput);
  const invitationToken = normaliseInviteCode(invitationTokenInput);
  const canonical = code !== 'unknown'
    ? code
    : (legacyInviteCode !== 'unknown' ? legacyInviteCode : invitationToken);
  return `rl:patient-activate-code:${canonical}`;
}

export function buildUploadLimiterKey(ip: string | undefined): string {
  return `rl:upload:${normaliseIp(ip)}`;
}

export function buildWebhookLimiterKey(ip: string | undefined): string {
  return `rl:webhook:${normaliseIp(ip)}`;
}

export function buildLlmLimiterKey(ip: string | undefined): string {
  return `rl:llm:${normaliseIp(ip)}`;
}

/**
 * BUG-469 L5 absorb-1 — skip safe HTTP methods so a `app.use` prefix
 * mount with `authLimiter` does NOT throttle hydration GETs (`/auth/me`,
 * `/auth/csrf`, `/auth/mfa/status`, `/auth/webauthn/credentials`, etc).
 * Brute-force attacks are POST/PUT/PATCH/DELETE-shaped; rate-limiting
 * GETs on the credential-prefix is an availability bug not a security
 * gain.
 */
const skipSafeMethods = (req: Request): boolean =>
  req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  // Relaxed test mode absorbs suite-wide request volume; strict mode
  // remains available per-request for limiter-focused tests.
  max: (req) => parseInt(
    process.env.API_RATE_LIMIT ?? (isTest
      ? (isStrictTestRequest(req) ? '600' : '1000000')
      : (isDevelopment ? '600' : '1000')),
    10,
  ),
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore(),
  keyGenerator: (req) => buildApiLimiterKey(req.ip),
  message: { error: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' },
  skip: (req) => req.path === '/health' || req.path === '/ready',
  validate: { xForwardedForHeader: false, ip: false, keyGeneratorIpFallback: false },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => parseInt(
    process.env.AUTH_RATE_LIMIT ?? (isTest
      ? (isStrictTestRequest(req) ? '200' : '1000000')
      : (isDevelopment ? '200' : '10')),
    10,
  ),
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore(),
  keyGenerator: (req) => {
    const body = (req.body as Record<string, unknown> | undefined) ?? {};
    return buildAuthLimiterKey({
      ip: req.ip,
      route: resolveAuthLimiterRouteFromRequest(req),
      email: body.email,
    });
  },
  message: { error: 'Too many login attempts. Try again in 15 minutes.', code: 'RATE_LIMITED' },
  // BUG-469 L5 absorb-1 — skip safe methods on the credential-prefix
  // mounts. See module docblock for rationale.
  skip: skipSafeMethods,
  validate: { xForwardedForHeader: false, ip: false, keyGeneratorIpFallback: false },
});

// BUG-469 — patient-app brute-force / invite-grinding limiter. Mirrors
// staff `authLimiter` numerics. Per-IP key (NOT per-account); per-
// account `locked_until` already exists at patientAppRoutes.ts:368
// as a separate clinical-safety check.
export const patientAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => parseInt(
    process.env.PATIENT_AUTH_RATE_LIMIT ?? (isTest
      ? (isStrictTestRequest(req) ? '200' : '1000000')
      : (isDevelopment ? '200' : '10')),
    10,
  ),
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore(),
  keyGenerator: (req) => buildPatientAuthLimiterKey(req.ip),
  message: { error: 'Too many patient login attempts. Try again in 15 minutes.', code: 'RATE_LIMITED' },
  skip: skipSafeMethods,
  validate: { xForwardedForHeader: false, ip: false, keyGeneratorIpFallback: false },
});

// S0 hardening — per-phone attempt limiter for patient login. This
// sits alongside patientAuthLimiter (per-IP) so brute-force pressure
// is capped both per source network and per patient credential target.
export const patientLoginPhoneLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => parseInt(
    process.env.PATIENT_LOGIN_PHONE_RATE_LIMIT ?? (isTest
      ? (isStrictTestRequest(req) ? '100' : '1000000')
      : (isDevelopment ? '100' : '10')),
    10,
  ),
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore(),
  keyGenerator: (req) => {
    const body = (req.body as Record<string, unknown> | undefined) ?? {};
    return buildPatientLoginPhoneLimiterKey(body.phone);
  },
  message: {
    error: 'Too many login attempts for this phone number. Try again in 15 minutes.',
    code: 'RATE_LIMITED',
  },
  skip: skipSafeMethods,
  validate: { xForwardedForHeader: false, ip: false, keyGeneratorIpFallback: false },
});

// S0 hardening — per-invite-code activation limiter. Prevents code
// grinding across distributed IPs while the per-IP patientAuthLimiter
// covers hot-source abuse.
export const patientActivateCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => parseInt(
    process.env.PATIENT_ACTIVATE_CODE_RATE_LIMIT ?? (isTest
      ? (isStrictTestRequest(req) ? '100' : '1000000')
      : (isDevelopment ? '100' : '8')),
    10,
  ),
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore(),
  keyGenerator: (req) => {
    const body = (req.body as Record<string, unknown> | undefined) ?? {};
    return buildPatientActivateCodeLimiterKey(body.code, body.inviteCode, body.invitationToken);
  },
  message: {
    error: 'Too many activation attempts for this invite code. Try again in 15 minutes.',
    code: 'RATE_LIMITED',
  },
  skip: skipSafeMethods,
  validate: { xForwardedForHeader: false, ip: false, keyGeneratorIpFallback: false },
});

// BUG-469 — multipart-upload throttle. 30/min/IP × 50 MB = 1.5 GB/min
// ceiling per IP. Per L5 absorb-1, mounted PER-HANDLER in the route
// files, NOT at a `/scribe` or `/referrals` prefix that would sweep in
// dozens of non-upload routes.
export const uploadLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: (req) => parseInt(
    process.env.UPLOAD_RATE_LIMIT ?? (isTest
      ? (isStrictTestRequest(req) ? '200' : '1000000')
      : (isDevelopment ? '200' : '30')),
    10,
  ),
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore(),
  keyGenerator: (req) => buildUploadLimiterKey(req.ip),
  message: { error: 'Upload rate limit reached. Please wait.', code: 'RATE_LIMITED' },
  validate: { xForwardedForHeader: false, ip: false, keyGeneratorIpFallback: false },
});

// BUG-469 — public-webhook IP limiter (pre-HMAC). Layers above the
// per-source DB `rate_limit_per_minute` cap that runs after HMAC verify.
export const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: (req) => parseInt(
    process.env.WEBHOOK_RATE_LIMIT ?? (isTest
      ? (isStrictTestRequest(req) ? '600' : '1000000')
      : (isDevelopment ? '600' : '120')),
    10,
  ),
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore(),
  keyGenerator: (req) => buildWebhookLimiterKey(req.ip),
  message: { error: 'Webhook rate limit reached for this IP.', code: 'RATE_LIMITED' },
  validate: { xForwardedForHeader: false, ip: false, keyGeneratorIpFallback: false },
});

export const llmLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  // LLM-heavy integration matrices can exceed 2k/min in one suite.
  max: (req) => parseInt(
    process.env.LLM_RATE_LIMIT ?? (isTest
      ? (isStrictTestRequest(req) ? '100' : '1000000')
      : (isDevelopment ? '100' : '50')),
    10,
  ),
  store: redisStore(),
  keyGenerator: (req) => buildLlmLimiterKey(req.ip),
  message: { error: 'AI rate limit reached. Please wait.', code: 'RATE_LIMITED' },
  validate: { xForwardedForHeader: false, ip: false, keyGeneratorIpFallback: false },
});
