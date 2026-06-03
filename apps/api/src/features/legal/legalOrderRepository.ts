// apps/api/src/features/legal/legalOrderRepository.ts
//
// BUG-372b — read-only legal-order repository for the MHA review-window
// scheduler. The full CRUD surface lives in BUG-400 (UI-driven order
// management) and BUG-576 (FOLLOWUP — AuthContext-typed CRUD); this
// file is intentionally narrow: ONE method, used by ONE scheduler.
//
// Both `legal_orders` (canonical, has deleted_at) and
// `patient_legal_orders` (legacy, NO deleted_at — verified
// CLAUDE.md §1.4) are alive in production and unioned by this method.
//
// Tenant isolation is enforced by the row's FK-bound `clinic_id`
// being propagated into every downstream emit, NOT by RLS (the
// scheduler caller passes `dbAdmin` to bypass RLS-CLOSED — see
// BUG-583).
//
// fix-registry anchor: BUG372B-LEGAL-FEATURE.

import type { Knex } from 'knex';

/**
 * @schema-drift-exempt select-aliased
 * BUG-372b — `LegalOrderReviewRow` is a SELECT-aliased shape sourced from
 * a UNION of two source tables (`legal_orders` and `patient_legal_orders`)
 * with a JOIN to `episodes`. `order_id` aliases `lo.id`/`plo.id`;
 * `source_table` is a SELECT constant; `creator_staff_id` aliases
 * `legal_orders.created_by_staff_id` AND `patient_legal_orders.entered_by_id`;
 * `primary_clinician_id` is sourced from `episodes` LEFT JOIN. Per
 * CLAUDE.md §15 — annotation makes the SELECT-aliased shape explicit so
 * a future strengthening of the row-iface guard does not flag phantom
 * columns on this UNION.
 */
