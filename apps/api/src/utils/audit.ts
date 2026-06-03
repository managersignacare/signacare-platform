import { db, rlsStore } from '../db/db';
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger';
import { enqueueAuditOutbox } from '../shared/auditOutbox';
import { buildAuditDedupeKey } from '../shared/auditDedupeKey';
import { withTimeout } from '../shared/observability/withTimeout';
import { withTenantContext } from '../shared/tenantContext';

export type AuditAction =
  | 'READ'
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'SOFT_DELETE'
  | 'RESTORE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'MFA_VERIFY'
  | 'PASSWORD_RESET_REQUEST'
  | 'PASSWORD_RESET_CONFIRM'
  | 'ACCESS'
  // BUG-374b — patient identity-wipe per Australian Privacy Act 1988 +
  // Health Records Act 2001 (Vic) right-to-erasure when retention floor
  // exceeded. Free-text in clinical_notes is NOT scrubbed per Q-C policy
  // (patient identity wipe only).
  | 'ANONYMISE'
  // ACHS Std 4 — order-time contraindication guard blocks an
  // unsafe prescription and writes this row so a forensic review
  // can enumerate every flagged attempt per tenant.
  | 'CONTRAINDICATION_BLOCKED'
  // Audit Tier 5.3 — chat classifier blocked a prescribing /
  // dosage / controlled-drug prompt before the LLM call.
  | 'AI_CHAT_CLASSIFIER_BLOCK'
  // Audit Tier 5.9 — two-person training-export approval flow.
  | 'TRAINING_EXPORT_REQUESTED'
  | 'TRAINING_EXPORT_APPROVED'
  | 'TRAINING_EXPORT_REJECTED'
  | 'TRAINING_EXPORT_DOWNLOADED'
  // BUG-238 — HL7 outbound transport outcomes. Three distinct terminal
  // states so the operator surface can triage success, transport
  // failure (retryable), and config-missing (not retryable).
  | 'HL7_DISPATCH_SUCCESS'
  | 'HL7_DISPATCH_FAILURE'
  | 'HL7_DISPATCH_HELD_UNCONFIGURED'
  // BUG-262 — HL7 inbound ORU^R01 ingestion outcomes. The silent-drop
  // stub at hl7Worker.ts previously ACK'd the lab + threw; now the
  // worker writes one of these audit rows per inbound message so
  // forensic review can distinguish "parsed + persisted cleanly" from
  // "order-number-not-found" (lab sent a result for an order Signacare
  // has no record of — either clinic mismatch or bogus message).
  | 'HL7_INBOUND_INGESTED'
  | 'HL7_INBOUND_ORDER_NOT_FOUND'
  // BUG-035 — /ambient-note gate verified (consent + patient relationship)
  // and audio storage proceeded. `record_id` binds to the scribe_consents
  // row used for forensic traceability.
  | 'AMBIENT_NOTE_RECORDING_STARTED'
  // BUG-274 — patient (or clinician on patient's behalf) revoked a
  // scribe consent mid-session. `record_id` binds to the scribe_consents
  // row being revoked. new_data carries {sessionId?, blobDeleted:boolean,
  // reason, chunksPurged:number, transcriptChars:number} so a forensic
  // reviewer can reconstruct what audio/transcript WAS captured before
  // the revoke and confirm the in-memory purge ran.
  | 'AMBIENT_NOTE_RECORDING_REVOKED'
  // BUG-037 — recordLlmInteraction write to llm_interactions failed; this
  // row is the best-effort secondary audit so operators can detect audit
  // trail degradation. Per HIPAA 164.312(b), audit loss must be observable.
  | 'LLM_AUDIT_WRITE_FAILED'
  // BUG-279 — admin/superadmin (BYPASS_ROLES) used an LLM endpoint that
  // would have been gated by requirePatientRelationship for a regular
  // clinician. Dedicated forensic signal — bypass-role LLM usage is the
  // highest-impact misuse vector and must be visible to the governance
  // dashboard. record_id binds to the patientId when the call was patient-
  // scoped; null when the call was non-patient-bound.
  | 'LLM_ACCESS_BYPASS_ROLE'
  // BUG-354 forward-fix — `clinics_access_admin_slot_integrity()` trigger
  // (migration 20260423000007) emits this action when it NULLs
  // `clinics.{nominated,delegated}_admin_staff_id` because the referenced
  // staff transitioned to an ineligible state. `record_id` = the clinic
  // whose slot was cleared. `new_data` JSONB carries {staff_id, reason,
  // slot}. Reason is one of 'role_demoted', 'deactivated', 'soft_deleted',
  // 'clinic_transferred'. Required by HIPAA §164.312(b) + OWASP ASVS v4
  // §7.1.3 — automatic security controls must be recorded.
  | 'ADMIN_SLOT_CLEARED_BY_TRIGGER'
  // BUG-356 — access-token + refresh-session revocation triggered by a
  // role or is_active state change on the staff row. `record_id` =
  // the subject staff id; old_data/new_data carry {role, is_active}
  // pre/post + a `trigger` field indicating which column fired.
  // Emitted from staffService.updateStaff alongside the Redis blacklist
  // + staff_sessions revoke_at write. Closes L4 Rule 5 absorb
  // (forensic review must be able to answer "when was staff X's
  // session revoked, by whom" without cross-referencing Redis key TTLs).
  | 'SESSION_REVOKED_BY_STATE_CHANGE'
  // BUG-362 — one-off reconciliation sweep for stale admin slots.
  // BUG-354 trigger only fires on NEW transitions; pre-existing
  // slots pointing at already-ineligible staff (operational role,
  // is_active=false, deleted_at NOT NULL) are cleared exactly once
  // by migration 20260423000008. `record_id` = the clinic whose slot
  // was cleared; `new_data` JSONB carries {staff_id, reason, slot}
  // matching the BUG-354 trigger shape. user_id is NULL (system
  // reconciliation, not a clinician action).
  | 'ADMIN_SLOT_CLEARED_RECONCILIATION'
  // BUG-353 Layer B — DB trigger `force_revoke_sessions_on_staff_state_change`
  // writes this action when it forces `staff_sessions.revoked_at = NOW()`
  // in response to a staff.role / is_active / deleted_at / clinic_id
  // transition. Distinct from Layer A's `SESSION_REVOKED_BY_STATE_CHANGE`
  // (emitted from staffService.updateStaff) so forensic review can tell
  // "revoked via the app service" from "revoked via DB trigger (direct
  // SQL or ops maintenance path)". `new_data` carries {trigger,
  // sessions_revoked, old_/new_ state snapshots}.
  | 'SESSION_REVOKED_BY_STATE_CHANGE_TRIGGER'
  // BUG-369 — clinical-note mutations MUST write a forensic audit row
  // per HIPAA §164.312(b). `clinical_note_versions` is the restore/undo
  // ledger; audit_log is the SEPARATE forensic trail answering "who
  // touched note N, when, from where". Pre-BUG-369, `clinicalNoteService`
  // wrote only the versions row — a clinical-incident investigation
  // had no audit trail. These literals are emitted from the service
  // after the repository write succeeds.
  //
  // `NOTE_CROSS_AUTHOR_SIGN` is structurally distinct from `NOTE_SIGN`
  // (L4 absorb 2026-04-24): a clinician signing ANOTHER clinician's
  // note (typically an AI-drafted or scribe-captured draft) is the
  // highest-risk lifecycle action. AHPRA / coronial review uses a
  // first-class action literal so the search is an exact-match query,
  // not a JSON-field filter on `reviewedAndAdopted: true`.
  | 'NOTE_CREATE'
  | 'NOTE_UPDATE'
  | 'NOTE_SIGN'
  | 'NOTE_CROSS_AUTHOR_SIGN'
  | 'NOTE_AMEND'
  | 'NOTE_SOFT_DELETE'
  // BUG-395 — AI chat patient-context UUID lock. Emitted when a
  // clinician's /clinical-ai request attempts to switch patientId
  // mid-conversation (conversationId already bound to a different
  // patient). Distinct from AI_CHAT_CLASSIFIER_BLOCK (which is for
  // pre-LLM prompt classification) so forensic review can query
  // cross-patient-attempt events specifically.
  | 'AI_CHAT_CONTEXT_VIOLATION'
  // BUG-467 — AUDIT-ACTION-UNION-BYPASS. Ten literals that were
  // previously written directly via db('audit_log').insert bypass
  // (F-audit-action-union Wave 6b finding) are now first-class members
  // of the union so TS catches typos + forensic queries are by exact
  // literal. See docs/archive/audit-2026-04-24/findings/findings-6b-
  // audit-action-union.md for the pre-fix bypass sites.
  | 'FORBIDDEN_ACCESS'
  | 'READ_LIST'
  | 'APPROVAL_EXECUTED'
  | 'APPROVAL_REQUEST'
  | 'SCRIBE_HALLUCINATION_BLOCKED'
  | 'BREAK_GLASS_REQUESTED'
  | 'BREAK_GLASS_APPROVED'
  | 'BREAK_GLASS_DENIED'
  | 'BREAK_GLASS_REVOKED'
  | 'ADMIN_ALERT'
  // BUG-310 — per-clinic integration drift detected on first
  // admin/superadmin request for a tenant. This captures a tenant-
  // scoped mismatch where clinic feature flags are ON but required
  // integration runtime/config surfaces are incomplete.
  | 'CLINIC_INTEGRATION_CONFIG_DRIFT'
  // BUG-467 L3-absorb 2026-04-24: 11th bypass site at
  // `features/patients/duplicateRoutes.ts` used `trx('audit_log').insert`
  // with action `'PATIENT_MERGED'` — was un-migrated in the first pass
  // because the guard regex only covered `db|dbAdmin`, not `trx(...)`.
  // Patient-merge is a HIPAA §164.312(b) forensic-critical event
  // (patient identity change — legal / coronial review MUST be able
  // to reconstruct the merge chain). Now a first-class union member.
  | 'PATIENT_MERGED'
  // BUG-430-PATIENT-APP — patient-app session attempted to access
  // another patient's data via path-param mismatch on
  // /api/v1/patient-app/*/:patientId. record_id = the legitimate
  // token patientId; new_data carries {attempted_patient_id, route,
  // method, ip} so a forensic search filters on
  // attempted_patient_id !== record_id. requirePatientOwnership in
  // shared/authGuards.ts is the only writer.
  | 'PATIENT_APP_IDOR_ATTEMPT'
  // BUG-577 — pathologyCriticalScheduler reassigned a critical
  // pathology alert from the original primary_clinician_id +
  // ordered_by_id (both inactive) to the clinic's nominated/delegated
  // admin. record_id = pathology_results.id; new_data carries
  // { primary_clinician_id, orderer_id, admin_staff_id, reason }.
  // AHPRA Standard 1 requires immutable trail of clinical-safety
  // routing fallbacks for incident review and accreditation; pino
  // WARN logs are not durable enough.
  | 'CRITICAL_RECIPIENT_REASSIGNED'
  // BUG-577 — pathologyCriticalScheduler had no recipient at all
  // (both original recipients inactive AND no clinic admin
  // configured). Silent-drop class — the worst-case clinical-safety
  // scenario for a critical pathology result. record_id =
  // pathology_results.id; new_data carries { primary_clinician_id,
  // orderer_id, reason: 'no_admin_configured' }. ERROR-level emission
  // pairs with the pino ERROR log so ops + AHPRA review have a
  // durable trail.
  | 'CRITICAL_NO_RECIPIENT_AVAILABLE'
  // BUG-584 — mhaReviewScheduler reassigned an MHA statutory-review
  // alert from the original primary_clinician_id + creator_staff_id
  // (both inactive) to the clinic's nominated/delegated admin.
  // record_id = legal_orders.id (or patient_legal_orders.id);
  // new_data carries { source_table, primary_clinician_id,
  // creator_staff_id, admin_staff_id, bucket, reason }. AHPRA
  // Standard 1 + state Mental Health Act statutory-review timing
  // require an immutable trail of routing fallbacks for incident
  // review. Sibling of CRITICAL_RECIPIENT_REASSIGNED for pathology.
  | 'MHA_REVIEW_RECIPIENT_REASSIGNED'
  // BUG-584 — mhaReviewScheduler had no recipient at all (both
  // primary clinician + creator inactive AND no clinic admin
  // configured). Silent-drop class — the worst-case clinical-safety
  // scenario for a statutory-review-deadline alert. record_id =
  // legal_orders.id (or patient_legal_orders.id); new_data carries
  // { source_table, primary_clinician_id, creator_staff_id, bucket,
  // reason: 'no_admin_configured' }. Sibling of
  // CRITICAL_NO_RECIPIENT_AVAILABLE for pathology.
  | 'MHA_REVIEW_NO_RECIPIENT_AVAILABLE'
  // BUG-589 — prescriptionRepeatScheduler reassigned a prescription-
  // repeat alert from the original prescribed_by_staff_id +
  // primary_clinician_id (both inactive) to the clinic's
  // nominated/delegated admin. record_id = prescriptions.id; new_data
  // carries { prescribed_by_staff_id, primary_clinician_id,
  // admin_staff_id, bucket, generic_name, reason }. Higher harm
  // class than pathology/MHA equivalents because depot-LAI gap =
  // relapse risk; clozapine gap >2 days = re-titration restart.
  | 'PRESCRIPTION_REPEAT_RECIPIENT_REASSIGNED'
  // BUG-589 — prescriptionRepeatScheduler had no recipient at all
  // (both prescriber + primary inactive AND no clinic admin). Silent-
  // drop class — the worst-case clinical-safety scenario for a
  // prescription-repeat continuity alert. record_id =
  // prescriptions.id; new_data carries { prescribed_by_staff_id,
  // primary_clinician_id, bucket, generic_name, reason:
  // 'no_admin_configured' }.
  | 'PRESCRIPTION_REPEAT_NO_RECIPIENT_AVAILABLE'
  // BUG-592 — therapeuticLevelMonitoringScheduler reassigned an
  // overdue level-monitoring alert (lithium / valproate /
  // carbamazepine / warfarin) from the original prescriber +
  // primary clinician (both inactive) to the clinic's nominated /
  // delegated admin. record_id = prescriptions.id; new_data carries
  // { prescribed_by_staff_id, primary_clinician_id, admin_staff_id,
  // drug_label, test_code, days_since_last_result, reason }. Lithium
  // narrow therapeutic window; warfarin INR variability; valproate
  // / carbamazepine hepatotoxicity / aplastic anaemia surveillance.
  | 'THERAPEUTIC_LEVEL_RECIPIENT_REASSIGNED'
  // BUG-592 — therapeuticLevelMonitoringScheduler had no recipient
  // (both prescriber + primary inactive AND no clinic admin).
  // Silent-drop class — worst-case scenario for therapeutic-level
  // monitoring (TGA black-box drugs typically; missed surveillance
  // = patient-harm class).
  | 'THERAPEUTIC_LEVEL_NO_RECIPIENT_AVAILABLE'
  // BUG-570 — LAI due-alert scheduler reassigned a due/overdue depot
  // alert from original prescriber + primary clinician (both inactive)
  // to clinic admin fallback. record_id = lai_schedules.id; new_data
  // carries { prescriber_staff_id, primary_clinician_id, admin_staff_id,
  // bucket, reason }.
  | 'LAI_DUE_RECIPIENT_REASSIGNED'
  // BUG-570 — LAI due-alert scheduler had no active recipient and no
  // clinic admin fallback. Silent-drop class for depot continuity
  // alerts; record_id = lai_schedules.id; new_data carries
  // { prescriber_staff_id, primary_clinician_id, bucket, reason }.
  | 'LAI_DUE_NO_RECIPIENT_AVAILABLE'
  // BUG-573 — advanceDirectiveReviewScheduler reassigned an
  // advance-directive review alert from the intended primary
  // clinician (inactive) to clinic admin fallback. record_id =
  // advance_directives.id; new_data carries
  // { primary_clinician_id, admin_staff_id, bucket, reason }.
  | 'ADVANCE_DIRECTIVE_REVIEW_RECIPIENT_REASSIGNED'
  // BUG-573 — advanceDirectiveReviewScheduler had no active recipient
  // and no clinic admin configured. Silent-drop class for review-due
  // consent/governance documents; record_id = advance_directives.id;
  // new_data carries { primary_clinician_id, bucket, reason }.
  | 'ADVANCE_DIRECTIVE_REVIEW_NO_RECIPIENT_AVAILABLE'
  // BUG-574 — clozapineMonitoringWeekScheduler reassigned a
  // monitoring-week (1..18) review-point alert from original
  // prescriber + primary clinician (both inactive) to clinic admin
  // fallback. record_id = clozapine_registrations.id; new_data carries
  // { prescriber_staff_id, primary_clinician_id, admin_staff_id,
  //   monitoring_week, bucket, reason }.
  | 'CLOZAPINE_MONITORING_WEEK_RECIPIENT_REASSIGNED'
  // BUG-574 — clozapineMonitoringWeekScheduler had no active recipient
  // and no clinic admin configured. Silent-drop class for clozapine
  // weekly review-point alerts during weeks 1..18. record_id =
  // clozapine_registrations.id; new_data carries
  // { prescriber_staff_id, primary_clinician_id, monitoring_week,
  //   bucket, reason }.
  | 'CLOZAPINE_MONITORING_WEEK_NO_RECIPIENT_AVAILABLE'
  // BUG-572 — ectConsentExpiryScheduler reassigned an ECT consent-
  // expiry alert from treating psychiatrist + primary clinician (both
  // inactive) to clinic admin fallback. record_id = ect_courses.id;
  // new_data carries { treating_psychiatrist_id, primary_clinician_id,
  // admin_staff_id, consent_date, consent_expires_at, bucket, reason }.
  | 'ECT_CONSENT_RECIPIENT_REASSIGNED'
  // BUG-572 — ectConsentExpiryScheduler had no active recipient and no
  // clinic admin configured. Silent-drop class for ECT consent-expiry
  // alerts; record_id = ect_courses.id; new_data carries
  // { treating_psychiatrist_id, primary_clinician_id, consent_date,
  // consent_expires_at, bucket, reason }.
  | 'ECT_CONSENT_NO_RECIPIENT_AVAILABLE'
  // BUG-581 — suicidalIdeationAfterHoursScheduler reassigned an
  // after-hours high suicide-risk clinical-note alert to clinic admin
  // because no on-call psychiatrist candidate was resolvable at note
  // timestamp. record_id = clinical_notes.id; new_data carries
  // { note_id, patient_id, author_id, risk_assessment_id,
  // overall_risk_level, admin_staff_id, reason }.
  | 'SI_AFTER_HOURS_RECIPIENT_REASSIGNED'
  // BUG-581 — suicidalIdeationAfterHoursScheduler had no on-call
  // psychiatrist AND no clinic admin fallback. Fail-visible silent-drop
  // class for high suicide-risk after-hours notes. record_id =
  // clinical_notes.id; new_data carries
  // { note_id, patient_id, author_id, risk_assessment_id,
  // overall_risk_level, reason }.
  | 'SI_AFTER_HOURS_NO_RECIPIENT_AVAILABLE'
  // BUG-411 (2026-05-03) — clinic_settings UPDATE forensic trail.
  // The PATCH /api/v1/clinic-settings endpoint mutates per-clinic
  // configuration (scribe consent mode, AI chat classifier mode,
  // scribe audio retention TTL). Pre-fix two-rail "WHO is logged"
  // (auth middleware) but "WHAT was changed" was not — config
  // drift across audit reviews could not reconstruct the timeline.
  // record_id = clinic_settings row id (or clinic_id if first-write
  // creates the row in the same call). new_data carries the diff:
  // { scribe_consent_mode, ai_chat_classifier_mode,
  //   scribe_audio_retention } as set by the request; oldData carries
  // the prior values (NULL on first-write). Admin/superadmin role
  // gate per requireRoles(['admin', 'superadmin']).
  | 'CLINIC_SETTINGS_UPDATE'
  // BUG-400d (2026-05-03) — legal-order forensic trail per Mental
  // Health Act 2014 (Vic) + AHPRA Standard 1. MHA orders are
  // statutory documents; the regulator-grade audit trail requires
  // an immutable record of who created / amended each order.
  // record_id = patient_legal_orders.id; new_data carries the
  // post-mutation row shape; oldData (UPDATE only) carries pre-image.
  | 'LEGAL_ORDER_CREATE'
  | 'LEGAL_ORDER_UPDATE'
  // BUG-400d (2026-05-03) sibling — auto-archive of legal_orders.
  // Currently fires inside GET /:id/legal-orders as a side-effect
  // (BUG-400e tracks the migration to a daily cron). The audit row
  // is written here so the forensic trail captures the transition
  // even before BUG-400e moves the side-effect to a scheduler.
  // user_id = the GET caller (NOT the actor of the original order)
  // until BUG-400e moves to system-actor cron. oldData carries
  // { status: 'active', end_date }; newData carries
  // { status: 'expired', end_date, auto_expired_by: 'list_handler',
  //   patient_id, order_type_id } so a forensic reviewer can
  // distinguish "auto-expired by list-handler GET" from
  // "actively-expired by clinician-driven PATCH".
  | 'LEGAL_ORDER_AUTO_EXPIRED'
  // BUG-NEW-ESCALATION-AUDIT (2026-05-03) — escalation forensic trail
  // per AHPRA Standard 6 handover record + Mental Health Act 2014 (Vic)
  // Standard 1 statutory escalation. ISBAR escalations are clinical
  // handover decisions; the regulator-grade audit trail requires an
  // immutable record of who resolved / annotated each escalation.
  // Sibling pattern of BUG-400d (LEGAL_ORDER_*). PHI redaction:
  // oldData/newData carry STRUCTURAL columns only (status, lockVersion,
  // resolvedAt, resolvedById, patientId, episodeId, eventCount). The
  // `notes` parameter to resolve()/addNote() is clinician free-text PHI
  // and MUST NOT land in immutable audit_log per audit.ts:280+303
  // contract. The note content is preserved in the mutable
  // `escalation_events.notes` column where it CAN be redacted under
  // Privacy Act APP 13.1 / OAIC suppression / HPP 4 retention.
  | 'ESCALATION_RESOLVE'
  | 'ESCALATION_NOTE_ADDED'
  // BUG-NEW-ESCALATION-AUDIT-FOLLOWUP-LIFECYCLE-PARITY (2026-05-03) —
  // close ISBAR lifecycle parity gap. Resolve + addNote already emit
  // (BUG-NEW-ESCALATION-AUDIT). Update mutates assigned_team / priority
  // (admin metadata, no clinical state transition); Acknowledge captures
  // first-touch (status=open → in_progress + acknowledged_at + acknowledged_by_id).
  // PHI redaction: notes parameter (clinician free-text) NOT included in
  // oldData/newData — preserved in mutable escalation_events.notes column.
  | 'ESCALATION_UPDATE'
  | 'ESCALATION_ACKNOWLEDGE'
  // BUG-403-FOLLOWUP-CONFIG-WRITE-AUDIT (2026-05-03) — clinical-impact
  // configuration write (Rule 5 traceability). Threshold values drive
  // clinical-safety classification (clozapine ANC red/amber bands → STOP
  // order vs continue). Forensic reviewer reconstructing "who changed
  // the clozapine red threshold from 1.5 to 1.7 and when?" can now
  // answer. Sibling pattern of CLINIC_SETTINGS_UPDATE (BUG-411).
  // PHI redaction: oldData/newData carry only structural numeric values
  // and key names — no patient data crosses this surface.
  | 'THRESHOLD_UPDATE';

