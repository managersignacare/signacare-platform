// apps/api/src/features/settings/settingsService.ts
//
// BUG-592-FOLLOWUP-DBADMIN-THRESHOLDS (2026-05-03) — `getThresholds` and
// `setThreshold` accept an optional `conn?: Knex` parameter so cron
// schedulers can pass `dbAdmin` to bypass RLS. The default `db` is the
// canonical RLS-scoped Knex proxy used by HTTP request paths (where
// `app.clinic_id` GUC is set by `rlsMiddleware`).
//
// Why: the RLS-scoped `db` proxy returns ZERO rows from `clinic_thresholds`
// when called outside an Express request context (no GUC set → policy
// `clinic_id = current_setting('app.clinic_id', true)::uuid` evaluates
// `clinic_id = NULL` → row excluded). Pre-fix, this silently disabled
// per-clinic threshold customisation in 4 schedulers (pathology,
// MHA, prescription-repeat indirectly via getEscalationThreshold,
// therapeutic-level) — operators could set `pathology_escalation_minutes
// = 30` in Power Settings and the scheduler would still use the 120-min
// default. Sibling closure pattern of BUG-583 RLS-zero closure.
import type { Knex } from 'knex';
import { db } from '../../db/db';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../../shared/errors';
import { writeAuditLog } from '../../utils/audit';

