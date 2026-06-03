// apps/api/src/middleware/authMiddleware.ts
import type { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { HttpError } from "../shared/errors";
import { logger } from "../utils/logger";
import { rlsMiddleware } from "./rlsMiddleware";
import { sessionIdleMiddleware } from "./sessionIdleMiddleware";
import { breakGlassAuditMiddleware } from "./breakGlassAuditMiddleware";
import { adminImpersonationAuditMiddleware } from "./adminImpersonationAuditMiddleware";
import { isUserRevokedAfter } from "./jwtBlacklist";
import { withTiming, type TimingEvent } from "../shared/observability/withTiming";
import {
  verifyAccessToken,
  type AccessTokenPayload,
} from "../utils/authTokens";
import {
  isAuthChainTimeoutError,
  withAuthChainStageTimeout,
} from "../shared/authChainTimeout";
import { schedulePerClinicIntegrationConfigDriftCheck } from "../shared/perClinicIntegrationConfigDrift";

// `config` import is preserved for symmetry with the rest of the
// middleware chain; the JWT secret is consumed inside verifyAccessToken.
void config;

function emitAuthChainTiming(event: TimingEvent): void {
  if (process.env.AUTH_CHAIN_PINO_TIMING !== '1') {
    return;
  }
  logger.info(
    {
      ...event,
      surface: 'auth.middleware',
    },
    'A1 auth chain timing stage completed',
  );
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.["signacare_access"]
    || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!token) {
    return next(new HttpError(401, "UNAUTHENTICATED", "Authentication required"));
  }

  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    logger.warn(
      {
        err,
        kind: 'jwt_verify_failed',
      },
      'authMiddleware: access token verification failed',
    );
    return next(new HttpError(401, "UNAUTHENTICATED", "Invalid or expired token"));
  }

  // BUG-356 — access-token revocation check. If the token's subject has
  // been blacklisted (via blacklistAllUserTokens) AFTER this token was
  // issued, reject with 401 SESSION_REVOKED. Required so staff demotion /
  // deactivation / soft-delete immediately invalidates the 60-min JWT
  // access window. `isUserRevokedAfter` fails-open on Redis error, so
  // an unreachable Redis does not break login — the JWT exp claim still
  // enforces the hard session lifetime. Log at warn level so the
  // degradation is observable.
  const timingBase = {
    requestId: req.requestId,
    userId: payload.id,
    emit: emitAuthChainTiming,
  } as const;

  withTiming(
    'auth.middleware.revocation_check',
    async () => withAuthChainStageTimeout(
      'auth.middleware.revocation_check',
      isUserRevokedAfter(payload.id, payload.iat),
    ),
    timingBase,
  )
    .then((revoked) => {
      if (revoked) {
        return next(new HttpError(401, "SESSION_REVOKED", "Session revoked by admin — please log in again"));
      }
      return continueAuthChain(req, res, next, payload);
    })
    .catch((err) => {
      // BUG-356 L5 Standard 2 absorb — structured `kind` tag so
      // operators can filter on `kind=jwt_blacklist_fail_open` in log
      // aggregators and alert on sustained Redis degradation. OWASP
      // ASVS v4 §2.8.7 permits fail-open only when the degradation is
      // *alertable* — unstructured warn lines filter out in warn
      // floods. Pino structured tag is the alertable observability.
      logger.warn(
        {
          err,
          staffId: payload.id,
          kind: "jwt_blacklist_fail_open",
          reason: isAuthChainTimeoutError(err) ? 'timeout' : 'upstream_error',
          stage: 'auth.middleware.revocation_check',
        },
        "BUG-356/A1a: revocation check failed — failing open",
      );
      return continueAuthChain(req, res, next, payload);
    });
}

function continueAuthChain(
  req: Request,
  res: Response,
  next: NextFunction,
  payload: AccessTokenPayload,
): void {
  // BUG-463 — project the discriminated payload into the flat
  // `AuthRequestUser` shape declared in `types/express.d.ts`. Each
  // variant contributes exactly the typed-optional fields the
  // downstream middleware + handlers read; variant-tag narrowing
  // replaces the prior shape-extension casts. Variant-tag narrowing
  // is the SSoT for which fields are populated.
  const user: NonNullable<Request['user']> = {
    id: payload.id,
    clinicId: payload.clinicId,
    role: payload.role,
    // patient_app variant has no `permissions` array — flatten to [].
    permissions: 'permissions' in payload ? payload.permissions : [],
    givenName: payload.givenName ?? '',
    familyName: payload.familyName ?? '',
    email: 'email' in payload ? payload.email ?? null : null,
  };

  if (payload.kind === 'patient_app') {
    user.patientId = payload.patientId;
    user.isPatientApp = true;
  }
  if (payload.kind === 'staff_break_glass') {
    user.breakGlass = true;
    user.breakGlassSessionId = payload.breakGlassSessionId;
  }
  if (payload.kind === 'staff_impersonation') {
    user.impersonator = payload.impersonator;
    user.impersonationSessionId = payload.impersonationSessionId;
  }

  req.user = user;
  req.clinicId = payload.clinicId;

  // BUG-310 — first admin/superadmin request for a clinic triggers a
  // tenant-scoped integration-config drift check (fail-open; warning +
  // audit side-effects only).
  schedulePerClinicIntegrationConfigDriftCheck({
    clinicId: user.clinicId,
    actorId: user.id,
    role: user.role,
  });

  // Chain: session idle check → RLS transaction wrap → route.
  // The idle middleware rejects the request with 401
  // SESSION_EXPIRED if the user's Redis idle window has expired
  // (sliding window, refreshed on every successful request).
  // It fails open if Redis is unreachable — the JWT exp claim
  // still enforces the hard session lifetime.
  sessionIdleMiddleware(req, res, (err?: unknown) => {
    if (err) return next(err);
    // Chain: break-glass audit tagging → RLS → route.
    // breakGlassAuditMiddleware is a no-op for normal sessions and
    // rejects expired/revoked break-glass sessions before they touch
    // clinical data. It also appends an action descriptor to
    // break_glass_sessions.actions_performed for forensic replay.
    breakGlassAuditMiddleware(req, res, (bgErr?: unknown) => {
      if (bgErr) return next(bgErr);
      // Tier 12.13 — impersonation audit tagging. No-op for normal
      // sessions; rejects expired/ended impersonation tokens.
      adminImpersonationAuditMiddleware(req, res, (impErr?: unknown) => {
        if (impErr) return next(impErr);
        // Chain into RLS middleware — wraps the rest of the request
        // in a transaction with SET LOCAL app.clinic_id for
        // database-level tenant isolation.
        rlsMiddleware(req, res, next);
      });
    });
  });
}

export const requireAuth = authMiddleware;
