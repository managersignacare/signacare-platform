// apps/api/src/shared/writeLlmAccessBypassAudit.ts
//
// BUG-279 — bypass-role visibility for LLM endpoints.
//
// BUG-036 added requirePatientRelationship gates on the 5 LLM endpoints
// that consume patient data (/llm/clinical-ai, /llm/agent, /scribe/
// patient-summary, /scribe/referral-letter, /scribe/search). Those gates
// short-circuit for roles in BYPASS_ROLES (superadmin, admin) so the
// 403 path is never taken — forbiddenAccessAudit never fires, and
// bypass-role usage of LLM endpoints leaves no forensic trail.
//
// This helper writes a dedicated 'LLM_ACCESS_BYPASS_ROLE' audit row at
// every success site where BYPASS_ROLES was the only reason the patient-
// relationship gate didn't block the call. It is INVOKED EXPLICITLY
// from each of the 5 endpoints — not wired as middleware — so every
// bypass audit is visible at its call site and a reader can trace why
// the audit exists without hunting through app.use chains.
//
// Scope discipline (from BUG-279 plan):
//   - Fires only on 200-class success; failure paths already emit
//     FORBIDDEN_ACCESS + standard error audit.
//   - Fires only when caller role is in BYPASS_ROLES. Non-bypass calls
//     are already logged via llm_interactions (BUG-037 canonical writer).
//   - Audit row uses dbAdmin (RLS bypass) — audit writes never fail RLS.
//
// Standard: OWASP A09 (Security Logging Failures), APP 11 (forensic
// discoverability), HIPAA §164.312(b) (audit controls).

import type { Request } from 'express';
import { logger } from '../utils/logger';
import { writeAuditLog } from '../utils/audit';
import { BYPASS_ROLES } from './authConstants';

export interface LlmBypassAuditParams {
  /** Express request — needed for clinicId + user */
  req: Request;
  /** Target patient for the LLM call; null for non-patient-bound calls */
  patientId: string | null;
  /** Canonical endpoint path (e.g. '/llm/clinical-ai'). */
  endpoint: string;
  /** LLM feature name matching llm_interactions.feature column. */
  feature: string;
}

/**
 * Write a 'LLM_ACCESS_BYPASS_ROLE' audit row when the caller is in
 * BYPASS_ROLES. No-op when caller is a regular clinician (their call
 * was gated by requirePatientRelationship and logged by
 * recordLlmInteraction).
 *
 * Non-blocking from the request's perspective: audit failure MUST NOT
 * break the response. Uses writeAuditLog's built-in structured-logging
 * fallback. Returns Promise<void> — callers `await` it on the success
 * path before res.json() so the audit row is durable when the client
 * receives the 200.
 */
export async function writeLlmAccessBypassAudit(
  params: LlmBypassAuditParams,
): Promise<void> {
  const role = params.req.user?.role;
  if (!role || !BYPASS_ROLES.has(role)) return;

  const staffId = params.req.user?.id;
  const clinicId = params.req.clinicId;
  if (!staffId || !clinicId) {
    logger.warn(
      { endpoint: params.endpoint, hasStaffId: !!staffId, hasClinicId: !!clinicId },
      '[BUG-279] writeLlmAccessBypassAudit called without staffId or clinicId',
    );
    return;
  }

  try {
    // recordId is typed string; audit.ts substitutes the nil UUID for
    // non-UUID values and preserves the original in new_data._recordRef.
    // For non-patient-bound calls we pass '' so that substitution fires.
    await writeAuditLog({
      actorId: staffId,
      clinicId,
      action: 'LLM_ACCESS_BYPASS_ROLE',
      tableName: 'llm_interactions',
      recordId: params.patientId ?? '',
      newData: {
        endpoint: params.endpoint,
        feature: params.feature,
        role,
        patientId: params.patientId,
      },
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), endpoint: params.endpoint, staffId, clinicId },
      '[BUG-279] writeLlmAccessBypassAudit: failed to write audit row',
    );
  }
}