export const DEFAULT_THRESHOLDS: Record<string, number> = {
  referral_unattended_days: 5,
  referral_urgent_unattended_days: 1,
  referral_emergency_unattended_hours: 4,
  patient_missed_appointments_trigger: 2,
  lai_overdue_days: 3,
  clozapine_blood_overdue_days: 2,
  mha_expiry_warning_days: 14,
  aims_overdue_days: 90,
  task_overdue_hours: 48,
  invoice_overdue_days: 30,
  // Appointment reminder thresholds
  appointment_reminder_week_days: 7,
  appointment_reminder_days: 1,
  appointment_reminder_hours: 2,
  // BUG-WF41 guardrails — booking constraints used by appointmentService.
  // Values are clinic-local time. close hour is exclusive.
  appointment_max_advance_days: 183, // ~6 months
  appointment_open_hour_local: 6,
  appointment_close_hour_local: 22,
  // BUG-572 — ECT consent validity period (days) used by
  // ectConsentExpiryScheduler. Consent expiry is derived as:
  //   consent_expires_at = consent_date + ect_consent_validity_days
  // Default 180 days; per-clinic override via `clinic_thresholds`.
  ect_consent_validity_days: 180,
  // Manager dashboard operational targets (per-clinic configurable).
  // Used by /reports/contacts-kpi and /reports/staff-caseload when
  // staff-level target columns are absent.
  manager_contacts_target: 80,
  manager_caseload_target: 35,
  // BUG-372a — pathology critical-result alert threshold (minutes
  // unacknowledged before the scheduler emits to primary clinician +
  // orderer). Per-clinic override via `clinic_thresholds`.
  pathology_critical_minutes: 30,
  // BUG-578 — tier-2 escalation threshold (minutes unacknowledged
  // before pathologyCriticalScheduler escalates to active team-leads
  // + clinic admin). RACGP "Critical results notification" guidance
  // + AHPRA Standard 1 default 2 hours; per-clinic override allows
  // 24/7 inpatient wards to set 30 min and after-hours small clinics
  // to set 4h. Per-clinic override via `clinic_thresholds`.
  pathology_escalation_minutes: 120,
  // BUG-585-FOLLOWUP-MULTI-TIER-CASCADE — tier-3 and tier-4 pathology
  // escalation thresholds (minutes). Defaults implement the canonical
  // 2h -> 4h -> 8h cascade chain.
  pathology_escalation_tier3_minutes: 240,
  pathology_escalation_tier4_minutes: 480,
  // BUG-585 — tier-2 escalation threshold for mhaReviewScheduler.
  // Default 60 minutes — TIGHTER than pathology_escalation_minutes
  // (120) per BUG-585 clinical-safety rationale: statutory-review
  // missed-deadline harm class is HIGHER than pathology missed-
  // acknowledgement (AHPRA Standard 1 + state Mental Health Act
  // non-compliance). Per-clinic override via `clinic_thresholds`
  // allows tighter settings for inpatient mental-health units.
  mha_review_escalation_minutes: 60,
  // BUG-585-FOLLOWUP-MULTI-TIER-CASCADE — tier-3 and tier-4 MHA
  // escalation thresholds (minutes). Tier-2 remains intentionally
  // tighter (60 min) per statutory-review harm class.
  mha_review_escalation_tier3_minutes: 120,
  mha_review_escalation_tier4_minutes: 240,
  // BUG-589-FOLLOWUP-TIER-2-ESCALATION — prescription-repeat
  // tier-2 escalation threshold (minutes). Default 30 (tighter than
  // MHA 60 + pathology 120) per harm-class differential:
  //   - clozapine continuity gap >2 days = re-titration restart
  //   - depot-LAI continuity gap = relapse risk
  //   - lithium continuity gap = rebound mania risk
  // Per-clinic override via `clinic_thresholds`.
  prescription_repeat_escalation_minutes: 30,
  // BUG-592 — therapeutic-level monitoring overdue-days thresholds.
  // Per-drug-class because clinical surveillance cadence differs:
  //   - lithium: serum lithium 3-monthly (narrow therapeutic window
  //     0.4-1.0 mEq/L; toxicity above 1.5; missed = renal / cardiac
  //     / cognitive harm).
  //   - valproate: serum trough quarterly + LFTs (hepatotoxicity
  //     surveillance; valproate level 50-100 mcg/mL).
  //   - carbamazepine: serum trough quarterly + FBC (aplastic
  //     anaemia surveillance; level 4-12 mcg/mL).
  //   - warfarin: INR every 4-6 weeks once stabilised, weekly when
  //     unstable; default 14 days = midpoint of stable-cadence
  //     window (atrial-fibrillation patients).
  // Per-clinic override via `clinic_thresholds`.
  therapeutic_level_lithium_days: 90,
  therapeutic_level_valproate_days: 90,
  therapeutic_level_carbamazepine_days: 90,
  therapeutic_level_warfarin_days: 14,
  therapeutic_level_phenytoin_days: 90,
  // BUG-592-FOLLOWUP-TIER-2-ESCALATION — therapeutic-level scheduler
  // tier-2 escalation threshold (minutes). Default 30 given critical
  // harm class for all monitored drugs (lithium toxicity, warfarin
  // INR drift bleed/thrombosis, valproate hepatotoxicity, carbamazepine
  // aplastic-anaemia surveillance). Per-clinic override via
  // `clinic_thresholds`.
  therapeutic_level_escalation_minutes: 30,
  // BUG-403 (2026-05-03) — clozapine ANC thresholds per-clinic
  // configurable. Defaults match Australian CPMS-equivalent thresholds:
  //   - red:    ANC < 1.5 × 10⁹/L → STOP clozapine immediately
  //   - amber:  ANC 1.5–1.99      → weekly monitoring + alert prescriber
  //   - normal: ANC ≥ 2.0          → continue
  // Some inpatient haematology services use stricter cut-offs (e.g.
  // red < 1.7 in elderly cohorts); per-clinic override allows this
  // without forking code. Per CLAUDE.md §1.6 thresholds-as-config.
  clozapine_anc_red_threshold: 1.5,
  clozapine_anc_amber_threshold: 2.0,
};

