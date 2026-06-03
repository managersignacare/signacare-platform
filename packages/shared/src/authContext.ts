// packages/shared/src/authContext.ts
//
// Service-layer authorization context. Every service method that
// reads or writes clinical data accepts AuthContext as its first
// parameter — defense-in-depth on top of HTTP middleware RBAC.
//
// Built from req.user + req.clinicId in the controller via
// buildAuthContext(req). Services never accept raw (clinicId, staffId)
// strings without verifying the caller's role and permissions.

/**
 * Authorization context threaded through every service method.
 *
 * Controllers build this from the authenticated request; services
 * use it to enforce permissions, clinic isolation, specialty gating,
 * and clinician-patient relationship checks.
 */
export interface AuthContext {
  /** The authenticated staff member's UUID. */
  staffId: string;

  /** The clinic the request is scoped to. */
  clinicId: string;

  /** The staff member's role (clinician, nurse, receptionist, etc.). */
  role: string;

  /** Explicit permissions granted via staff_module_access + RBAC fallback. */
  permissions: string[];

  /**
   * Patient-scoped context — set when operating on a specific patient.
   * Services use this to verify clinician-patient relationship before
   * accessing PHI. Required for AI agent patient-linked queries.
   */
  patientId?: string;

  /** Per-request correlation ID for structured log tracing. */
  requestId?: string;

  /** Non-null when operating under emergency break-glass access. */
  breakGlassSessionId?: string;

  /**
   * Optional AI request scope carried from policy-gated endpoints.
   * Service/tool layers can enforce additional scope narrowing.
   */
  aiScope?: {
    level: 'patient' | 'team' | 'staff' | 'clinic';
    patientIds?: string[];
    teamIds?: string[];
    staffIds?: string[];
    teamLabels?: string[];
    staffLabels?: string[];
    timeRangeFrom?: string;
    timeRangeTo?: string;
  };

  /**
   * Optional purpose-of-use for AI policy and audit trails.
   */
  aiPurposeOfUse?: 'clinical' | 'operational' | 'analytics';

  /**
   * Policy-compiled tool allowlist bound to the signed decision token.
   */
  aiAllowedTools?: string[];

  /**
   * Signed policy decision token emitted by the AI policy layer.
   * Tool/agent executors verify this token before running scoped reads.
   */
  aiDecisionToken?: {
    tokenId: string;
    clinicId: string;
    staffId: string;
    role: string;
    permissions: string[];
    allowedTools?: string[];
    purposeOfUse: 'clinical' | 'operational' | 'analytics';
    scope?: {
      level: 'patient' | 'team' | 'staff' | 'clinic';
      patientIds?: string[];
      teamIds?: string[];
      staffIds?: string[];
      teamLabels?: string[];
      staffLabels?: string[];
      timeRangeFrom?: string;
      timeRangeTo?: string;
    };
    issuedAt: string;
    expiresAt: string;
    signature: string;
  };
}
