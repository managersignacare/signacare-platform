// apps/api/src/shared/csrfConfig.ts
//
// USER-A.2 absorb-1: single source of truth for the CSRF token Redis
// TTL. Previously the literal `3600` appeared in TWO places that MUST
// move together:
//   1. features/auth/authRoutes.ts — issues the token with
//      `redis.set('csrf:<token>', '1', 'EX', 3600)`
//   2. middleware/csrfMiddleware.ts — slides the window by calling
//      `redis.expire('csrf:<token>', 3600)` on every successful validate
//
// If these two drift apart, either the issuer grants a shorter lifetime
// than the slider extends to (confusing UX) or the slider creates an
// effectively-infinite token (security regression). Keep them in lockstep
// by importing this constant from both sites.
export const CSRF_TOKEN_TTL_SECONDS = 3600;
