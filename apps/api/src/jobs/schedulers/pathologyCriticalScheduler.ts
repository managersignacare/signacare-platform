// apps/api/src/jobs/schedulers/pathologyCriticalScheduler.ts
//
// BUG-372a — pathology critical-result alert.
//
// Every 15 minutes, scan `pathology_results` for rows where
//   (is_critical = TRUE OR abnormal_flag IN ('critical_high','critical_low'))
// AND critical_acknowledged_at IS NULL
// AND result_date is within the look-back window (default 30 minutes
// configurable via `settingsService.getThresholds(clinicId)['pathology_critical_minutes']`,
// default 30).
//
// Each unacknowledged row produces ONE notification per responsible
// clinician per UTC-day, deduped by the partial unique index on
// `(clinic_id, payload->>'dedupe_key')` per centralized scheduler emit.
//
// Responsible clinicians (fan-out, both notified when distinct):
//   - episodes.primary_clinician_id (when pathology_orders.episode_id set)
//   - pathology_orders.ordered_by_id (always set; fallback)
//
// SCHEDULER ONLY — uses `dbAdmin` (signacare_owner role) which bypasses
// RLS by virtue of the policy's USING clause not applying to the table
// owner. Bare `db()` (app_user) under no `app.clinic_id` GUC returns
// ZERO rows from RLS-enabled tables — see `apps/api/src/db/db.ts:168`
// + RLS policy in baseline migration `clinic_id = NULLIF(current_setting(
// 'app.clinic_id', true), '')::uuid` (NULL ≠ clinic_id → row excluded).
// Closed by BUG-372a L5 absorb-1 F1; the bare-db pattern in older
// schedulers (appointmentReminderScheduler, referralSlaScheduler) is
// silently broken and tracked as BUG-583 (FOLLOWUP-15).
//
// Tenant scoping is preserved: every emit carries `row.clinic_id` from
// the row itself (FK-enforced), so cross-tenant routing is impossible.
//
// fix-registry anchors: BUG372A-SCHED-EXISTS, BUG372A-DEDUPE-KEY,
// BUG372A-CRITERIA, BUG372A-FANOUT, BUG372A-DBADMIN, BUG372-TIMER-SAFETY.

import { dbAdmin } from '../../db/db';
import { logger as defaultLogger } from '../../utils/logger';
import { settingsService } from '../../features/settings/settingsService';
import { writeAuditLog } from '../../utils/audit';
import { resolveStaffRecipientsWithAdminFallback } from '../../shared/staffActivenessResolver';
import { runScheduledTick } from './runScheduledTick';
import { emitSchedulerSignal } from './schedulerSignalEmitter';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * @schema-drift-exempt select-aliased
 * BUG-372a — `PathologyAlertRow` is a SELECT-aliased shape sourced from
 * a 3-table JOIN (`pathology_results` + `pathology_orders` +
 * `episodes`), not a 1:1 row from any single table. `result_id` is
 * `pathology_results.id`; `primary_clinician_id` is sourced from the
 * `episodes` LEFT JOIN; `ordered_by_id` is sourced from `pathology_orders`.
 * `created_at` (from `pathology_results`) is used by the per-clinic
 * threshold filter inside `processPathologyCriticalAlerts`.
 * Per CLAUDE.md §15 — annotation makes the SELECT-aliased shape
 * explicit so future drift between the JOIN columns and this interface
 * cannot land silently.
 */
export interface PathologyAlertRow {
  result_id: string;
  clinic_id: string;
  patient_id: string;
  test_name: string;
  abnormal_flag: string;
  is_critical: boolean;
  result_date: string;
  /** From `pathology_results.created_at`. Drives per-clinic age filter. */
  created_at: Date | string;
  /**
   * BUG-579 — resolved recipient candidate:
   *   COALESCE(original episode primary, current open episode primary)
   */
  primary_clinician_id: string | null;
  ordered_by_id: string;
}