// BUG-403 cycle-2 (L4 BLOCK absorb 2026-05-03) — clinical-safety floors
// for clozapine ANC thresholds. Australian CPMS-equivalent floors are
// MINIMUM safety levels: clinics may configure STRICTER (higher red /
// higher amber, e.g. elderly inpatient cohorts on red < 1.7) but NEVER
// LENIENT below CPMS. Lenient configuration would mean an ANC of 0.8
// (severe neutropenia / agranulocytosis territory) classifies as
// 'normal' — direct AHPRA Standard 1 + TGA-PI non-compliance.
//
// Sibling pattern of CLAUDE.md §17.4 retention `MAX(25, configured)` floor.
// L4 BLOCK absorb #1 (floor) + #2 (relational red < amber) + #3 (upper bound).
// Layer A (service-level guards). Layer B (DB CHECK constraint) tracked
// as BUG-403-FOLLOWUP-DB-CHECK-CONSTRAINT.
//
// IMPORTANT (BUG-403-FOLLOWUP-CONFIG-WRITE-AUDIT L4 advisory 2026-05-03):
// Threshold KEYS in this map MUST be clinic-scope identifiers only —
// NEVER patient-scope (e.g. `clozapine_anc_red_threshold_<patientId>`).
// The THRESHOLD_UPDATE audit_log row stores the key in oldData/newData
// at the cleartext level; embedding a patient UUID in the key would
// leak PHI into immutable audit_log per audit.ts:280+303 contract.
// Per-patient threshold customisation, if ever needed, MUST live in a
// separate `patient_thresholds` table with full RLS + audit posture,
// NOT this clinic-level config table.
export const THRESHOLD_FLOORS: Record<string, { min: number; max: number }> = {
  clozapine_anc_red_threshold: { min: 1.5, max: 5.0 },
  clozapine_anc_amber_threshold: { min: 2.0, max: 5.0 },
  // BUG-592-FOLLOWUP-THRESHOLD-FLOOR (naming legacy): therapeutic-level
  // thresholds must not be configured so high that surveillance is
  // effectively disabled. We enforce positive-day minima + clinical
  // maxima per drug class.
  therapeutic_level_lithium_days: { min: 1, max: 180 },
  therapeutic_level_valproate_days: { min: 1, max: 180 },
  therapeutic_level_carbamazepine_days: { min: 1, max: 180 },
  therapeutic_level_warfarin_days: { min: 1, max: 28 },
  therapeutic_level_phenytoin_days: { min: 1, max: 180 },
  appointment_max_advance_days: { min: 1, max: 365 },
  appointment_open_hour_local: { min: 0, max: 23 },
  appointment_close_hour_local: { min: 1, max: 24 },
};

