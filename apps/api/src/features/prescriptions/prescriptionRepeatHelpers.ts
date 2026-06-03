// apps/api/src/features/prescriptions/prescriptionRepeatHelpers.ts
//
// BUG-372c — read-only helper for the prescription-repeat scheduler.
//
// `prescriptions` has `repeats` (integer count) and `expires_at` (date)
// but NO `repeats_remaining` and NO `next_repeat_due` columns
// (verified — schema-snapshot.json + migrations grep). Repeat
// consumption is derived from `erx_tokens` rows where
// `prescription_id` matches AND `dispensed_at IS NOT NULL`. This
// helper does that derivation in SQL via a LEFT JOIN + COUNT-FILTER
// subquery so the scheduler doesn't have to round-trip per row.
//
// Tenant isolation: scheduler caller MUST pass `dbAdmin` per BUG-583.
// Per-row `clinic_id` is FK-bound and propagated into every emit.
//
// fix-registry anchors: BUG372C-DERIVED-CONSUMED, BUG372C-NO-FALSE-COL.

import type { Knex } from 'knex';

/**
 * @schema-drift-exempt select-aliased
 * BUG-372c — `PrescriptionRepeatRow` is a SELECT-aliased shape sourced
 * from a JOIN of `prescriptions` + `erx_tokens` (count) + `episodes`
 * (LEFT JOIN for primary_clinician_id). `consumed_count` is a derived
 * column from `COUNT(et.id) FILTER (WHERE et.dispensed_at IS NOT NULL)`,
 * NOT a physical column on `prescriptions`. Per CLAUDE.md §15.
 */
export interface PrescriptionRepeatRow {
  prescription_id: string;
  clinic_id: string;
  patient_id: string;
  generic_name: string | null;
  brand_name: string | null;
  repeats: number;
  consumed_count: number;
  expires_at: string;
  status: string;
  prescribed_by_staff_id: string;
  primary_clinician_id: string | null;
}

export const prescriptionRepeatHelpers = {
  /**
   * BUG-372c — list active prescriptions whose `expires_at` falls
   * within the scheduler's tier windows (T-7d / T-1d / T+overdue,
   * pre-filtered to a 38-day window so overdue alerts cap at 30
   * days). Bucketing is done in pure code by the scheduler.
   *
   * `consumed_count` derived in SQL from `erx_tokens.dispensed_at`
   * — no schema change to `prescriptions`. The grouping pushes the
   * COUNT(FILTER) into the DB so the result is one row per
   * prescription with an integer aggregate.
   *
   * `conn` required (no default — scheduler MUST pass dbAdmin per
   * BUG-583). Excludes status='cancelled' and 'superseded'.
   */
  async listPrescriptionsApproachingRepeatDue(conn: Knex): Promise<PrescriptionRepeatRow[]> {
    const rows = await conn('prescriptions as pr')
      .leftJoin('episodes as ep', function () {
        // BUG-372b L3 hygiene mirror — ep.clinic_id defence-in-depth.
        this.on('ep.id', '=', 'pr.episode_id')
          .andOn('ep.clinic_id', '=', 'pr.clinic_id')
          .andOnNull('ep.deleted_at');
      })
      // BUG-590 (sibling of BUG-579 + BUG-586) — current-team fallback.
      // When `pr.episode_id` points to a soft-deleted episode, `ep`
      // returns NULL `primary_clinician_id`. If the patient has been
      // transferred to a NEW team after the original episode closed,
      // the new clinician is invisible. The LATERAL sub-select below
      // finds the patient's CURRENT active (status='open') non-deleted
      // episode (most-recent start_date), so the COALESCE in the
      // SELECT can fall back to the current-team primary clinician.
      // Particularly harmful for depot-LAI prescriptions which often
      // span community-handover boundaries; closes the
      // "transferred-patient continuity gap".
      .joinRaw(`
        LEFT JOIN LATERAL (
          SELECT cur_ep.primary_clinician_id
          FROM episodes AS cur_ep
          WHERE cur_ep.patient_id = pr.patient_id
            AND cur_ep.clinic_id = pr.clinic_id
            AND cur_ep.status = 'open'
            AND cur_ep.deleted_at IS NULL
          ORDER BY cur_ep.start_date DESC
          LIMIT 1
        ) AS cur_ep ON TRUE
      `)
      .leftJoin('erx_tokens as et', function () {
        this.on('et.prescription_id', '=', 'pr.id').andOn(
          'et.clinic_id',
          '=',
          'pr.clinic_id',
        );
      })
      .whereIn('pr.status', ['active', 'dispensed'])
      .whereNull('pr.deleted_at')
      .where('pr.repeats', '>', 0)
      .whereNotNull('pr.expires_at')
      .whereRaw("pr.expires_at BETWEEN (now()::date - 30) AND (now()::date + 7)")
      .groupBy(
        'pr.id',
        'pr.clinic_id',
        'pr.patient_id',
        'pr.generic_name',
        'pr.brand_name',
        'pr.repeats',
        'pr.expires_at',
        'pr.status',
        'pr.prescribed_by_staff_id',
        'ep.primary_clinician_id',
        'cur_ep.primary_clinician_id',
      )
      .select(
        'pr.id as prescription_id',
        'pr.clinic_id',
        'pr.patient_id',
        'pr.generic_name',
        'pr.brand_name',
        'pr.repeats',
        // Derived consumed_count — COUNT FILTER on erx_tokens. Cast
        // to integer because COUNT returns bigint by default which
        // pg-types maps to string.
        conn.raw(
          "COUNT(et.id) FILTER (WHERE et.dispensed_at IS NOT NULL)::int as consumed_count",
        ),
        'pr.expires_at',
        'pr.status',
        'pr.prescribed_by_staff_id',
        // BUG-590 — COALESCE fallback. Returns the original-episode
        // primary clinician when present (typical case), else the
        // patient's current active episode primary clinician. NULL
        // only when both are absent (no active episodes at all).
        conn.raw(
          'COALESCE(ep.primary_clinician_id, cur_ep.primary_clinician_id) as primary_clinician_id',
        ),
      );
    return rows as PrescriptionRepeatRow[];
  },
};
