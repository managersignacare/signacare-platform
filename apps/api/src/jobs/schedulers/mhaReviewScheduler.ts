// apps/api/src/jobs/schedulers/mhaReviewScheduler.ts
//
// BUG-372b — MHA review-window alert.
//
// Mental Health Act orders carry statutory review windows: 72-hour
// assessment-order review, 28-day temporary-treatment-order review,
// community-treatment-order variable. AHPRA Standard 1 + the relevant
// state Mental Health Act require a lawful review before the deadline
// — order lapsing without one is statutory non-compliance.
//
// Every hour (AEST) this scheduler scans `legal_orders` (canonical) +
// `patient_legal_orders` (legacy; both tables alive in production)
// for active orders whose `review_date` falls into reminder buckets:
//   T-7d   warning  (early reminder)
//   T-3d   warning  (mid reminder)
//   T-1d   critical (final reminder)
//   T-0d   critical (review due TODAY)
//   T-12h  critical (narrow-window orders, <=12h remaining)
//   T-4h   critical (narrow-window orders, <=4h remaining)
//   T+overdue critical (already lapsed)
//
// Idempotency: dedupeKey `mha-review:<table>:<orderId>:<staffId>:<bucket>`
// — fires once per bucket per recipient. The hourly cron + bucket
// quantisation means the partial unique index on
// `(clinic_id, payload->>'dedupe_key')` rejects duplicates within the
// 24-hour window.
//
// SCHEDULER ONLY — uses `dbAdmin` (signacare_owner; RLS-bypass-by-
// ownership) per BUG-583. Tenant scoping preserved via FK-bound
// `clinic_id` on every emit.
//
// fix-registry anchors: BUG372B-SCHED-EXISTS, BUG372B-DUAL-TABLE,
// BUG372B-BUCKETS, BUG372B-LEGAL-FEATURE, BUG372B-BOOTSTRAP,
// BUG372B-DBADMIN, BUG372B-ZERO-ROW-WARN, BUG372-NO-SWALLOW.

import cron from 'node-cron';
import { dbAdmin } from '../../db/db';
import { logger as defaultLogger } from '../../utils/logger';
import { registerShutdownHook } from '../../shared/gracefulShutdown';
import {
  legalOrderRepository,
  type LegalOrderMissingReviewDateRow,
} from '../../features/legal/legalOrderRepository';
import { settingsService } from '../../features/settings/settingsService';
import { writeAuditLog } from '../../utils/audit';
import { emitSchedulerSignal } from './schedulerSignalEmitter';

// ── Types ──────────────────────────────────────────────────────────────────

export type MhaReviewBucket = 'T-7d' | 'T-3d' | 'T-1d' | 'T-0d' | 'T-12h' | 'T-4h' | 'T+overdue';
export type MhaEscalationTier = 2 | 3 | 4;

/**
 * @schema-drift-exempt select-aliased
 * BUG-372b — `MhaReviewRow` is a UNION across two source tables
 * (`legal_orders` and `patient_legal_orders`). The `source_table`
 * tag distinguishes them. `creator_staff_id` aliases
 * `legal_orders.created_by_staff_id` and `patient_legal_orders.entered_by_id`.
 * `order_type_max_duration_days` comes from `legal_order_types.max_duration_days`
 * (LEFT JOIN for legacy rows where order_type_id is a soft pointer).
 * `primary_clinician_id` is sourced from the `episodes` LEFT JOIN
 * via `legal_orders.episode_id`; for `patient_legal_orders` (which
 * has no episode_id) it's resolved separately via the patient's most
 * recent active episode. Per CLAUDE.md §15.
 */
export interface MhaReviewRow {
  source_table: 'legal_orders' | 'patient_legal_orders';
  order_id: string;
  clinic_id: string;
  patient_id: string;
  order_number: string;
  review_date: string;
  status: string;
  order_type_max_duration_days: number | null;
  primary_clinician_id: string | null;
  creator_staff_id: string | null;
}

export interface MhaMissingReviewDateRow extends LegalOrderMissingReviewDateRow {}

export interface MhaReviewEmitInput {
  clinicId: string;
  userId: string;
  severity: 'warning' | 'critical';
  category: 'mha-review';
  title: string;
  body: string;
  actionUrl: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  // BUG-588 — data-quality notifications use bell-only delivery so a
  // deduped daily alert does not keep republishing hourly SSE/FCM.
  channels?: Array<'sse' | 'bell' | 'fcm' | 'email'>;
}

