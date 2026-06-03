// apps/api/src/middleware/patientAccessAudit.ts
//
// HIPAA §164.312(b) — Audit Controls: "Implement hardware, software, and/or
// procedural mechanisms that record and examine activity in information systems
// that contain or use ePHI."
//
// Also satisfies:
// - Health Records Act 2001 (Vic) HPP 6
// - NSQHS Standard 1 (Clinical Governance)
// - Australian Privacy Act 1988
//
// Write operations are already captured by database audit triggers (INSERT/
// UPDATE/DELETE fire AFTER triggers). This middleware captures READ access
// (GET requests) which SELECT does not trigger.
//
// Every patient-scoped GET that returns a successful response is logged with:
//   staffId   — the authenticated user who accessed the record
//   patientId — the patient whose data was read
//   endpoint  — the full request path (e.g. /api/v1/patients/:id/notes)
//   timestamp — when the access occurred (server time, UTC)
//
// Non-blocking — audit logging failures are warned but never fail the response.

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// ────────────────────────────────────────────────────────────────────────────
// Routes that access patient data and must be audit-logged.
//
// UUID pattern:  [0-9a-f-]{36}  (standard v4 UUID with hyphens)
//
// When adding a new patient-scoped endpoint, add its regex here so read-
// access is captured for HIPAA compliance.
// ────────────────────────────────────────────────────────────────────────────
const UUID = '([0-9a-f-]{36})';

const PATIENT_PATHS: RegExp[] = [
  // ── Core patient record ──
  new RegExp(`^/api/v1/patients/${UUID}$`),

  // ── Clinical sub-resources (patientRoutes.ts) ──
  new RegExp(`^/api/v1/patients/${UUID}/notes`),
  new RegExp(`^/api/v1/patients/${UUID}/medications`),
  new RegExp(`^/api/v1/patients/${UUID}/allergies`),
  new RegExp(`^/api/v1/patients/${UUID}/risk-assessments`),
  new RegExp(`^/api/v1/patients/${UUID}/flags`),
  new RegExp(`^/api/v1/patients/${UUID}/alerts`),
  new RegExp(`^/api/v1/patients/${UUID}/contacts`),
  new RegExp(`^/api/v1/patients/${UUID}/providers`),
  new RegExp(`^/api/v1/patients/${UUID}/legal-orders`),
  new RegExp(`^/api/v1/patients/${UUID}/legal-attachments`),
  new RegExp(`^/api/v1/patients/${UUID}/mha-orders`),
  new RegExp(`^/api/v1/patients/${UUID}/pathology`),
  new RegExp(`^/api/v1/patients/${UUID}/attachments`),

  // ── Prescriptions (prescriptionRoutes.ts — mounted at /prescriptions) ──
  new RegExp(`^/api/v1/prescriptions/patients/${UUID}/prescriptions`),

  // ── LAI & AIMS (laiScheduleRoutes.ts — mounted at /lai) ──
  new RegExp(`^/api/v1/lai/patients/${UUID}/lai-schedules`),
  new RegExp(`^/api/v1/lai/patients/${UUID}/aims-assessments`),

  // ── Clozapine (clozapineRoutes.ts — mounted at /clozapine) ──
  new RegExp(`^/api/v1/clozapine/patients/${UUID}/clozapine`),

  // ── Pathology orders (pathologyRoutes.ts — mounted at /pathology) ──
  new RegExp(`^/api/v1/pathology/patients/${UUID}/orders`),

  // ── Clinical review (clinicalReviewRoutes.ts) ──
  new RegExp(`^/api/v1/clinical-review/patients/${UUID}`),

  // ── Privacy / PII (privacyRoutes.ts) ──
  new RegExp(`^/api/v1/privacy/patient/${UUID}`),

  // ── Timeline & barcode (roleFeatureRoutes.ts) ──
  new RegExp(`^/api/v1/patients/${UUID}/timeline`),
  new RegExp(`^/api/v1/patients/${UUID}/barcode`),

  // ── Safety plans, advance directives, outcomes ──
  new RegExp(`^/api/v1/safety-plans/.*patients/${UUID}`),
  new RegExp(`^/api/v1/advance-directives/.*patients/${UUID}`),
  new RegExp(`^/api/v1/outcomes/.*patients/${UUID}`),

  // ── Episodes & appointments scoped to a patient ──
  new RegExp(`^/api/v1/patients/${UUID}/episodes`),
  new RegExp(`^/api/v1/patients/${UUID}/appointments`),
];

/**
 * Extract patient UUID from the request path.
 * Returns the first capture group (the UUID) from the first matching pattern.
 */