export interface AuditContext {
  clinicId: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditPayload {
  tableName: string;
  recordId: string;
  action: AuditAction;
  /** Metadata-only — never include raw PHI blobs */
  oldValues?: unknown;
  newValues?: unknown;
  /** Alias for newValues used by some callers */
  newData?: unknown;
  oldData?: unknown;
}

export type FlatAuditEntry = {
  clinicId: string;
  /** userId or actorId accepted */
  userId?: string;
  actorId?: string;
  ipAddress?: string;
  userAgent?: string;
} & AuditPayload;

function isUuidLike(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function insertAuditRowIdempotent(row: Record<string, unknown>): Promise<void> {
  const clinicId = row.clinic_id;
  const tenantTrx = rlsStore.getStore() as { isCompleted?: () => boolean } | undefined;
  const hasActiveTenantContext = Boolean(
    tenantTrx
    && !(typeof tenantTrx.isCompleted === 'function' && tenantTrx.isCompleted()),
  );
  const isTenantScopedClinic = isUuidLike(clinicId) && clinicId !== '00000000-0000-0000-0000-000000000000';
  const actorIdCandidate = row.staff_id ?? row.user_id;
  const actorId = isUuidLike(actorIdCandidate) ? actorIdCandidate : undefined;

  if (!hasActiveTenantContext && isTenantScopedClinic) {
    await withTenantContext(clinicId, async () => {
      await db('audit_log')
        .insert(row)
        .onConflict('dedupe_key')
        .ignore();
    }, actorId);
    return;
  }

  await db('audit_log')
    .insert(row)
    .onConflict('dedupe_key')
    .ignore();
}

const AUDIT_DB_WRITE_TIMEOUT_MS_DEFAULT = 2_000;
const AUDIT_OUTBOX_ENQUEUE_TIMEOUT_MS_DEFAULT = 1_000;
const NON_STAFF_ACTOR_CACHE_MAX = 5_000;
const knownNonStaffActorIds = new Set<string>();
const LLM_BYPASS_AUDIT_WRITE_FAILURE_ALERT_KIND = 'llm_access_bypass_audit_write_failed';

// R-FIX-BUG-328-BYPASS-AUDIT-FAILURE-SIGNAL
function buildAuditFailureAlertMeta(action: AuditAction): Record<string, string> {
  if (action !== 'LLM_ACCESS_BYPASS_ROLE') return {};
  return {
    alertKind: LLM_BYPASS_AUDIT_WRITE_FAILURE_ALERT_KIND,
    bugId: 'BUG-328',
  };
}

function resolvePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function resolveAuditDbWriteTimeoutMs(): number {
  return resolvePositiveIntEnv('AUDIT_DB_WRITE_TIMEOUT_MS', AUDIT_DB_WRITE_TIMEOUT_MS_DEFAULT);
}

function resolveAuditOutboxEnqueueTimeoutMs(): number {
  return resolvePositiveIntEnv('AUDIT_OUTBOX_ENQUEUE_TIMEOUT_MS', AUDIT_OUTBOX_ENQUEUE_TIMEOUT_MS_DEFAULT);
}

function rememberNonStaffActorId(actorId: string): void {
  if (knownNonStaffActorIds.has(actorId)) return;
  if (knownNonStaffActorIds.size >= NON_STAFF_ACTOR_CACHE_MAX) {
    const oldest = knownNonStaffActorIds.values().next().value as string | undefined;
    if (oldest) knownNonStaffActorIds.delete(oldest);
  }
  knownNonStaffActorIds.add(actorId);
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return '"__undefined__"';
  if (value === null) return 'null';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${pairs.join(',')}}`;
}

function buildPayloadFingerprint(oldValues: unknown, newValues: unknown): string {
  const canonical = `old=${canonicalJson(oldValues)}|new=${canonicalJson(newValues)}`;
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

function isSchemaFallbackError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && code === '42703') {
    return true;
  }
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  return message.includes('column') && message.includes('does not exist');
}

function isStaffForeignKeyViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  const constraint = (err as { constraint?: unknown }).constraint;
  return code === '23503' && constraint === 'audit_log_staff_id_foreign';
}

async function enqueueAuditOutboxBounded(
  row: Record<string, unknown>,
  timeoutMs: number,
  metadata: {
    tableName: string;
    recordId: string;
    source: 'primary_insert' | 'primary_and_legacy_insert' | 'outer_fallback';
  },
): Promise<void> {
  try {
    await withTimeout(
      enqueueAuditOutbox(row),
      timeoutMs,
      `audit.write.enqueueOutbox.${metadata.source}`,
    );
  } catch (outboxErr) {
    logger.error(
      {
        outboxErr,
        kind: 'tier_5_9_audit_outbox_enqueue_failed',
        tableName: metadata.tableName,
        recordId: metadata.recordId,
        source: metadata.source,
        timeoutMs,
      },
      'Audit outbox enqueue failed or timed out while handling audit write failure',
    );
  }
}

/**
 * Writes a metadata-only audit row to the audit_log table.
 * Accepts two calling patterns:
 *   1. writeAuditLog(context, payload)
 *   2. writeAuditLog({ clinicId, actorId|userId, action, tableName, recordId, ... })
 * Rules:
 *  - Never write raw clinical note content or PHI field values.
 *  - Always scope by clinic_id for tenant isolation.
 *  - Never throw — audit failure must not block clinical flows.
 */
export async function writeAuditLog(
  contextOrFlat: AuditContext | FlatAuditEntry,
  payload?: AuditPayload,
): Promise<void> {
  const dbWriteTimeoutMs = resolveAuditDbWriteTimeoutMs();
  const outboxEnqueueTimeoutMs = resolveAuditOutboxEnqueueTimeoutMs();
  try {
    let clinicId: string;
    let userId: string;
    let ipAddress: string | undefined;
    let tableName: string;
    let recordId: string;
    let action: AuditAction;
    let oldValues: unknown;
    let newValues: unknown;

    if (payload !== undefined) {
      // 2-arg form: writeAuditLog(context, payload)
      const ctx = contextOrFlat as AuditContext;
      clinicId = ctx.clinicId;
      userId = ctx.userId;
      ipAddress = ctx.ipAddress;
      tableName = payload.tableName;
      recordId = payload.recordId;
      action = payload.action;
      oldValues = payload.oldValues ?? payload.oldData;
      newValues = payload.newValues ?? payload.newData;
    } else {
      // 1-arg flat form
      const flat = contextOrFlat as FlatAuditEntry;
      clinicId = flat.clinicId;
      userId = flat.userId ?? flat.actorId ?? '';
      ipAddress = flat.ipAddress;
      tableName = flat.tableName;
      recordId = flat.recordId;
      action = flat.action;
      oldValues = flat.oldValues ?? flat.oldData;
      newValues = flat.newValues ?? flat.newData;
    }
    const auditFailureAlertMeta = buildAuditFailureAlertMeta(action);

    // record_id is UUID in DB — if non-UUID value is passed, store it in new_data and use a nil UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isValidUuid = uuidRegex.test(recordId);
    const safeRecordId = isValidUuid ? recordId : '00000000-0000-0000-0000-000000000000';
    const safeUserId = userId && uuidRegex.test(userId) ? userId : null;
    const safeStaffId = safeUserId && !knownNonStaffActorIds.has(safeUserId) ? safeUserId : null;
    const safeClinicId = uuidRegex.test(clinicId) ? clinicId : '00000000-0000-0000-0000-000000000000';

    // If recordId was not a UUID, include it in newValues for searchability
    const augmentedNewValues = !isValidUuid
      ? { ...(typeof newValues === 'object' && newValues ? newValues : {}), _recordRef: recordId }
      : newValues;

    // BUG-283 L4 absorb — `created_at` is captured HERE at the call site
    // so outbox replay preserves forensic chronology. Without this the
    // DB default NOW() would stamp replay time (minutes-to-hours after
    // the event), producing out-of-order audit rows for coronial review
    // (e.g. patient-create row dated AFTER a clinical-note-create row
    // that referenced the patient). ISO-8601 string — Knex serialises
    // a JS Date; explicit string survives JSON round-trip through Redis.
    const eventTime = new Date().toISOString();
    const dedupeKey = buildAuditDedupeKey({
      clinicId: safeClinicId,
      tableName,
      recordId: safeRecordId,
      action,
      eventTimeIso: eventTime,
      payloadFingerprint: buildPayloadFingerprint(oldValues, augmentedNewValues),
    });

    // Write to BOTH old-schema and v2-schema columns for compatibility.
    // The audit_log table may have either set depending on which migration created it.
    const row: Record<string, unknown> = {
      clinic_id:   safeClinicId,
      dedupe_key:  dedupeKey,
      // v2 columns
      staff_id:    safeStaffId,
      table_name:  tableName,
      record_id:   safeRecordId,
      operation:   action,
      ip_address:  ipAddress  ?? null,
      old_data:    oldValues  ? JSON.stringify(oldValues)  : null,
      new_data:    augmentedNewValues  ? JSON.stringify(augmentedNewValues)  : null,
      // Legacy columns (may or may not exist — Knex ignores extra columns on some DBs)
      user_id:     safeUserId,
      username:    null,
      action:      action?.toLowerCase() ?? null,
      module:      tableName,
      entity_type: tableName,
      entity_id:   safeRecordId === '00000000-0000-0000-0000-000000000000' ? null : safeRecordId,
      details:     augmentedNewValues  ? JSON.stringify(augmentedNewValues)  : null,
      // BUG-283: event-time at call site, survives Redis outbox round-trip.
      created_at:  eventTime,
    };

    // Try v2 columns first. If the failure is a schema-shape mismatch
    // (legacy-only audit schema), retry with legacy columns. For all
    // other failures (timeouts/connectivity/locks), skip the legacy
    // retry and enqueue directly to outbox so request-thread wait is
    // bounded once.
    try {
      await withTimeout(
        insertAuditRowIdempotent(row),
        dbWriteTimeoutMs,
        'audit.write.primaryInsert',
      );
    } catch (primaryErr) {
      if (isStaffForeignKeyViolation(primaryErr) && safeUserId) {
        rememberNonStaffActorId(safeUserId);
        const nonStaffActorRow = {
          ...row,
          staff_id: null,
          user_id: safeUserId,
        };
        try {
          await withTimeout(
            insertAuditRowIdempotent(nonStaffActorRow),
            dbWriteTimeoutMs,
            'audit.write.nonStaffActorInsert',
          );
          logger.warn(
            {
              kind: 'audit_non_staff_actor_fallback',
              actorId: safeUserId,
              tableName,
              recordId: safeRecordId,
              cacheSize: knownNonStaffActorIds.size,
            },
            'audit_log insert retried with staff_id=NULL for non-staff actor UUID',
          );
          return;
        } catch (secondaryErr) {
          logger.error(
            {
              primaryErr,
              secondaryErr,
              kind: 'tier_5_9_audit_write_failed',
              action,
              tableName,
              recordId: safeRecordId,
              dbWriteTimeoutMs,
              ...auditFailureAlertMeta,
            },
            'audit_log non-staff actor retry failed — enqueueing to Redis outbox (BUG-283)',
          );
          await enqueueAuditOutboxBounded(nonStaffActorRow, outboxEnqueueTimeoutMs, {
            tableName,
            recordId: safeRecordId,
            source: 'primary_insert',
          });
          return;
        }
      }

      const legacyRow = {
        clinic_id: safeClinicId,
        dedupe_key: dedupeKey,
        user_id: safeUserId,
        action: action?.toLowerCase() ?? null,
        module: tableName,
        entity_type: tableName,
        entity_id: safeRecordId === '00000000-0000-0000-0000-000000000000' ? null : safeRecordId,
        ip_address: ipAddress ?? null,
        details: augmentedNewValues ? JSON.stringify(augmentedNewValues) : null,
        // BUG-283 L4 absorb: same event-time on the legacy-shape retry
        created_at: eventTime,
      };
      if (isSchemaFallbackError(primaryErr)) {
        try {
          await withTimeout(
            insertAuditRowIdempotent(legacyRow),
            dbWriteTimeoutMs,
            'audit.write.legacyInsert',
          );
          return;
        } catch (secondaryErr) {
          // Both schema shapes failed — enqueue v2 row for replay.
          logger.error(
            {
              primaryErr,
              secondaryErr,
              kind: 'tier_5_9_audit_write_failed',
              action,
              tableName,
              recordId: safeRecordId,
              dbWriteTimeoutMs,
              ...auditFailureAlertMeta,
            },
            'audit_log DB insert failed on both v2 and legacy shape — enqueueing to Redis outbox (BUG-283)',
          );
          await enqueueAuditOutboxBounded(row, outboxEnqueueTimeoutMs, {
            tableName,
            recordId: safeRecordId,
            source: 'primary_and_legacy_insert',
          });
          return;
        }
      }

      logger.error(
        {
          primaryErr,
          kind: 'tier_5_9_audit_write_failed',
          action,
          tableName,
          recordId: safeRecordId,
          dbWriteTimeoutMs,
          ...auditFailureAlertMeta,
        },
        'audit_log primary insert failed — enqueueing to Redis outbox (BUG-283)',
      );
      await enqueueAuditOutboxBounded(row, outboxEnqueueTimeoutMs, {
        tableName,
        recordId: safeRecordId,
        source: 'primary_insert',
      });
    }
  } catch (error) {
    // Outermost catch: caller passed an invalid shape or something
    // unexpected happened while building the row. Log + try to enqueue
    // whatever we can reconstruct. The row may be incomplete; the
    // drainer's JSON-parse catch will drop it if unparseable.
    const fallbackAction =
      payload?.action ??
      (contextOrFlat as { action?: AuditAction } | undefined)?.action;
    const fallbackAlertMeta = fallbackAction
      ? buildAuditFailureAlertMeta(fallbackAction)
      : {};
    logger.error(
      {
        error,
        kind: 'tier_5_9_audit_write_failed',
        action: fallbackAction,
        ...fallbackAlertMeta,
      },
      'Failed to write audit log — attempting outbox enqueue',
    );
    try {
      const fallbackRow: Record<string, unknown> = {
        clinic_id: (contextOrFlat as { clinicId?: string } | undefined)?.clinicId ?? null,
        table_name: payload?.tableName ?? (contextOrFlat as { tableName?: string } | undefined)?.tableName ?? null,
        record_id: payload?.recordId ?? (contextOrFlat as { recordId?: string } | undefined)?.recordId ?? null,
        operation: payload?.action ?? (contextOrFlat as { action?: string } | undefined)?.action ?? null,
      };
      await enqueueAuditOutboxBounded(fallbackRow, outboxEnqueueTimeoutMs, {
        tableName: String(fallbackRow.table_name ?? 'unknown'),
        recordId: String(fallbackRow.record_id ?? 'unknown'),
        source: 'outer_fallback',
      });
    } catch {
      // enqueueAuditOutboxBounded intentionally swallows and logs.
    }
  }
}

interface AuditServiceEntry {
  clinicId: string;
  userId: string;
  tableName: string;
  recordId: string;
  newData?: unknown;
  oldData?: unknown;
}

const auditLogService = {
  async logCreate(entry: AuditServiceEntry): Promise<void> {
    await writeAuditLog({ ...entry, actorId: entry.userId, action: 'CREATE', newValues: entry.newData });
  },
  async logUpdate(entry: AuditServiceEntry): Promise<void> {
    await writeAuditLog({ ...entry, actorId: entry.userId, action: 'UPDATE', oldValues: entry.oldData, newValues: entry.newData });
  },
  async logDelete(entry: AuditServiceEntry): Promise<void> {
    await writeAuditLog({ ...entry, actorId: entry.userId, action: 'SOFT_DELETE', oldValues: entry.oldData });
  },
};

export default auditLogService;