export interface MhaReviewContext {
  listOrdersInReviewWindow(now: Date): Promise<MhaReviewRow[]>;
  /**
   * BUG-588 — active legal-order rows with `review_date IS NULL`.
   * These rows never enter `listOrdersInReviewWindow` and need a
   * dedicated data-quality surface.
   */
  listActiveOrdersMissingReviewDate?(now: Date): Promise<MhaMissingReviewDateRow[]>;
  /**
   * BUG-588 — clinic-admin recipient resolution for data-quality alerts.
   * Prefer nominated admin, then delegated admin, while enforcing
   * active + non-deleted staff state.
   */
  resolveClinicAdminRecipient?(clinicId: string): Promise<string | null>;
  emit(input: MhaReviewEmitInput): Promise<{ ids: string[]; published: boolean }>;
  /**
   * BUG-584 (sibling of BUG-577) — filter `staff.is_active = true AND
   * deleted_at IS NULL` over [primary_clinician_id, creator_staff_id].
   * When BOTH inactive, fall back to `clinics.nominated_admin_staff_id
   * ?? delegated_admin_staff_id`. Returns `{active, reassignedToAdmin}`
   * with primary-first ordering preserved.
   */
  resolveActiveRecipients?(
    clinicId: string,
    primaryClinicianId: string | null,
    creatorStaffId: string | null,
  ): Promise<{ active: string[]; reassignedToAdmin: string | null }>;
  /**
   * BUG-585 (sibling of BUG-578) — tier-2 escalation recipients for
   * unacknowledged critical MHA review alerts. Active team-leads from
   * `patient_team_assignments` + clinic admin, all filtered through
   * BUG-584 active-staff predicates.
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
    tier: MhaEscalationTier,
  ): Promise<string[]>;
  /**
   * BUG-585 — per-clinic tier-2 escalation threshold (default 60
   * minutes from `DEFAULT_THRESHOLDS.mha_review_escalation_minutes`,
   * tighter than pathology's 120 per statutory-review urgency).
   */
  getEscalationThreshold?(clinicId: string): Promise<number>;
  /**
   * BUG-585-FOLLOWUP-MULTI-TIER-CASCADE — tier-specific escalation
   * thresholds in minutes.
   */
  getEscalationThresholdByTier?(
    clinicId: string,
    tier: MhaEscalationTier,
  ): Promise<number>;
  /**
   * BUG-584 — AHPRA Standard 1 immutable trail. Writes a metadata-only
   * audit_log row (never-throws via audit-outbox) for routing-fallback
   * events. Sibling of pathologyCriticalScheduler.writeAuditLogRow.
   */
  writeAuditLogRow?(input: {
    clinicId: string;
    action: 'MHA_REVIEW_RECIPIENT_REASSIGNED' | 'MHA_REVIEW_NO_RECIPIENT_AVAILABLE';
    sourceTable: 'legal_orders' | 'patient_legal_orders';
    orderId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

export interface MhaReviewOutcome {
  processed: number;
  emitted: number;
  errors: number;
}

// ── Pure helpers ───────────────────────────────────────────────────────────

function isNarrowWindowOrder(maxDurationDays: number | null | undefined): boolean {
  return typeof maxDurationDays === 'number' && maxDurationDays > 0 && maxDurationDays <= 7;
}

/**
 * BUG-372b / BUG-587 — bucket quantisation. Returns the canonical
 * bucket label for a `review_date` (YYYY-MM-DD) relative to `now`, or
 * null if outside any tier.
 *
 * Base tiers are day-based. BUG-587 adds sub-day tiers (`T-12h`,
 * `T-4h`) for narrow-window statutory orders where
 * `max_duration_days <= 7`.
 */
export function bucketForReviewDate(
  reviewDate: string,
  now: Date,
  maxDurationDays?: number | null,
): MhaReviewBucket | null {
  const review = new Date(`${reviewDate}T00:00:00.000Z`);
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const diffDays = Math.round((review.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

  if (isNarrowWindowOrder(maxDurationDays) && diffDays === 0) {
    const reviewEndOfDayUtc = new Date(`${reviewDate}T23:59:59.999Z`);
    const hoursUntilDue = (reviewEndOfDayUtc.getTime() - now.getTime()) / (60 * 60 * 1000);
    if (hoursUntilDue >= 0 && hoursUntilDue <= 4) return 'T-4h';
    if (hoursUntilDue > 4 && hoursUntilDue <= 12) return 'T-12h';
  }

  if (diffDays === 7) return 'T-7d';
  if (diffDays === 3) return 'T-3d';
  if (diffDays === 1) return 'T-1d';
  if (diffDays === 0) return 'T-0d';
  if (diffDays < 0) return 'T+overdue';
  return null;
}

/**
 * BUG-372b — dedupe-key shape for the partial unique index. Encodes
 * (source_table, order_id, recipient_staff_id, bucket) so each tier
 * fires once per recipient across the bucket's natural lifetime.
 */
export function dedupeKeyForMhaReview(
  sourceTable: 'legal_orders' | 'patient_legal_orders',
  orderId: string,
  staffId: string,
  bucket: MhaReviewBucket,
): string {
  return `mha-review:${sourceTable}:${orderId}:${staffId}:${bucket}`;
}

/**
 * BUG-588 — dedupe key for missing-review-date data-quality alerts.
 * One notification per (table, order, admin, UTC day).
 */
export function dedupeKeyForMhaMissingReviewDate(
  sourceTable: 'legal_orders' | 'patient_legal_orders',
  orderId: string,
  staffId: string,
  now: Date,
): string {
  const day = now.toISOString().slice(0, 10);
  return `mha-review-missing-review-date:${sourceTable}:${orderId}:${staffId}:fired-day:${day}`;
}

function severityForBucket(bucket: MhaReviewBucket): 'warning' | 'critical' {
  return bucket === 'T-7d' || bucket === 'T-3d' ? 'warning' : 'critical';
}

/**
 * BUG-585 — escalation-tier dedupe key. Distinct namespace
 * (`mha-review-escalation:`) from tier-1 (`mha-review:`) so each tier
 * dedupes independently.
 *
 * BUG-585 cycle-2 absorb-2 (L5 advisory — sibling-pattern divergence
 * with pathology): includes a `:fired-day:<UTC-date>` component so
 * tier-2 re-fires DAILY for unacknowledged perpetually-overdue MHA
 * orders (canonical scenario: T+overdue bucket, statutory deadline
 * already passed, recipient still hasn't actioned). Pre-cycle-2-absorb-2
 * the dedupe key omitted the day component, which meant tier-2 fired
 * exactly ONCE per (order, staff, bucket) and was permanently silent
 * thereafter — clinically worse than pathology (which re-fires daily).
 * Sibling-perfect with `dedupeKeyForPathologyEscalation`.
 */
export function dedupeKeyForMhaEscalation(
  sourceTable: 'legal_orders' | 'patient_legal_orders',
  orderId: string,
  staffId: string,
  bucket: MhaReviewBucket,
  now: Date,
): string {
  return dedupeKeyForMhaEscalationTier(sourceTable, orderId, staffId, bucket, 2, now);
}

function escalationNamespaceForTier(tier: MhaEscalationTier): string {
  if (tier === 2) return 'mha-review-escalation';
  if (tier === 3) return 'mha-review-governance-escalation';
  return 'mha-review-regulatory-escalation';
}

export function dedupeKeyForMhaEscalationTier(
  sourceTable: 'legal_orders' | 'patient_legal_orders',
  orderId: string,
  staffId: string,
  bucket: MhaReviewBucket,
  tier: MhaEscalationTier,
  now: Date,
): string {
  const day = now.toISOString().slice(0, 10);
  const namespace = escalationNamespaceForTier(tier);
  return `${namespace}:${sourceTable}:${orderId}:${staffId}:${bucket}:fired-day:${day}`;
}

/**
 * BUG-585 — tier-2 escalation due predicate. Returns true when the
 * cron tick is at least `thresholdMinutes` past AEST midnight (the
 * cron's own timezone — `Australia/Melbourne` per the cron config
 * below). Hourly cron + per-bucket dedupe keep tier-2 idempotent —
 * fires at most once per AEST day per recipient per bucket.
 *
 * Per-clinic configurable via `mha_review_escalation_minutes` (default
 * 60). Tighter than pathology default (120) per BUG-585 clinical-
 * safety rationale (statutory-review missed-deadline > pathology
 * missed-acknowledgement harm class).
 *
 * BUG-585 cycle-2 absorb (L3 #2) — pre-fix used UTC-midnight which
 * produced a 14-hour skew under AEST timezone (cron tick at 00:00
 * AEST = 14:00 UTC the prior day, so `now - UTC_midnight` was always
 * >= threshold from the very FIRST cron tick — tier-1 + tier-2
 * collapsed onto the same tick, defeating staged escalation). The
 * Intl.DateTimeFormat-based AEST-anchored predicate fires tier-2
 * exactly `thresholdMinutes` after AEST midnight as intended.
 */
export function isMhaEscalationDue(now: Date, thresholdMinutes: number): boolean {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Australia/Melbourne',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const minutesIntoAestDay = hour * 60 + minute;
  return minutesIntoAestDay >= thresholdMinutes;
}

/**
 * BUG-585 / BUG-587 — only critical-severity buckets receive tier-2
 * escalation; warning buckets (T-7d / T-3d) do not because they are
 * early-reminder class.
 */
export function bucketEligibleForEscalation(bucket: MhaReviewBucket): boolean {
  return (
    bucket === 'T-1d' ||
    bucket === 'T-0d' ||
    bucket === 'T-12h' ||
    bucket === 'T-4h' ||
    bucket === 'T+overdue'
  );
}

function formatEscalationThresholdLabel(thresholdMinutes: number): string {
  return thresholdMinutes % 60 === 0
    ? `${thresholdMinutes / 60}h+`
    : `${thresholdMinutes}min+`;
}

function escalationTitlePrefixForTier(tier: MhaEscalationTier): string {
  if (tier === 2) return '[ESCALATION]';
  if (tier === 3) return '[CRITICAL ESCALATION]';
  return '[REGULATORY]';
}

function escalationBodyForTier(
  tier: MhaEscalationTier,
  orderNumber: string,
  bucket: MhaReviewBucket,
  escalationLabel: string,
): string {
  if (tier === 2) {
    return `Statutory review window for MHA order ${orderNumber} (${bucket}) has been unacknowledged for ${escalationLabel}. Tier-2 escalation — verify the primary clinician was reached AND the review has been clinically actioned.`;
  }
  if (tier === 3) {
    return `Statutory review window for MHA order ${orderNumber} (${bucket}) has been unacknowledged for ${escalationLabel}. Tier-3 clinical-governance escalation — confirm service-lead intervention and documented mitigation plan.`;
  }
  return `Statutory review window for MHA order ${orderNumber} (${bucket}) has been unacknowledged for ${escalationLabel}. Tier-4 regulatory escalation — trigger executive/compliance incident workflow and record external-reportability decision.`;
}

function titleForBucket(orderNumber: string, bucket: MhaReviewBucket): string {
  if (bucket === 'T+overdue') return `MHA order ${orderNumber} OVERDUE for review`;
  if (bucket === 'T-4h') return `MHA order ${orderNumber} review due within 4 hours`;
  if (bucket === 'T-12h') return `MHA order ${orderNumber} review due within 12 hours`;
  if (bucket === 'T-0d') return `MHA order ${orderNumber} review due TODAY`;
  if (bucket === 'T-1d') return `MHA order ${orderNumber} review due tomorrow`;
  if (bucket === 'T-3d') return `MHA order ${orderNumber} review in 3 days`;
  return `MHA order ${orderNumber} review in 7 days`;
}

/**
 * BUG-588 — emit daily clinic-admin data-quality alerts for active
 * legal orders missing `review_date`. These rows are invisible to the
 * primary reminder-window query and therefore require an explicit
 * fail-visible path.
 */
async function emitMissingReviewDateAlerts(
  now: Date,
  ctx: MhaReviewContext,
  out: MhaReviewOutcome,
): Promise<void> {
  if (!ctx.listActiveOrdersMissingReviewDate || !ctx.resolveClinicAdminRecipient) return;

  const rows = await ctx.listActiveOrdersMissingReviewDate(now);
  if (rows.length === 0) return;

  for (const row of rows) {
    const adminStaffId = await ctx.resolveClinicAdminRecipient(row.clinic_id);
    if (!adminStaffId) {
      ctx.logger.warn(
        {
          kind: 'MHA_REVIEW_MISSING_REVIEW_DATE_NO_ADMIN',
          sourceTable: row.source_table,
          orderId: row.order_id,
          clinicId: row.clinic_id,
        },
        'mhaReviewScheduler found active legal order missing review_date but no active clinic admin recipient',
      );
      continue;
    }

    const dedupeKey = dedupeKeyForMhaMissingReviewDate(
      row.source_table,
      row.order_id,
      adminStaffId,
      now,
    );
    const emitResult = await ctx.emit({
      clinicId: row.clinic_id,
      userId: adminStaffId,
      severity: 'warning',
      category: 'mha-review',
      title: `Data-quality: active MHA order ${row.order_number} missing review date`,
      body: `Order ${row.order_number} is active but has no review_date. Statutory review reminders cannot fire until review_date is populated.`,
      actionUrl: `/patients/${row.patient_id}/legal-orders/${row.order_id}`,
      payload: {
        issue_kind: 'missing_review_date',
        source_table: row.source_table,
        order_id: row.order_id,
        order_number: row.order_number,
        patient_id: row.patient_id,
      },
      dedupeKey,
      // BUG-588 — bell-only prevents hourly SSE/FCM republish storms
      // on deduped rows while preserving durable operator visibility.
      channels: ['bell'],
    });
    if (emitResult.ids.length === 0) continue;

    ctx.logger.warn(
      {
        kind: 'MHA_REVIEW_MISSING_REVIEW_DATE',
        sourceTable: row.source_table,
        orderId: row.order_id,
        clinicId: row.clinic_id,
        adminStaffId,
        dedupeKey,
      },
      'mhaReviewScheduler emitted clinic-admin data-quality alert for active legal order missing review_date',
    );
    out.emitted++;
  }
}

// ── Top-level processor (testable; cron tick wraps this) ───────────────────

export async function processMhaReviewAlerts(
  now: Date,
  ctx: MhaReviewContext,
): Promise<MhaReviewOutcome> {
  const out: MhaReviewOutcome = { processed: 0, emitted: 0, errors: 0 };
  let rows: MhaReviewRow[] = [];
  try {
    rows = await ctx.listOrdersInReviewWindow(now);
  } catch (err) {
    ctx.logger.error({ err }, 'mhaReviewScheduler top-level listOrdersInReviewWindow failed');
    return out;
  }

  try {
    await emitMissingReviewDateAlerts(now, ctx, out);
  } catch (err) {
    out.errors++;
    ctx.logger.error(
      { err },
      'mhaReviewScheduler BUG-588 data-quality alert path failed',
    );
  }

  if (rows.length === 0) {
    ctx.logger.warn(
      { kind: 'MHA_REVIEW_ALERT_ZERO_ROWS', tickAt: now.toISOString() },
      'mhaReviewScheduler returned zero rows (either no MHA orders in window or access-path failure)',
    );
  }

  // BUG-585 cycle-1 — per-clinic escalation threshold cache. Resolves
  // `mha_review_escalation_minutes` once per clinic per tick. Mirrors
  // pathologyCriticalScheduler's `escalationThresholdCache` shape.
  const escalationThresholdCache = new Map<string, number>();
  const tier3EscalationThresholdCache = new Map<string, number>();
  const tier4EscalationThresholdCache = new Map<string, number>();

  for (const row of rows) {
    out.processed++;
    const bucket = bucketForReviewDate(
      row.review_date,
      now,
      row.order_type_max_duration_days,
    );
    if (!bucket) continue;

    try {
      // BUG-584 (sibling of BUG-577) — resolve recipients through the
      // active-staff filter + clinic-admin fallback. Replaces the
      // prior naive Set<primary, creator> that silently routed to
      // deactivated users (canonical aged-CTO failure mode: order
      // created 6 months ago by registrar who has since rotated).
      const recipientResolution = ctx.resolveActiveRecipients
        ? await ctx.resolveActiveRecipients(
          row.clinic_id,
          row.primary_clinician_id,
          row.creator_staff_id,
        )
        : {
          active: Array.from(
            new Set(
              row.primary_clinician_id
                ? [row.primary_clinician_id, row.creator_staff_id]
                : [row.creator_staff_id],
            ).values(),
          ).filter((id): id is string => typeof id === 'string' && id.length > 0),
          reassignedToAdmin: null,
        };
      const { active: tier1Recipients, reassignedToAdmin } = recipientResolution;
      if (reassignedToAdmin) {
        ctx.logger.warn(
          {
            kind: 'MHA_REVIEW_RECIPIENT_REASSIGNED_TO_ADMIN',
            sourceTable: row.source_table,
            orderId: row.order_id,
            primaryClinicianId: row.primary_clinician_id,
            creatorStaffId: row.creator_staff_id,
            adminStaffId: reassignedToAdmin,
          },
          'mhaReviewScheduler reassigned to clinic admin (both original recipients inactive)',
        );
        if (ctx.writeAuditLogRow) {
          await ctx.writeAuditLogRow({
            clinicId: row.clinic_id,
            action: 'MHA_REVIEW_RECIPIENT_REASSIGNED',
            sourceTable: row.source_table,
            orderId: row.order_id,
            metadata: {
              source_table: row.source_table,
              primary_clinician_id: row.primary_clinician_id,
              creator_staff_id: row.creator_staff_id,
              admin_staff_id: reassignedToAdmin,
              bucket,
              reason: 'both_originals_inactive',
              // BUG-584 — system actor in metadata so AHPRA forensic
              // queries can filter `new_data->>'system_actor'`.
              system_actor: 'mha-review-scheduler',
            },
          });
        }
      } else if (tier1Recipients.length === 0) {
        // BUG-584 silent-drop closure: both inactive AND no admin
        // configured. ERROR-level pino + audit_log row so the worst-
        // case (statutory-review-deadline alert with NO recipient)
        // is observable + AHPRA-immutable. Sibling of BUG-577.
        ctx.logger.error(
          {
            kind: 'MHA_REVIEW_NO_RECIPIENT_AVAILABLE',
            sourceTable: row.source_table,
            orderId: row.order_id,
            primaryClinicianId: row.primary_clinician_id,
            creatorStaffId: row.creator_staff_id,
            bucket,
          },
          'mhaReviewScheduler dropped alert — both recipients inactive AND no clinic admin configured',
        );
        if (ctx.writeAuditLogRow) {
          await ctx.writeAuditLogRow({
            clinicId: row.clinic_id,
            action: 'MHA_REVIEW_NO_RECIPIENT_AVAILABLE',
            sourceTable: row.source_table,
            orderId: row.order_id,
            metadata: {
              source_table: row.source_table,
              primary_clinician_id: row.primary_clinician_id,
              creator_staff_id: row.creator_staff_id,
              bucket,
              reason: 'no_admin_configured',
              system_actor: 'mha-review-scheduler',
            },
          });
        }
        // BUG-584 cycle-2 absorb (L3 #1) — DO NOT `continue` here.
        // The tier-1 fan-out below is a no-op when `tier1Recipients`
        // is empty, but tier-2 escalation MUST still attempt fan-out
        // to active team-leads from `patient_team_assignments`.
        // This is the worst-case clinical-safety scenario the
        // BUG-585 escalation was designed to cover. Sibling-perfect
        // with pathologyCriticalScheduler which falls through.
        // Pinned by R-FIX-BUG-584-NO-CONTINUE-ON-SILENT-DROP — the
        // comment + the absence of `continue;` work together to
        // protect against regression. Removing this comment OR
        // adding `continue;` requires touching this region.
      }

      const severity = severityForBucket(bucket);
      const title = titleForBucket(row.order_number, bucket);

      // Tier-1 emit — primary + creator (or admin fallback).
      for (const staffId of tier1Recipients) {
        await ctx.emit({
          clinicId: row.clinic_id,
          userId: staffId,
          severity,
          category: 'mha-review',
          title,
          body: `Statutory review window for MHA order ${row.order_number} — ${bucket}.`,
          actionUrl: `/patients/${row.patient_id}/legal-orders/${row.order_id}`,
          payload: {
            order_id: row.order_id,
            order_number: row.order_number,
            patient_id: row.patient_id,
            source_table: row.source_table,
            review_date: row.review_date,
            bucket,
            tier: 1,
          },
          dedupeKey: dedupeKeyForMhaReview(row.source_table, row.order_id, staffId, bucket),
        });
        out.emitted++;
      }

      // BUG-585 (sibling of BUG-578) — tier-2 escalation when bucket
      // is critical AND escalation threshold has elapsed since UTC
      // midnight. Independent dedupe namespace so tier-1 + tier-2
      // each fire once per recipient per bucket. Recipients deduped
      // against tier-1 to prevent double-bell.
      if (!bucketEligibleForEscalation(bucket)) continue;

      if (!ctx.getEscalationThreshold) continue;

      let escalationThreshold = escalationThresholdCache.get(row.clinic_id);
      if (escalationThreshold === undefined) {
        escalationThreshold = await ctx.getEscalationThreshold(row.clinic_id);
        escalationThresholdCache.set(row.clinic_id, escalationThreshold);
      }
      let tier3EscalationThreshold = tier3EscalationThresholdCache.get(row.clinic_id);
      if (tier3EscalationThreshold === undefined) {
        tier3EscalationThreshold = ctx.getEscalationThresholdByTier
          ? await ctx.getEscalationThresholdByTier(row.clinic_id, 3)
          : Math.max(escalationThreshold * 2, 120);
        tier3EscalationThresholdCache.set(row.clinic_id, tier3EscalationThreshold);
      }
      let tier4EscalationThreshold = tier4EscalationThresholdCache.get(row.clinic_id);
      if (tier4EscalationThreshold === undefined) {
        tier4EscalationThreshold = ctx.getEscalationThresholdByTier
          ? await ctx.getEscalationThresholdByTier(row.clinic_id, 4)
          : Math.max(escalationThreshold * 4, 240);
        tier4EscalationThresholdCache.set(row.clinic_id, tier4EscalationThreshold);
      }

      const tiers: ReadonlyArray<{ tier: MhaEscalationTier; threshold: number }> = [
        { tier: 2, threshold: escalationThreshold },
        { tier: 3, threshold: tier3EscalationThreshold },
        { tier: 4, threshold: tier4EscalationThreshold },
      ];

      const alreadyNotified = new Set(tier1Recipients);

      for (const tierConfig of tiers) {
        if (!isMhaEscalationDue(now, tierConfig.threshold)) continue;

        let escalationStaff: string[] = [];
        if (ctx.listEscalationRecipientsByTier) {
          escalationStaff = await ctx.listEscalationRecipientsByTier(
            row.clinic_id,
            row.patient_id,
            tierConfig.tier,
          );
        } else if (ctx.listEscalationRecipients) {
          // Backward-compatible fallback for older test contexts.
          escalationStaff = await ctx.listEscalationRecipients(row.clinic_id, row.patient_id);
        }
        if (escalationStaff.length === 0) continue;

        const escalationThreshold = tierConfig.threshold;
        const escalationLabel = formatEscalationThresholdLabel(escalationThreshold);
        for (const staffId of escalationStaff) {
          if (alreadyNotified.has(staffId)) continue;
          const title =
            tierConfig.tier === 2
              ? `[ESCALATION] MHA order ${row.order_number} review unacknowledged ${escalationLabel} (${bucket})`
              : `${escalationTitlePrefixForTier(tierConfig.tier)} MHA order ${row.order_number} review unacknowledged ${escalationLabel} (${bucket})`;
          const body =
            tierConfig.tier === 2
              ? `Statutory review window for MHA order ${row.order_number} (${bucket}) has been unacknowledged for ${escalationLabel}. Tier-2 escalation — verify the primary clinician was reached AND the review has been clinically actioned.`
              : escalationBodyForTier(tierConfig.tier, row.order_number, bucket, escalationLabel);
          await ctx.emit({
            clinicId: row.clinic_id,
            userId: staffId,
            severity: 'critical',
            category: 'mha-review',
            title,
            body,
            actionUrl: `/patients/${row.patient_id}/legal-orders/${row.order_id}`,
            payload: {
              order_id: row.order_id,
              order_number: row.order_number,
              patient_id: row.patient_id,
              source_table: row.source_table,
              review_date: row.review_date,
              bucket,
              tier: tierConfig.tier,
            },
            dedupeKey: dedupeKeyForMhaEscalationTier(
              row.source_table,
              row.order_id,
              staffId,
              bucket,
              tierConfig.tier,
              now,
            ),
          });
          alreadyNotified.add(staffId);
          out.emitted++;
        }
      }
    } catch (err) {
      out.errors++;
      ctx.logger.error(
        { err, orderId: row.order_id, sourceTable: row.source_table },
        'mhaReviewScheduler row failed',
      );
    }
  }

  return out;
}

// ── Live-context construction (used by the cron tick) ──────────────────────

/**
 * Construct the live `MhaReviewContext` used by the cron tick. Exported
 * so integration tests can invoke `processMhaReviewAlerts(now,
 * await buildLiveContext())` against a real Postgres + spy on the
 * scheduler signal adapter. Sibling-applicable export pattern to
 * `pathologyCriticalScheduler.buildLiveContext` (BUG-451 batch 1
 * cycle-2). Without the export the only way to test the production
 * code path was inline parallel SQL — the anti-pattern that L4 BLOCKed
 * on the cycle-1 of the pathology test.
 */
export async function buildLiveContext(): Promise<MhaReviewContext> {
  return {
    async listOrdersInReviewWindow(now: Date): Promise<MhaReviewRow[]> {
      void now;
      // SCHEDULER ONLY — dbAdmin per BUG-583 (signacare_owner;
      // RLS-bypass-by-ownership). Tenant scoping preserved via
      // FK-bound clinic_id propagated into every emit.
      return legalOrderRepository.listOrdersInReviewWindow(dbAdmin);
    },
    async listActiveOrdersMissingReviewDate(now: Date): Promise<MhaMissingReviewDateRow[]> {
      void now;
      return legalOrderRepository.listActiveOrdersMissingReviewDate(dbAdmin);
    },
    async resolveClinicAdminRecipient(clinicId: string): Promise<string | null> {
      const clinic = await dbAdmin('clinics')
        .where({ id: clinicId })
        .whereNull('deleted_at')
        .select('nominated_admin_staff_id', 'delegated_admin_staff_id')
        .first();
      const candidates = [
        clinic?.nominated_admin_staff_id,
        clinic?.delegated_admin_staff_id,
      ].filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (candidates.length === 0) return null;
      const activeAdmins = await dbAdmin('staff')
        .where({ clinic_id: clinicId, is_active: true })
        .whereNull('deleted_at')
        .whereIn('id', candidates)
        .select('id');
      for (const candidate of candidates) {
        if (activeAdmins.some((r) => r.id === candidate)) return candidate;
      }
      return null;
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
        channels: input.channels,
        signalKey: 'mha_review_due',
      });
    },

    async resolveActiveRecipients(clinicId, primaryClinicianId, creatorStaffId) {
      // BUG-584 (sibling of BUG-577) — filter inactive staff and fall
      // back to clinic admin if both candidates are inactive. Sibling
      // pattern of pathologyCriticalScheduler.resolveActiveRecipients.
      const candidates = [primaryClinicianId, creatorStaffId].filter(
        (id): id is string => typeof id === 'string',
      );
      const uniqueCandidates = Array.from(new Set(candidates));
      if (uniqueCandidates.length === 0) {
        // No candidates at all — go straight to clinic-admin fallback.
        const clinic = await dbAdmin('clinics')
          .where({ id: clinicId })
          .whereNull('deleted_at')
          .select('nominated_admin_staff_id', 'delegated_admin_staff_id')
          .first();
        const adminId =
          clinic?.nominated_admin_staff_id ??
          clinic?.delegated_admin_staff_id ??
          null;
        return { active: adminId ? [adminId] : [], reassignedToAdmin: adminId };
      }
      const staffRows = await dbAdmin('staff')
        .where({ clinic_id: clinicId })
        .whereNull('deleted_at')
        .whereIn('id', uniqueCandidates)
        .select('id', 'is_active', 'deleted_at');
      const active: string[] = [];
      // Preserve primary-first ordering when both active.
      for (const id of uniqueCandidates) {
        const r = staffRows.find((s) => s.id === id);
        if (r && r.is_active && !r.deleted_at) active.push(id);
      }
      if (active.length > 0) {
        return { active, reassignedToAdmin: null };
      }
      const clinic = await dbAdmin('clinics')
        .where({ id: clinicId })
        .whereNull('deleted_at')
        .select('nominated_admin_staff_id', 'delegated_admin_staff_id')
        .first();
      const adminId =
        clinic?.nominated_admin_staff_id ??
        clinic?.delegated_admin_staff_id ??
        null;
      return { active: adminId ? [adminId] : [], reassignedToAdmin: adminId };
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
      // BUG-585 (sibling of BUG-578) — tier-2 escalation: active
      // team-leads from patient_team_assignments + clinic admin,
      // filtered through staff.is_active per BUG-584.
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

    async getEscalationThreshold(clinicId) {
      const t = await settingsService.getThresholds(clinicId, dbAdmin);
      return Number(t['mha_review_escalation_minutes']);
    },

    async getEscalationThresholdByTier(clinicId, tier) {
      // BUG-585 — SSoT for tier-2 escalation threshold is
      // `DEFAULT_THRESHOLDS.mha_review_escalation_minutes` (default
      // 60 — tighter than pathology's 120 per statutory-review
      // urgency rationale). Per-clinic override via
      // `clinic_thresholds`.
      // BUG-592-FOLLOWUP-DBADMIN-THRESHOLDS — pass `dbAdmin` so the
      // RLS-bound `clinic_thresholds` lookup does not silent-zero in
      // cron context (no `app.clinic_id` GUC outside Express).
      const t = await settingsService.getThresholds(clinicId, dbAdmin);
      if (tier === 2) return Number(t['mha_review_escalation_minutes']);
      if (tier === 3) return Number(t['mha_review_escalation_tier3_minutes']);
      return Number(t['mha_review_escalation_tier4_minutes']);
    },

    async writeAuditLogRow({ clinicId, action, sourceTable, orderId, metadata }) {
      // BUG-584 — AHPRA Standard 1 immutable trail. Uses writeAuditLog
      // from utils/audit.ts (never-throws via audit-outbox; pino ERROR
      // on DB-down). The actorId 'system:mha-review-scheduler' is
      // UUID-sanitised to NULL at persistence; the distinguishing
      // forensic axis is `metadata.system_actor` (passed by call site).
      // tableName uses the source table so forensic queries by
      // table_name + record_id locate the canonical order.
      await writeAuditLog({
        clinicId,
        actorId: 'system:mha-review-scheduler',
        action,
        tableName: sourceTable,
        recordId: orderId,
        newData: metadata,
      });
    },

    logger: defaultLogger,
  };
}

// ── Cron tick ──────────────────────────────────────────────────────────────

const mhaReviewTask = cron.schedule('0 * * * *', async () => {
  defaultLogger.info('Running MHA review-window scheduler');
  try {
    const ctx = await buildLiveContext();
    const out = await processMhaReviewAlerts(new Date(), ctx);
    defaultLogger.info(out, 'MHA review-window scheduler tick complete');
  } catch (err) {
    defaultLogger.error({ err }, 'MHA review-window scheduler failed');
  }
}, { timezone: 'Australia/Melbourne' });

if (process.env.NODE_ENV !== 'test') {
  registerShutdownHook({
    name: 'scheduler:mha-review',
    priority: 85,
    handler: async () => { mhaReviewTask.stop(); },
  });
}

export { mhaReviewTask };
