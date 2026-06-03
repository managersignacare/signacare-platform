/**
 * CSRF Protection Middleware
 *
 * Strategy: Custom Header Check (OWASP recommended for SPAs)
 *
 * For cookie-based auth (browser), requires a custom header on mutating
 * requests. Browsers enforce that custom headers can only be sent to
 * same-origin or CORS-approved origins, so their presence proves the
 * request is legitimate.
 *
 * Exemptions:
 * - GET/HEAD/OPTIONS (safe methods)
 * - Bearer token auth (API clients, mobile — not cookie-vulnerable)
 * - API key auth (integrations)
 * - Auth endpoints (no session exists yet)
 * - Multipart file uploads (CORS protects same-origin form submissions;
 *   browsers can't send arbitrary multipart requests cross-origin without
 *   CORS preflight which checks our allowed origins)
 */

import type { Request, Response, NextFunction } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function csrfMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (SAFE_METHODS.has(req.method)) { next(); return; }

  // Bearer auth (mobile, API clients) — not cookie-vulnerable
  if (req.headers.authorization?.startsWith('Bearer ')) { next(); return; }
  if (req.headers['x-client'] === 'mobile') { next(); return; }

  // API key auth (integrations)
  if (req.headers['x-api-key']) { next(); return; }

  // Auth endpoints that genuinely have no session yet.
  // All other /auth/ routes (mfa/setup, mfa/confirm, mfa/disable, refresh, etc.)
  // are authenticated and MUST require CSRF.
  const CSRF_EXEMPT_AUTH = ['/auth/login', '/auth/mfa/verify', '/auth/csrf', '/auth/break-glass',
    '/patient-app/activate', '/patient-app/login'];
  if (CSRF_EXEMPT_AUTH.some((p) => req.path.endsWith(p))) { next(); return; }

  // BUG-468 — CSP-violation report endpoint. Browsers send violation
  // reports unauthenticated and cannot include CSRF tokens (the report
  // is often triggered by a violation that occurs before any session
  // is fully established, and the W3C `report-uri` directive
  // expressly demands an anonymous POST surface). Rate-limited via
  // apiLimiter at the global mount.
  if (req.path.endsWith('/csp-report')) { next(); return; }

  // Patient app requests (X-Client: patient-app) — uses Bearer tokens, not cookies
  if (req.headers['x-client'] === 'patient-app') { next(); return; }

  // Multipart file uploads — protected by CORS same-origin enforcement.
  // The browser's FormData API sets Content-Type with boundary automatically.
  // Cross-origin multipart POSTs trigger CORS preflight which we control.
  const ct = req.headers['content-type'] ?? '';
  if (ct.includes('multipart/form-data')) { next(); return; }

  // Phase 0.7.1 — Synchronizer Token Pattern (defense-in-depth on
  // top of the Custom Header Check). The token VALUE is validated
  // against Redis, not just the header's presence. The Custom Header
  // Check alone is OWASP-approved for SPAs, but validating the value
  // adds a second layer so an XSS-injected script that can set
  // arbitrary headers still can't forge a valid token.
  //
  // Graceful degradation: if Redis is unavailable, fall back to the
  // Custom Header Check (presence-only) so CSRF doesn't become a
  // single point of failure that locks out all writes.
  const token = (req.headers['x-csrf-token'] as string) ?? '';
  const requestId = (req.headers['x-request-id'] as string) ?? '';

  if (!token && !requestId) {
    res.status(403).json({
      error: 'CSRF validation failed. Ensure your request includes the X-CSRF-Token header.',
      code: 'CSRF_MISSING',
    });
    return;
  }

  // Validate against Redis when available. The /auth/csrf endpoint
  // stores tokens with a CSRF_TOKEN_TTL_SECONDS TTL. On validation the
  // token is NOT deleted (reusable within TTL) — SPA apps re-use the
  // same token across many requests until it expires and useCsrf.ts
  // fetches a fresh one.
  //
  // Sliding refresh (USER-A.2, user item #6): on every successful
  // validation, extend the TTL by the same CSRF_TOKEN_TTL_SECONDS. A
  // clinician actively working past the expiry mark would otherwise
  // hit CSRF_INVALID on their next mutation. Sliding keeps the token
  // live as long as the session itself is live; the auth session
  // timeout is the real guard on idle users.
  //
  // USER-A.2 absorb-1: TTL value imported from shared/csrfConfig so
  // the issuer (authRoutes.ts:28) and this slider stay in lockstep
  // (L5 SSOT standard; previously the literal `3600` was duplicated).
  if (token && token !== 'signacare-spa') {
    try {
      const { redis } = await import('../config/redis');
      const { CSRF_TOKEN_TTL_SECONDS } = await import('../shared/csrfConfig');
      const stored = await redis.get(`csrf:${token}`);
      if (!stored) {
        res.status(403).json({
          error: 'CSRF token expired or invalid. Refresh the page to get a new token.',
          code: 'CSRF_INVALID',
        });
        return;
      }
      await redis.expire(`csrf:${token}`, CSRF_TOKEN_TTL_SECONDS);
    } catch {
      // Redis unavailable — degrade to Custom Header Check (presence-only).
      // This is acceptable: the Custom Header Check is already OWASP-approved.
    }
  }

  next();
}