export interface PathologyAlertEmitInput {
  clinicId: string;
  userId: string;
  severity: 'critical';
  category: 'pathology';
  title: string;
  body: string;
  actionUrl: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

export type PathologyEscalationTier = 2 | 3 | 4;

export interface PathologyAlertContext {
  listUnacknowledgedCritical(thresholdMinutes: number, now: Date): Promise<PathologyAlertRow[]>;
  emit(input: PathologyAlertEmitInput): Promise<{ ids: string[]; published: boolean }>;
  /** Returns the per-clinic threshold-minutes (default 30 if unset). */
  getThreshold(clinicId: string): Promise<number>;
  /**
   * BUG-578 cycle-2 absorb — per-clinic tier-2 escalation threshold
   * (default 120 minutes / 2h from `DEFAULT_THRESHOLDS`). Mirrors the
   * existing `getThreshold` shape so a 24/7 inpatient ward can set
   * 30 min and an after-hours small clinic can set 240 min.
   */
  getEscalationThreshold?(clinicId: string): Promise<number>;
  /**
   * BUG-585-FOLLOWUP-MULTI-TIER-CASCADE — tier-specific escalation
   * thresholds in minutes.
   */
  getEscalationThresholdByTier?(
    clinicId: string,
    tier: PathologyEscalationTier,
  ): Promise<number>;
  /**
   * BUG-577 — filter `staff.is_active = true AND deleted_at IS NULL`
   * over the candidate recipients (primary_clinician_id +
   * ordered_by_id). When BOTH are inactive (offboarded, deactivated,
   * soft-deleted between order time and SLA breach), fall back to the
   * clinic's nominated/delegated admin per BUG-262-FU
   * `resolveCriticalAssigneeAdmin` precedent.
   *
   * Returns:
   *   - `active`: list of staff_ids that are still active (subset of
   *     [primaryClinicianId, ordererId]; deduped; primary first)
   *   - `reassignedToAdmin`: the admin staff_id when both inputs were
   *     inactive (else null). Triggers a structured WARN log so an
   *     ops dashboard can surface the routing dead-end.
   */
  resolveActiveRecipients?(
    clinicId: string,
    primaryClinicianId: string | null,
    ordererId: string,
  ): Promise<{ active: string[]; reassignedToAdmin: string | null }>;
  /**
   * BUG-578 — second-tier escalation recipients for unacknowledged
   * critical pathology results that have crossed the 2-hour breach
   * boundary. Pulls active team-leads from `patient_team_assignments`
   * (rows where `is_active = true`) plus the clinic's nominated admin.
   * Deduped against tier-1 recipients before emission. Excludes
   * inactive staff per BUG-577.
   */
  listEscalationRecipients?(
    clinicId: string,
    patientId: string,
  ): Promise<string[]>;
  /**
   * BUG-585-FOLLOWUP-MULTI-TIER-CASCADE — tiered escalation recipient
   * resolver. Tier meanings:
   *   - 2: treating-team escalation (team-leads + clinic admin)
   *   - 3: clinical-governance escalation (manager/admin + clinic admin)
   *   - 4: regulatory escalation (superadmin + clinic admin)
   */
  listEscalationRecipientsByTier?(
    clinicId: string,
    patientId: string,
    tier: PathologyEscalationTier,
  ): Promise<string[]>;
  /**
   * BUG-577 cycle-2 absorb (L4 #3 — AHPRA Standard 1 immutable trail).
   * Writes a metadata-only audit_log row using `writeAuditLog()` from
   * `apps/api/src/utils/audit.ts` (never-throws contract via
   * audit-outbox). Pino WARN/ERROR logs are rotated and not durable
   * enough for AHPRA / coronial review of clinical-safety routing
   * fallbacks; audit_log is the immutable trail.
   *
   * Used for `CRITICAL_RECIPIENT_REASSIGNED` (both originals inactive
   * → admin) AND `CRITICAL_NO_RECIPIENT_AVAILABLE` (silent-drop
   * scenario — both inactive AND no admin configured).
   */
  writeAuditLogRow?(input: {
    clinicId: string;
    action: 'CRITICAL_RECIPIENT_REASSIGNED' | 'CRITICAL_NO_RECIPIENT_AVAILABLE';
    resultId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  /**
   * Structured logger. Accepts the pino Logger as well as test-side
   * mocks that match its method shape. Bivariant params keep both
   * `logger.info('msg')` and `logger.error({err, x}, 'msg')` callers
   * happy without imposing pino's `LogFn` directly.
   */
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

export interface PathologyAlertOutcome {
  processed: number;
  emitted: number;
  errors: number;
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * BUG-372a — critical-row criteria. Mirrors HL7 worker mapping in
 * `apps/api/src/jobs/workers/hl7Worker.ts` (HH→critical_high,
 * LL→critical_low, A→abnormal). Only HH/LL/is_critical fire alerts;
 * plain abnormal-but-not-critical does not.
 */
export function isCriticalRow(row: { is_critical: boolean | null; abnormal_flag: string }): boolean {
  return row.is_critical === true
    || row.abnormal_flag === 'critical_high'
    || row.abnormal_flag === 'critical_low';
}

/**
 * BUG-372a — dedupe-key shape for the partial unique index on
 * `(clinic_id, payload->>'dedupe_key')`. UTC-day bucket so an
 * unacknowledged result fires once per day per recipient (NOT every
 * 15 minutes).
 *
 * UTC-day boundary is at 10:00 AEST (11:00 AEDT during summer time)
 * — the daily re-fire of an unacknowledged critical result lands
 * mid-morning local, not at local midnight. This is acceptable because
 * the partial unique index dedupes at INSERT: the 09:55 AEST row
 * carries `fired-day:<yesterday-utc>` and the 10:10 AEST row carries
 * `fired-day:<today-utc>` — two distinct legitimate emits across the
 * day boundary, NOT a double-fire. See BUG-372a L4 RR-4.
 */
export function dedupeKeyForPathologyAlert(resultId: string, staffId: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return `pathology-critical:${resultId}:${staffId}:fired-day:${day}`;
}

/**
 * BUG-578 — escalation-tier dedupe key (T+2h breach). Distinct namespace
 * (`pathology-critical-escalation:`) from tier-1 (`pathology-critical:`)
 * so each tier dedupes independently per UTC day. Tier-1 fires once
 * per recipient per day (existing behaviour); tier-2 fires once per
 * escalation recipient per day starting at T+2h.
 */
export function dedupeKeyForPathologyEscalation(
  resultId: string,
  staffId: string,
  now: Date,
): string {
  return dedupeKeyForPathologyEscalationTier(resultId, staffId, 2, now);
}

function escalationNamespaceForTier(tier: PathologyEscalationTier): string {
  if (tier === 2) return 'pathology-critical-escalation';
  if (tier === 3) return 'pathology-critical-governance-escalation';
  return 'pathology-critical-regulatory-escalation';
}

export function dedupeKeyForPathologyEscalationTier(
  resultId: string,
  staffId: string,
  tier: PathologyEscalationTier,
  now: Date,
): string {
  const day = now.toISOString().slice(0, 10);
  const namespace = escalationNamespaceForTier(tier);
  return `${namespace}:${resultId}:${staffId}:fired-day:${day}`;
}

/**
 * BUG-578 — escalation due predicate. Returns true when
 * `now - createdAt >= thresholdMinutes`. Per-clinic configurable per
 * `pathology_escalation_minutes` (default 120 from `DEFAULT_THRESHOLDS`).
 * RACGP critical-results notification + AHPRA Standard 1 tiered
 * escalation chain. Pure helper for testability of the boundary case.
 *
 * BUG-578 cycle-2 absorb (L4 #4 + L3 #3): replaces hardcoded 2h with
 * per-clinic configurable threshold mirroring the existing
 * `pathology_critical_minutes` precedent.
 */
export function isEscalationDue(
  createdAt: Date | string,
  now: Date,
  thresholdMinutes: number,
): boolean {
  const ageMs = now.getTime() - new Date(createdAt as string | Date).getTime();
  return ageMs >= thresholdMinutes * 60 * 1000;
}

function escalationTitlePrefixForTier(tier: PathologyEscalationTier): string {
  if (tier === 2) return '[ESCALATION]';
  if (tier === 3) return '[CRITICAL ESCALATION]';
  return '[REGULATORY]';
}

function escalationBodyForTier(
  tier: PathologyEscalationTier,
  abnormalFlag: string,
  escalationLabel: string,
): string {
  if (tier === 2) {
    return `Critical ${abnormalFlag} pathology result has been unacknowledged for ${escalationLabel}. Tier-2 escalation — verify the primary clinician was reached AND the result has been clinically actioned.`;
  }
  if (tier === 3) {
    return `Critical ${abnormalFlag} pathology result has been unacknowledged for ${escalationLabel}. Tier-3 clinical-governance escalation — confirm service-lead intervention and documented mitigation plan.`;
  }
  return `Critical ${abnormalFlag} pathology result has been unacknowledged for ${escalationLabel}. Tier-4 regulatory escalation — trigger executive/compliance incident workflow and record external-reportability decision.`;
}

// ── Top-level processor (testable; cron tick wraps this) ───────────────────

/**
 * Process unacknowledged critical pathology results.
 *
 * Failure isolation per CLAUDE.md §3.2 / §9.6 / `feedback_no_silent_out_of_scope.md`:
 *   - Top-level try/catch — top-level failure logged, processor returns
 *     zeroed counts (cron itself never dies).
 *   - Per-row try/catch — single row failure logged with `{err, resultId}`,
 *     subsequent rows continue.
 */
export async function processPathologyCriticalAlerts(
  now: Date,
  ctx: PathologyAlertContext,
): Promise<PathologyAlertOutcome> {
  const out: PathologyAlertOutcome = { processed: 0, emitted: 0, errors: 0 };
  let rows: PathologyAlertRow[] = [];
  try {
    // BUG-372a absorb-1 — query with a conservative 5-minute floor; per-row
    // filter below applies the per-clinic threshold via `ctx.getThreshold`.
    // Single-query optimisation preserved; per-clinic configurability is
    // honoured through in-memory filtering (no N+1 queries).
    rows = await ctx.listUnacknowledgedCritical(5, now);
  } catch (err) {
    ctx.logger.error({ err }, 'pathologyCriticalScheduler top-level listUnacknowledgedCritical failed');
    return out;
  }

  // BUG-372a L5 absorb-1 F3 — distinguish "no critical results pending"
  // from "RLS or other access path returned zero rows" in observability.
  // A clinical-incident review (clinician didn't get the alert) needs
  // this signal to triage. Emit at WARN so an Azure Monitor rule on
  // sustained zero-row ticks is achievable, but not at ERROR because
  // a quiet day genuinely has no critical results.
  if (rows.length === 0) {
    ctx.logger.warn(
      { kind: 'PATHOLOGY_CRITICAL_ALERT_ZERO_ROWS', tickAt: now.toISOString() },
      'pathologyCriticalScheduler returned zero rows (either no pending criticals or access-path failure)',
    );
  }

  // Cache per-clinic thresholds for this tick — same clinic seen
  // repeatedly hits cache after first `getThreshold` lookup.
  const thresholdCache = new Map<string, number>();
  // BUG-578 cycle-2 absorb — per-clinic escalation threshold cache.
  // Same pattern as `thresholdCache` above; resolves
  // `pathology_escalation_minutes` once per clinic per tick.
  const escalationThresholdCache = new Map<string, number>();
  const tier3EscalationThresholdCache = new Map<string, number>();
  const tier4EscalationThresholdCache = new Map<string, number>();

  for (const row of rows) {
    out.processed++;
    if (!isCriticalRow(row)) continue;

    try {
      // Resolve per-clinic threshold (default 30 minutes via getThreshold).
      let threshold = thresholdCache.get(row.clinic_id);
      if (threshold === undefined) {
        threshold = await ctx.getThreshold(row.clinic_id);
        thresholdCache.set(row.clinic_id, threshold);
      }
      const ageMinutes =
        (now.getTime() - new Date(row.created_at as string | Date).getTime()) / 60_000;
      if (ageMinutes < threshold) continue;

      // BUG-577 — resolve recipients through the active-staff filter +
      // clinic-admin fallback. When a test/dry-run context does not
      // provide this hook yet, fall back to the original deterministic
      // recipient pair (primary clinician + orderer) so the scheduler
      // still emits alerts instead of hard-failing.
      const recipientResolution = ctx.resolveActiveRecipients
        ? await ctx.resolveActiveRecipients(
          row.clinic_id,
          row.primary_clinician_id,
          row.ordered_by_id,
        )
        : {
          active: Array.from(
            new Set(
              row.primary_clinician_id
                ? [row.primary_clinician_id, row.ordered_by_id]
                : [row.ordered_by_id],
            ),
          ),
          reassignedToAdmin: null,
        };
      const { active: tier1Recipients, reassignedToAdmin } = recipientResolution;
      if (reassignedToAdmin) {
        // BUG-577 cycle-2 absorb (L4 #3 — AHPRA Standard 1
        // immutability): pino WARN for ops + audit_log row for
        // immutable forensic trail.
        ctx.logger.warn(
          {
            kind: 'PATHOLOGY_CRITICAL_RECIPIENT_REASSIGNED_TO_ADMIN',
            resultId: row.result_id,
            primaryClinicianId: row.primary_clinician_id,
            ordererId: row.ordered_by_id,
            adminStaffId: reassignedToAdmin,
          },
          'pathologyCriticalScheduler reassigned to clinic admin (both original recipients inactive)',
        );
        if (ctx.writeAuditLogRow) {
          await ctx.writeAuditLogRow({
            clinicId: row.clinic_id,
            action: 'CRITICAL_RECIPIENT_REASSIGNED',
            resultId: row.result_id,
            metadata: {
              primary_clinician_id: row.primary_clinician_id,
              orderer_id: row.ordered_by_id,
              admin_staff_id: reassignedToAdmin,
              reason: 'both_originals_inactive',
              // BUG-577 cycle-2 absorb-2 (L4 CONCERN-1) — actorId
              // is silently NULL'd by audit.ts UUID sanitiser; the
              // system_actor literal in JSONB metadata survives so
              // AHPRA forensic queries can filter on
              // `new_data->>'system_actor'`.
              system_actor: 'pathology-critical-scheduler',
            },
          });
        }
      } else if (tier1Recipients.length === 0) {
        // BUG-577 cycle-2 absorb (L4 #2 — silent-drop closure): both
        // originals inactive AND no clinic admin configured. ERROR-
        // level pino + audit_log row so the worst-case scenario
        // (critical pathology result with NO recipient) is observable
        // to ops AND has an immutable AHPRA-grade trail.
        ctx.logger.error(
          {
            kind: 'PATHOLOGY_CRITICAL_NO_RECIPIENT_AVAILABLE',
            resultId: row.result_id,
            primaryClinicianId: row.primary_clinician_id,
            ordererId: row.ordered_by_id,
          },
          'pathologyCriticalScheduler dropped alert — both recipients inactive AND no clinic admin configured',
        );
        if (ctx.writeAuditLogRow) {
          await ctx.writeAuditLogRow({
            clinicId: row.clinic_id,
            action: 'CRITICAL_NO_RECIPIENT_AVAILABLE',
            resultId: row.result_id,
            metadata: {
              primary_clinician_id: row.primary_clinician_id,
              orderer_id: row.ordered_by_id,
              reason: 'no_admin_configured',
              // BUG-577 cycle-2 absorb-2 (L4 CONCERN-1) — see above.
              system_actor: 'pathology-critical-scheduler',
            },
          });
        }
      }

      // Tier-1 emit — primary + orderer (or admin fallback).
      for (const staffId of tier1Recipients) {
        await ctx.emit({
          clinicId: row.clinic_id,
          userId: staffId,
          severity: 'critical',
          category: 'pathology',
          title: `Critical pathology — ${row.test_name}`,
          body: `Unacknowledged ${row.abnormal_flag} pathology result. Review required.`,
          actionUrl: `/patients/${row.patient_id}/pathology/${row.result_id}`,
          payload: {
            result_id: row.result_id,
            patient_id: row.patient_id,
            abnormal_flag: row.abnormal_flag,
            is_critical: row.is_critical,
            result_date: row.result_date,
            tier: 1,
          },
          dedupeKey: dedupeKeyForPathologyAlert(row.result_id, staffId, now),
        });
        out.emitted++;
      }

      // BUG-585-FOLLOWUP-MULTI-TIER-CASCADE — tiered escalation chain:
      // tier-2 (treating team), tier-3 (clinical governance), tier-4
      // (regulatory). Each tier has its own dedupe namespace and
      // threshold. Recipients dedupe against all lower tiers.
      if (ctx.getEscalationThreshold) {
        let escalationThreshold = escalationThresholdCache.get(row.clinic_id);
        if (escalationThreshold === undefined) {
          escalationThreshold = await ctx.getEscalationThreshold(row.clinic_id);
          escalationThresholdCache.set(row.clinic_id, escalationThreshold);
        }
        let tier3EscalationThreshold = tier3EscalationThresholdCache.get(row.clinic_id);
        if (tier3EscalationThreshold === undefined) {
          tier3EscalationThreshold = ctx.getEscalationThresholdByTier
            ? await ctx.getEscalationThresholdByTier(row.clinic_id, 3)
            : Math.max(escalationThreshold * 2, 240);
          tier3EscalationThresholdCache.set(row.clinic_id, tier3EscalationThreshold);
        }
        let tier4EscalationThreshold = tier4EscalationThresholdCache.get(row.clinic_id);
        if (tier4EscalationThreshold === undefined) {
          tier4EscalationThreshold = ctx.getEscalationThresholdByTier
            ? await ctx.getEscalationThresholdByTier(row.clinic_id, 4)
            : Math.max(escalationThreshold * 4, 480);
          tier4EscalationThresholdCache.set(row.clinic_id, tier4EscalationThreshold);
        }

        const tiers: ReadonlyArray<{ tier: PathologyEscalationTier; threshold: number }> = [
          { tier: 2, threshold: escalationThreshold },
          { tier: 3, threshold: tier3EscalationThreshold },
          { tier: 4, threshold: tier4EscalationThreshold },
        ];
        const alreadyNotified = new Set(tier1Recipients);

        for (const tierConfig of tiers) {
          if (!isEscalationDue(row.created_at, now, tierConfig.threshold)) continue;
          let escalationStaff: string[] = [];
          if (ctx.listEscalationRecipientsByTier) {
            escalationStaff = await ctx.listEscalationRecipientsByTier(
              row.clinic_id,
              row.patient_id,
              tierConfig.tier,
            );
          } else if (ctx.listEscalationRecipients) {
            escalationStaff = await ctx.listEscalationRecipients(
              row.clinic_id,
              row.patient_id,
            );
          }
          const escalationThreshold = tierConfig.threshold;
          const escalationLabel =
            escalationThreshold % 60 === 0
              ? `${escalationThreshold / 60}h+`
              : `${escalationThreshold}min+`;
          for (const staffId of escalationStaff) {
            if (alreadyNotified.has(staffId)) continue;
            const title =
              tierConfig.tier === 2
                ? `[ESCALATION] Critical pathology unacknowledged ${escalationLabel} — ${row.test_name}`
                : `${escalationTitlePrefixForTier(tierConfig.tier)} Critical pathology unacknowledged ${escalationLabel} — ${row.test_name}`;
            const body =
              tierConfig.tier === 2
                ? `Critical ${row.abnormal_flag} pathology result has been unacknowledged for ${escalationLabel}. Tier-2 escalation — verify the primary clinician was reached AND the result has been clinically actioned.`
                : escalationBodyForTier(tierConfig.tier, row.abnormal_flag, escalationLabel);
            await ctx.emit({
              clinicId: row.clinic_id,
              userId: staffId,
              severity: 'critical',
              category: 'pathology',
              title,
              body,
              actionUrl: `/patients/${row.patient_id}/pathology/${row.result_id}`,
              payload: {
                result_id: row.result_id,
                patient_id: row.patient_id,
                abnormal_flag: row.abnormal_flag,
                is_critical: row.is_critical,
                result_date: row.result_date,
                tier: tierConfig.tier,
              },
              dedupeKey: dedupeKeyForPathologyEscalationTier(
                row.result_id,
                staffId,
                tierConfig.tier,
                now,
              ),
            });
            alreadyNotified.add(staffId);
            out.emitted++;
          }
        }
      }
    } catch (err) {
      out.errors++;
      ctx.logger.error({ err, resultId: row.result_id }, 'pathologyCriticalScheduler row failed');
    }
  }

  return out;
}

// ── Live-context construction (used by the cron tick) ──────────────────────

/**
 * Construct the live `PathologyAlertContext` used by the cron tick. Exported
 * so integration tests can invoke `processPathologyCriticalAlerts(now,
 * await buildLiveContext())` against a real Postgres + spy on the
 * scheduler signal adapter. Without the export the only way to test the
 * production code path was to re-implement the SQL inline (parallel-SQL
 * anti-pattern that L4 BLOCKed on cycle-1 of BUG-451 batch 1).
 */
export async function buildLiveContext(): Promise<PathologyAlertContext> {
  return {
    async listUnacknowledgedCritical(thresholdMinutes: number, now: Date): Promise<PathologyAlertRow[]> {
      const cutoff = new Date(now.getTime() - thresholdMinutes * 60 * 1000);
      // SCHEDULER ONLY — uses `dbAdmin` (signacare_owner role) so RLS
      // does not silent-zero the result. See file header for rationale.
      // Per-row `clinic_id` is FK-bound and propagated on every emit,
      // preserving tenant isolation at the notification boundary.
      // BUG-372a L5 absorb-1 F1 (RLS-CLOSED silent-zero closed) +
      // BUG-372a absorb-1 F2 (`whereNull` on JOIN tables' deleted_at
      // per CLAUDE.md §1.4 — pathology_orders carries deleted_at).
      //
      // BUG-579 — for episodes we use the BUG-590 sibling pattern:
      // JOIN active original episode when present, then LATERAL fallback
      // to current open episode for transferred/discharged paths where
      // pathology_order.episode_id points at a soft-deleted episode.
      const rows = await dbAdmin('pathology_results as pr')
        .leftJoin('pathology_orders as po', 'po.id', 'pr.pathology_order_id')
        .leftJoin('episodes as ep', function () {
          this.on('ep.id', '=', 'po.episode_id')
            .andOn('ep.clinic_id', '=', 'po.clinic_id')
            .andOnNull('ep.deleted_at');
        })
        .joinRaw(`
          LEFT JOIN LATERAL (
            SELECT cur_ep.primary_clinician_id
            FROM episodes AS cur_ep
            WHERE cur_ep.patient_id = po.patient_id
              AND cur_ep.clinic_id = po.clinic_id
              AND cur_ep.status = 'open'
              AND cur_ep.deleted_at IS NULL
            ORDER BY cur_ep.start_date DESC
            LIMIT 1
          ) AS cur_ep ON TRUE
        `)
        .whereNull('pr.critical_acknowledged_at')
        .whereNull('po.deleted_at')
        .where(function () {
          this.where('pr.is_critical', true).orWhereIn('pr.abnormal_flag', ['critical_high', 'critical_low']);
        })
        .where('pr.created_at', '<=', cutoff)
        .select(
          'pr.id as result_id',
          'pr.clinic_id',
          'pr.patient_id',
          'pr.test_name',
          'pr.abnormal_flag',
          'pr.is_critical',
          'pr.result_date',
          'pr.created_at',
          dbAdmin.raw(
            'COALESCE(ep.primary_clinician_id, cur_ep.primary_clinician_id) as primary_clinician_id',
          ),
          'po.ordered_by_id',
        );
      return rows as PathologyAlertRow[];
    },

    async emit(input) {
      return emitSchedulerSignal({
        clinicId: input.clinicId,
        userId: input.userId,
        severity: input.severity,
        category: input.category,
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl,
        payload: input.payload,
        dedupeKey: input.dedupeKey,
        signalKey: 'pathology_critical_result',
      });
    },

    async getThreshold(clinicId: string): Promise<number> {
      // SSoT: `DEFAULT_THRESHOLDS.pathology_critical_minutes` in
      // settingsService.ts is the canonical default; per-clinic overrides
      // layer on top via getThresholds. No hardcoded fallback here per
      // L5 absorb-1 F4 (eliminate second source of truth).
      // BUG-592-FOLLOWUP-DBADMIN-THRESHOLDS — pass `dbAdmin` so the
      // RLS-bound `clinic_thresholds` lookup does not silent-zero in
      // cron context (no `app.clinic_id` GUC outside Express).
      const t = await settingsService.getThresholds(clinicId, dbAdmin);
      return Number(t['pathology_critical_minutes']);
    },

    async getEscalationThreshold(clinicId: string): Promise<number> {
      const t = await settingsService.getThresholds(clinicId, dbAdmin);
      return Number(t['pathology_escalation_minutes']);
    },

    async getEscalationThresholdByTier(clinicId, tier) {
      // BUG-578 cycle-2 absorb — SSoT for tier-2 escalation threshold
      // is `DEFAULT_THRESHOLDS.pathology_escalation_minutes` (default
      // 120) in settingsService.ts. Per-clinic override via
      // `clinic_thresholds` row. Mirrors the `getThreshold` shape
      // exactly so a future BaseScheduler abstraction (BUG-582) can
      // unify both lookups.
      // BUG-592-FOLLOWUP-DBADMIN-THRESHOLDS — pass `dbAdmin` per the
      // RLS-zero closure pattern (sibling note in `getThreshold` above).
      const t = await settingsService.getThresholds(clinicId, dbAdmin);
      if (tier === 2) return Number(t['pathology_escalation_minutes']);
      if (tier === 3) return Number(t['pathology_escalation_tier3_minutes']);
      return Number(t['pathology_escalation_tier4_minutes']);
    },

    async resolveActiveRecipients(clinicId, primaryClinicianId, ordererId) {
      // BUG-577 follow-up — shared SSoT resolver used across scheduler
      // and HL7 ingest pathways. Scheduler keeps audit responsibility in
      // processPathologyCriticalAlerts via `writeAuditLogRow`, so this
      // resolver call does NOT write audit rows directly.
      const resolution = await resolveStaffRecipientsWithAdminFallback({
        clinicId,
        candidateStaffIds: primaryClinicianId ? [primaryClinicianId, ordererId] : [ordererId],
        conn: dbAdmin,
        onNoAdmin: 'none',
      });
      return {
        active: resolution.active,
        reassignedToAdmin: resolution.reassignedToAdmin,
      };
    },

    async listEscalationRecipients(clinicId, patientId) {
      const teamLeads = await dbAdmin('patient_team_assignments as pta')
        .innerJoin('staff as s', 's.id', 'pta.primary_clinician_id')
        .where('pta.patient_id', patientId)
        .where('pta.is_active', true)
        .where('s.clinic_id', clinicId)
        .where('s.is_active', true)
        .whereNull('s.deleted_at')
        .select('pta.primary_clinician_id as staff_id');
      const ids = new Set<string>();
      for (const r of teamLeads) {
        if (r.staff_id) ids.add(String(r.staff_id));
      }
      const clinic = await dbAdmin('clinics')
        .where({ id: clinicId })
        .whereNull('deleted_at')
        .select('nominated_admin_staff_id', 'delegated_admin_staff_id')
        .first();
      if (clinic?.nominated_admin_staff_id) {
        ids.add(String(clinic.nominated_admin_staff_id));
      } else if (clinic?.delegated_admin_staff_id) {
        ids.add(String(clinic.delegated_admin_staff_id));
      }
      return Array.from(ids);
    },

    async listEscalationRecipientsByTier(clinicId, patientId, tier) {
      // BUG-578 — tier-2 escalation: active team-leads from
      // patient_team_assignments + clinic admin. Filter on
      // staff.is_active per BUG-577 so escalation does not also
      // route to deactivated users.
      const ids = new Set<string>();
      if (tier === 2) {
        const teamLeads = await dbAdmin('patient_team_assignments as pta')
          .innerJoin('staff as s', 's.id', 'pta.primary_clinician_id')
          .where('pta.patient_id', patientId)
          .where('pta.is_active', true)
          .where('s.clinic_id', clinicId)
          .where('s.is_active', true)
          .whereNull('s.deleted_at')
          .select('pta.primary_clinician_id as staff_id');
        for (const r of teamLeads) {
          if (r.staff_id) ids.add(String(r.staff_id));
        }
      } else if (tier === 3) {
        const governance = await dbAdmin('staff')
          .where({ clinic_id: clinicId, is_active: true })
          .whereNull('deleted_at')
          .whereIn('role', ['manager', 'admin'])
          .select('id');
        for (const r of governance) {
          if (r.id) ids.add(String(r.id));
        }
      } else {
        const regulatory = await dbAdmin('staff')
          .where({ clinic_id: clinicId, is_active: true })
          .whereNull('deleted_at')
          .where('role', 'superadmin')
          .select('id');
        for (const r of regulatory) {
          if (r.id) ids.add(String(r.id));
        }
      }
      const clinic = await dbAdmin('clinics')
        .where({ id: clinicId })
        .whereNull('deleted_at')
        .select('nominated_admin_staff_id', 'delegated_admin_staff_id')
        .first();
      if (clinic?.nominated_admin_staff_id) {
        ids.add(String(clinic.nominated_admin_staff_id));
      } else if (clinic?.delegated_admin_staff_id) {
        ids.add(String(clinic.delegated_admin_staff_id));
      }
      return Array.from(ids);
    },

    async writeAuditLogRow({ clinicId, action, resultId, metadata }) {
      // BUG-577 cycle-2 absorb — AHPRA Standard 1 immutable trail.
      // Uses `writeAuditLog` from utils/audit.ts (never-throws via
      // audit-outbox; pino ERROR on DB-down which is the floor for
      // observability). Caller passes `metadata` already containing
      // `system_actor` (call-site responsibility — testable at the
      // call site, not at the helper).
      //
      // The `actorId: 'system:pathology-critical-scheduler'` literal
      // is provided to writeAuditLog for log-line clarity, but
      // audit.ts UUID-sanitises it to NULL at persistence; the
      // distinguishing forensic axis is `metadata.system_actor` in
      // JSONB.
      await writeAuditLog({
        clinicId,
        actorId: 'system:pathology-critical-scheduler',
        action,
        tableName: 'pathology_results',
        recordId: resultId,
        newData: metadata,
      });
    },

    logger: defaultLogger,
  };
}

// ── Cron tick ──────────────────────────────────────────────────────────────

const pathologyCriticalTask = runScheduledTick<PathologyAlertOutcome>({
  schedulerName: 'pathology-critical',
  cronExpression: '*/15 * * * *',
  dbAccess: 'dbAdmin',
  startMessage: 'Running pathology critical-result scheduler',
  successMessage: 'Pathology critical-result scheduler tick complete',
  errorMessage: 'Pathology critical-result scheduler failed',
  logger: defaultLogger,
  tick: async (now) => {
    const ctx = await buildLiveContext();
    return processPathologyCriticalAlerts(now, ctx);
  },
  successMeta: (result) => ({
    processed: result.processed,
    emitted: result.emitted,
    errors: result.errors,
  }),
});

export { pathologyCriticalTask };
