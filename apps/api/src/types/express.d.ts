import type { AuthUser } from '@signacare/shared';

/**
 * BUG-463 — flat projection of the discriminated AccessTokenPayload
 * (see `apps/api/src/utils/authTokens.ts`) for `req.user`. The
 * authMiddleware narrows the JWT to a variant, then projects into
 * this shape so route handlers can read typed-optional fields without
 * `as unknown as` casts.
 *
 * Patient-app sessions populate `patientId + isPatientApp`. Staff
 * break-glass sessions populate `breakGlass + breakGlassSessionId`.
 * Admin impersonation sessions populate `impersonator +
 * impersonationSessionId`. Normal staff sessions populate none of the
 * extension fields.
 */
type AuthRequestUser = Omit<AuthUser, 'role'> & {
  // Role widened to include the patient-app variant's literal `'patient'`
  // role-tag. The shared `Role` enum is staff-only by design (see
  // `packages/shared/src/rbac.schemas.ts`), but a patient-app JWT
  // legitimately stamps `role: 'patient'` at issuance and the projection
  // must carry that through. Staff role-gating middleware
  // (`requireRole`, `clinicalAccessRbac`) reject 'patient' as
  // out-of-set, which is the desired runtime behaviour.
  role: AuthUser['role'] | 'patient';
  // Patient-app variant projection (also lives on AuthUser as optional;
  // re-stated here for documentation locality alongside the others).
  patientId?: string | null;
  isPatientApp?: boolean;
  // Staff break-glass variant projection.
  breakGlass?: boolean;
  breakGlassSessionId?: string;
  // Admin impersonation variant projection.
  impersonator?: string;
  impersonationSessionId?: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthRequestUser;
      clinicId: string;
      requestId?: string;
      // HMAC-signed webhook / integration calls (see middleware/hmacSigning.ts).
      // Set when the request authenticates via an API key rather than a
      // user JWT. Routes can check `req.apiKeyId` to distinguish.
      apiKeyId?: string;
      apiKeyPermissions?: string[];
      // Break-glass session — set by breakGlassMiddleware when a clinician
      // is operating under a temporary elevation (e.g. reading a patient
      // outside their normal access scope). The ID threads through audit
      // logs so every action during the session is traceable.
      breakGlassSessionId?: string;
    }
  }
}