export const settingsService = {
  /**
   * Read per-clinic thresholds, falling back to `DEFAULT_THRESHOLDS` for
   * any key not overridden in `clinic_thresholds`. Result merges
   * defaults + clinic overrides.
   *
   * @param clinicId  Tenant scope.
   * @param conn      Optional Knex connection. Defaults to `db` (the
   *                  RLS-scoped proxy — HTTP request path). Cron
   *                  schedulers MUST pass `dbAdmin` per BUG-583 RLS-zero
   *                  closure pattern: outside Express middleware there
   *                  is no `app.clinic_id` GUC, so the RLS policy
   *                  `clinic_id = NULLIF(current_setting('app.clinic_id',
   *                  true), '')::uuid` evaluates `clinic_id = NULL` and
   *                  returns ZERO rows — silently disabling per-clinic
   *                  customisation. Closes BUG-592-FOLLOWUP-DBADMIN-
   *                  THRESHOLDS (S1) for 4 schedulers.
   */
  async getThresholds(
    clinicId: string,
    conn: Knex = db,
  ): Promise<Record<string, number>> {
    const rows = await conn('clinic_thresholds').where({ clinic_id: clinicId });
    const result: Record<string, number> = { ...DEFAULT_THRESHOLDS };
    for (const row of rows) {
      result[row.threshold_key as string] = Number(row.threshold_value);
    }
    return result;
  },

  /**
   * Upsert a per-clinic threshold value. Mirrors `getThresholds`
   * conn-injection contract — request-path callers (Power Settings UI)
   * use the default `db`; cron-internal callers (none today, but the
   * symmetric API leaves the door open) pass `dbAdmin`.
   *
   * BUG-403 cycle-2 (2026-05-03 L4 BLOCK absorb):
   *  - Validates against `THRESHOLD_FLOORS` for clinical-safety-load-bearing keys.
   *    Refuses configuration BELOW the Australian CPMS floor (would create
   *    agranulocytosis missed-stop class for clozapine ANC). Refuses
   *    impossibly-lenient ceiling (typo defence — `15.0` instead of `1.5`).
   *  - Refuses unknown keys (typo defence — `clozapine_anc_red` written
   *    when the reader looks up `clozapine_anc_red_threshold` would be
   *    silently ignored, falling back to the default).
   *  - For paired thresholds (red + amber), enforces relational ordering
   *    (red < amber); a pair with red >= amber inverts classifyAnc semantics.
   */
  async setThreshold(
    clinicId: string,
    key: string,
    value: number,
    conn: Knex = db,
    /**
     * BUG-403 cycle-2 (2026-05-03) — when the caller has already
     * validated paired-key relational ordering against the FINAL state
     * (e.g. `bulkSetThresholds` in settingsController.ts), pass true to
     * skip the per-call relational check. Without this flag, two
     * concurrent `setThreshold` calls from a bulk update would each
     * read the OTHER's stale value and could fail spuriously OR pass
     * spuriously depending on direction. Floor / ceiling / key-whitelist
     * checks ALWAYS run regardless of this flag — they are absolute
     * clinical-safety guards.
     */
    skipRelationalCheck: boolean = false,
    /**
     * BUG-403-FOLLOWUP-CONFIG-WRITE-AUDIT (2026-05-03 L4 advisory) —
     * staffId of the actor performing the threshold change. When
     * provided, emits a `THRESHOLD_UPDATE` audit_log row with
     * structural pre-image (oldValue from existing row OR null for
     * fresh insert) + post-image (newValue). Required for Rule 5
     * traceability per AHPRA Standard 1: threshold values drive
     * clinical-safety classification (clozapine ANC red/amber bands →
     * STOP order vs continue) — forensic reviewer must be able to
     * reconstruct "who changed the threshold and when".
     *
     * Optional because internal seed-script callers (test fixtures,
     * one-off backfills) genuinely don't have a clinician actor;
     * those calls log debug-level "system actor" instead.
     */
    actorStaffId?: string,
  ): Promise<void> {
    // Layer A — key whitelist (typo defence).
    if (!(key in DEFAULT_THRESHOLDS)) {
      throw new AppError(
        `Unknown threshold key: ${key}`,
        400,
        'UNKNOWN_THRESHOLD_KEY',
      );
    }
    // Layer B — clinical-safety floor + ceiling for load-bearing keys.
    const floor = THRESHOLD_FLOORS[key];
    if (floor) {
      if (value < floor.min) {
        throw new AppError(
          `Threshold ${key}=${value} is below clinical-safety floor (min=${floor.min}). Configure stricter (higher) values only; never below the documented floor.`,
          400,
          'THRESHOLD_BELOW_FLOOR',
        );
      }
      if (value > floor.max) {
        throw new AppError(
          `Threshold ${key}=${value} exceeds clinical-safety ceiling (max=${floor.max}). Likely typo; verify scale.`,
          400,
          'THRESHOLD_ABOVE_CEILING',
        );
      }
    }
    // Layer C — relational ordering for paired thresholds (red < amber
    // strictly — equality would make the amber band empty so the red
    // category absorbs all sub-amber classifications, but the
    // classifyAnc convention is `< red` and `< amber` so red == amber
    // is degenerate-but-not-broken; we forbid equality for clarity).
    if (!skipRelationalCheck && key === 'clozapine_anc_red_threshold') {
      const current = await conn('clinic_thresholds')
        .where({ clinic_id: clinicId, threshold_key: 'clozapine_anc_amber_threshold' })
        .first('threshold_value');
      const amberValue = current ? Number(current.threshold_value) : DEFAULT_THRESHOLDS.clozapine_anc_amber_threshold;
      if (value >= amberValue) {
        throw new AppError(
          `Threshold ordering violated: clozapine_anc_red_threshold (${value}) must be strictly less than clozapine_anc_amber_threshold (${amberValue}). Set amber first.`,
          400,
          'THRESHOLD_ORDERING_VIOLATED',
        );
      }
    }
    if (!skipRelationalCheck && key === 'clozapine_anc_amber_threshold') {
      const current = await conn('clinic_thresholds')
        .where({ clinic_id: clinicId, threshold_key: 'clozapine_anc_red_threshold' })
        .first('threshold_value');
      const redValue = current ? Number(current.threshold_value) : DEFAULT_THRESHOLDS.clozapine_anc_red_threshold;
      if (value <= redValue) {
        throw new AppError(
          `Threshold ordering violated: clozapine_anc_amber_threshold (${value}) must be strictly greater than clozapine_anc_red_threshold (${redValue}). Set red first.`,
          400,
          'THRESHOLD_ORDERING_VIOLATED',
        );
      }
    }
    if (!skipRelationalCheck && key === 'appointment_open_hour_local') {
      const current = await conn('clinic_thresholds')
        .where({ clinic_id: clinicId, threshold_key: 'appointment_close_hour_local' })
        .first('threshold_value');
      const closeHour = current
        ? Number(current.threshold_value)
        : DEFAULT_THRESHOLDS.appointment_close_hour_local;
      if (value >= closeHour) {
        throw new AppError(
          `Threshold ordering violated: appointment_open_hour_local (${value}) must be strictly less than appointment_close_hour_local (${closeHour}).`,
          400,
          'THRESHOLD_ORDERING_VIOLATED',
        );
      }
    }
    if (!skipRelationalCheck && key === 'appointment_close_hour_local') {
      const current = await conn('clinic_thresholds')
        .where({ clinic_id: clinicId, threshold_key: 'appointment_open_hour_local' })
        .first('threshold_value');
      const openHour = current
        ? Number(current.threshold_value)
        : DEFAULT_THRESHOLDS.appointment_open_hour_local;
      if (value <= openHour) {
        throw new AppError(
          `Threshold ordering violated: appointment_close_hour_local (${value}) must be strictly greater than appointment_open_hour_local (${openHour}).`,
          400,
          'THRESHOLD_ORDERING_VIOLATED',
        );
      }
    }
    // BUG-403-FOLLOWUP-CONFIG-WRITE-AUDIT — capture pre-image BEFORE
    // upsert for true diff. Single read; same conn so cron / dbAdmin
    // callers stay consistent.
    const preImage = await conn('clinic_thresholds')
      .where({ clinic_id: clinicId, threshold_key: key })
      .first('id', 'threshold_value');
    await conn('clinic_thresholds')
      .insert({
        id: uuidv4(),
        clinic_id: clinicId,
        threshold_key: key,
        threshold_value: value,
        updated_at: new Date(),
      })
      .onConflict(['clinic_id', 'threshold_key'])
      .merge({ threshold_value: value, updated_at: new Date() });
    // Re-read to capture the row id (for fresh-insert path the preImage
    // was null, so we don't have it; for update-existing path the id is
    // stable). Only needed when emitting the audit row.
    if (actorStaffId) {
      const postImage = await conn('clinic_thresholds')
        .where({ clinic_id: clinicId, threshold_key: key })
        .first('id', 'threshold_value');
      await writeAuditLog({
        clinicId,
        userId: actorStaffId,
        action: 'THRESHOLD_UPDATE',
        tableName: 'clinic_thresholds',
        recordId: postImage?.id as string,
        oldData: preImage
          ? { threshold_key: key, threshold_value: Number(preImage.threshold_value) }
          : { threshold_key: key, threshold_value: null },
        newData: { threshold_key: key, threshold_value: value },
      });
    }
  },
};