function extractPatientId(path: string): string | null {
  for (const regex of PATIENT_PATHS) {
    const match = path.match(regex);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Persist a READ audit event to the audit_log table.
 *
 * Uses dbAdmin (bypasses RLS) because the audit_log table is cross-tenant.
 * Runs asynchronously after the response has been sent — never blocks.
 */
async function logAccess(
  clinicId: string,
  staffId: string,
  patientId: string,
  endpoint: string,
  requestId: string,
): Promise<void> {
  const timestamp = new Date();

  try {
    // BUG-467 — migrated from direct dbAdmin('audit_log').insert to
    // typed writeAuditLog. Inherits BUG-283 outbox recovery.
    const { writeAuditLog } = await import('../utils/audit');
    await writeAuditLog({
      clinicId,
      actorId: staffId,
      tableName: 'patients',
      recordId: patientId,
      action: 'READ',
      newData: { endpoint, method: 'GET', requestId },
    });

    // Structured log line for SIEM ingestion (Splunk, Datadog, CloudWatch).
    // HIPAA auditors expect: who, whose data, what, when.
    logger.info({
      type: 'patient_read_access',
      staffId,
      patientId,
      endpoint,
      timestamp: timestamp.toISOString(),
      clinicId,
      requestId,
    }, `READ access: staff=${staffId} patient=${patientId} endpoint=${endpoint}`);
  } catch (err) {
    // Non-blocking — never fail the request over an audit write error.
    // Still log a warning so ops can detect audit pipeline issues.
    logger.warn({
      err: err instanceof Error ? err.message : String(err),
      staffId,
      patientId,
      endpoint,
    }, 'Patient read-access audit log write failed');
  }
}

/**
 * Matches `GET /api/v1/patients` (the list/search endpoint) with
 * any query string but NO path parameters.
 */
const PATIENT_LIST_PATH = /^\/api\/v1\/patients\/?($|\?)/;

/**
 * Persist a LIST READ audit event. Unlike detail-read audit rows,
 * this captures the search term (not the result IDs) and the
 * result count — enough to prove WHO browsed WHAT cohort when,
 * without bloating the audit_log with N rows per list call.
 */
async function logListAccess(
  clinicId: string,
  staffId: string,
  endpoint: string,
  searchTerm: string | undefined,
  requestId: string,
): Promise<void> {
  const timestamp = new Date();
  try {
    // BUG-467 — migrated to typed writeAuditLog.
    const { writeAuditLog } = await import('../utils/audit');
    await writeAuditLog({
      clinicId,
      actorId: staffId,
      tableName: 'patients',
      recordId: '00000000-0000-0000-0000-000000000000',
      action: 'READ_LIST',
      newData: {
        endpoint,
        method: 'GET',
        searchTerm: searchTerm ?? null,
        requestId,
      },
    });
    logger.info({
      type: 'patient_list_read_access',
      staffId,
      clinicId,
      searchTerm: searchTerm ?? null,
      endpoint,
      requestId,
      timestamp: timestamp.toISOString(),
    }, `READ_LIST access: staff=${staffId} endpoint=${endpoint}`);
  } catch (err) {
    logger.warn({
      err: err instanceof Error ? err.message : String(err),
      staffId,
      clinicId,
      endpoint,
    }, 'Patient list-read audit log write failed');
  }
}

/**
 * Express middleware that logs every GET request to patient-scoped endpoints.
 *
 * Registration: globally, after auth middleware (so req.user is populated)
 * but before route handlers. It hooks res 'finish' so the log fires only
 * when the response completes successfully (status < 400).
 *
 * Audits TWO classes of read:
 *   - DETAIL READ (`action: 'READ'`) — any path matching PATIENT_PATHS
 *     with a UUID in the URL. Records the specific patient_id.
 *   - LIST READ (`action: 'READ_LIST'`) — the bare /api/v1/patients
 *     endpoint with an optional `?search=` param. Records the search
 *     term but NOT the returned patient IDs (to keep audit_log row
 *     count bounded).
 *
 * APP 11 expects both — browsing a patient cohort IS an access event
 * even if no individual record was opened.
 */
export function patientAccessAudit(req: Request, res: Response, next: NextFunction): void {
  // Only audit GET (read) requests — writes are covered by DB triggers
  if (req.method !== 'GET') {
    next();
    return;
  }

  const originalUrl = req.originalUrl ?? req.path;

  // Detail read path (with UUID)
  const patientId = extractPatientId(originalUrl);

  // List read path (no UUID, bare /patients or /patients?search=)
  const isListRead = !patientId && PATIENT_LIST_PATH.test(originalUrl);

  if (!patientId && !isListRead) {
    next();
    return;
  }

  // Capture references as closures — req.user may not be set yet at
  // middleware-registration time but will be populated before 'finish'.
  const capturedClinicId = () => req.clinicId;
  const capturedStaffId = () => req.user?.id;
  const searchTerm = typeof req.query?.search === 'string' ? req.query.search : undefined;

  res.on('finish', () => {
    const clinicId = capturedClinicId();
    const staffId = capturedStaffId();

    // Only log successful reads by authenticated users
    if (res.statusCode >= 400 || !clinicId || !staffId) return;

    if (patientId) {
      logAccess(
        clinicId,
        staffId,
        patientId,
        originalUrl,
        req.requestId ?? '',
      ).catch(() => { /* non-blocking audit */ });
    } else if (isListRead) {
      logListAccess(
        clinicId,
        staffId,
        originalUrl,
        searchTerm,
        req.requestId ?? '',
      ).catch(() => { /* non-blocking audit */ });
    }
  });

  next();
}