export interface LegalOrderReviewRow {
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

/**
 * BUG-588 — active legal orders that are missing `review_date`.
 * These rows never enter the reminder-window scheduler path unless a
 * data-quality audit path surfaces them explicitly.
 */
export interface LegalOrderMissingReviewDateRow {
  source_table: 'legal_orders' | 'patient_legal_orders';
  order_id: string;
  clinic_id: string;
  patient_id: string;
  order_number: string;
}

export const legalOrderRepository = {
  /**
   * BUG-372b — list active orders whose `review_date` falls within
   * any of the scheduler's tier windows ([T-7d, T+∞-overdue]).
   * Bucketing is done by the scheduler in pure code; this method
   * filters at the SQL boundary to keep the row count small.
   *
   * `conn` is required (not defaulted) — the scheduler MUST pass
   * `dbAdmin` per BUG-583. Request-path callers don't exist for this
   * helper (full CRUD comes via BUG-576).
   */
  async listOrdersInReviewWindow(conn: Knex): Promise<LegalOrderReviewRow[]> {
    // legal_orders (canonical) — JOIN episodes for primary_clinician_id.
    // status='active' is the canonical "still in force" state per
    // CLAUDE.md §15 partial-shape note: the column carries a string
    // and the active-set is the union of {'active'} (other values:
    // 'expired','revoked','superseded' do NOT need review reminders).
    // whereNull('deleted_at') per CLAUDE.md §1.4 (legal_orders has
    // deleted_at; patient_legal_orders does NOT — see below).
    const canonicalRows = await conn('legal_orders as lo')
      .leftJoin('legal_order_types as lot', 'lot.id', 'lo.order_type_id')
      .leftJoin('episodes as ep', function () {
        // BUG-372b L3 hygiene #3 — `ep.clinic_id = lo.clinic_id` defence
        // in depth (FK chain already pins patient.clinic_id; this belt
        // covers a future multi-clinic patient model).
        this.on('ep.id', '=', 'lo.episode_id')
          .andOn('ep.clinic_id', '=', 'lo.clinic_id')
          .andOnNull('ep.deleted_at');
      })
      // BUG-586 — discharged/soft-deleted original episode fallback.
      // If `lo.episode_id` points to a soft-deleted episode, the LEFT
      // JOIN above yields NULL primary clinician and the alert path
      // degenerates to creator-only routing. Use the patient's CURRENT
      // active episode primary clinician as a fallback.
      .joinRaw(`
        LEFT JOIN LATERAL (
          SELECT cur_ep.primary_clinician_id
          FROM episodes AS cur_ep
          WHERE cur_ep.patient_id = lo.patient_id
            AND cur_ep.clinic_id = lo.clinic_id
            AND cur_ep.status = 'open'
            AND cur_ep.deleted_at IS NULL
          ORDER BY cur_ep.start_date DESC
          LIMIT 1
        ) AS cur_ep ON TRUE
      `)
      .where({ 'lo.status': 'active' })
      .whereNull('lo.deleted_at')
      .whereNotNull('lo.review_date')
      // Pre-filter to orders whose review_date is within [T-7d, T+30d-overdue]
      // — pure-code bucketing in the scheduler narrows further to the
      // exact 5 tiers. The 30-day overdue cap prevents the scheduler
      // from spamming notifications on ancient lapsed orders that
      // operations should triage manually.
      .whereRaw("lo.review_date BETWEEN (now()::date - 30) AND (now()::date + 7)")
      .select(
        conn.raw("'legal_orders' as source_table"),
        'lo.id as order_id',
        'lo.clinic_id',
        'lo.patient_id',
        'lo.order_number',
        'lo.review_date',
        'lo.status',
        'lot.max_duration_days as order_type_max_duration_days',
        conn.raw(
          'COALESCE(ep.primary_clinician_id, cur_ep.primary_clinician_id) as primary_clinician_id',
        ),
        'lo.created_by_staff_id as creator_staff_id',
      );

    // patient_legal_orders (legacy) — NO deleted_at column; status
    // filter only. Episode lookup goes via the patient's most recent
    // active episode (this table has no episode_id FK).
    // patient_legal_orders has NO `episode_id` FK; episode is resolved
    // by JOIN on patient + status='open'. If the patient has multiple
    // open episodes (rare; multi-specialty), the row fans out per
    // open episode — over-alert is the safer failure mode for a
    // statutory-review reminder, and the per-recipient dedupe key
    // collapses duplicates. Tightening to `DISTINCT ON (plo.id)` is
    // tracked under BUG-576's full CRUD refactor.
    const legacyRows = await conn('patient_legal_orders as plo')
      .leftJoin('legal_order_types as lot', 'lot.id', 'plo.order_type_id')
      .leftJoin('episodes as ep', function () {
        this.on('ep.patient_id', '=', 'plo.patient_id')
          .andOn('ep.clinic_id', '=', 'plo.clinic_id')
          .andOnVal('ep.status', '=', 'open')
          .andOnNull('ep.deleted_at');
      })
      .where({ 'plo.status': 'active' })
      .whereNotNull('plo.review_date')
      .whereRaw("plo.review_date BETWEEN (now()::date - 30) AND (now()::date + 7)")
      .select(
        conn.raw("'patient_legal_orders' as source_table"),
        'plo.id as order_id',
        'plo.clinic_id',
        'plo.patient_id',
        'plo.order_number',
        'plo.review_date',
        'plo.status',
        'lot.max_duration_days as order_type_max_duration_days',
        'ep.primary_clinician_id as primary_clinician_id',
        'plo.entered_by_id as creator_staff_id',
      );

    return [...canonicalRows, ...legacyRows] as LegalOrderReviewRow[];
  },

  /**
   * BUG-588 — list active legal orders that are missing `review_date`.
   * These rows are a clinical-safety + compliance data-quality defect:
   * without `review_date`, statutory review reminders never fire.
   */
  async listActiveOrdersMissingReviewDate(conn: Knex): Promise<LegalOrderMissingReviewDateRow[]> {
    const canonicalRows = await conn('legal_orders as lo')
      .where({ 'lo.status': 'active' })
      .whereNull('lo.deleted_at')
      .whereNull('lo.review_date')
      .select(
        conn.raw("'legal_orders' as source_table"),
        'lo.id as order_id',
        'lo.clinic_id',
        'lo.patient_id',
        'lo.order_number',
      );

    const legacyRows = await conn('patient_legal_orders as plo')
      .where({ 'plo.status': 'active' })
      .whereNull('plo.review_date')
      .select(
        conn.raw("'patient_legal_orders' as source_table"),
        'plo.id as order_id',
        'plo.clinic_id',
        'plo.patient_id',
        'plo.order_number',
      );

    return [...canonicalRows, ...legacyRows] as LegalOrderMissingReviewDateRow[];
  },
};
