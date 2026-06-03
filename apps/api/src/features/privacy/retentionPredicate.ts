// apps/api/src/features/privacy/retentionPredicate.ts
//
// BUG-374b — pure 3-clock retention predicate.
//
// Locked policy (project_data_retention_policy.md + Q-A/Q-B/Q-G):
//   purgeable_at = MAX(
//     last_contact_at + MAX(25, configured_years),
//     dob + (MAX(25, configured_years) + 7) [when dob known],
//     deceased_date + MAX(25, configured_years) [when deceased]
//   )
//
// Defence-in-depth: even if all upstream layers (Zod L1+L2, service guard
// L3, DB CHECK L4) were bypassed, this predicate's `Math.max(25, ...)` /
// `GREATEST(25, ...)` floor (L5) prevents sub-25-year purge. Pure
// function — testable without DB.
//
// fix-registry anchors: BUG-374B-3-CLOCK-PREDICATE, BUG-374B-SQL-FLOOR-MAX-25.

import { DATA_RETENTION_YEARS_FLOOR } from '../power-settings/retentionSettingService';

export interface RetentionRow {
  /** Best-known last clinical contact. NULL → fall back to `created_at`. */
  last_contact_at: Date | null;
  /** Date of birth. When NULL the dob_clock is skipped. */
  date_of_birth: string | Date | null;
  /** Date of death. When NULL (alive) the deceased_clock is skipped. */
  deceased_date: string | Date | null;
  /** Patient row creation timestamp. Fallback when last_contact_at is NULL. */
  created_at: Date;
}

function toDate(v: string | Date | null): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  return new Date(v);
}

function addYears(d: Date, years: number): Date {
  const r = new Date(d);
  r.setUTCFullYear(r.getUTCFullYear() + years);
  return r;
}

/**
 * BUG-374b — pure-function check whether a patient row is purgeable
 * relative to `now` under `configuredYears` retention.
 *
 * MUST throw on `configuredYears < 25` per policy floor — programmer
 * misuse signal (Zod / service / DB CHECK should all reject before
 * reaching here, but this is the L5 belt).
 */
export function isPurgeable(
  row: RetentionRow,
  configuredYears: number,
  now: Date,
): boolean {
  if (!Number.isInteger(configuredYears) || configuredYears < DATA_RETENTION_YEARS_FLOOR) {
    throw new Error(
      `BUG-374b retention predicate: configuredYears must be >= ${DATA_RETENTION_YEARS_FLOOR} (policy floor); got ${configuredYears}`,
    );
  }
  const effectiveYears = Math.max(DATA_RETENTION_YEARS_FLOOR, configuredYears);

  // Last-contact clock (fallback to created_at when last_contact_at NULL).
  const lastClockBase = row.last_contact_at ?? row.created_at;
  const lastClock = addYears(lastClockBase, effectiveYears);

  // Dob clock (only when dob is known) — minor-protection adds 7 years.
  const dob = toDate(row.date_of_birth);
  const dobClock = dob ? addYears(dob, effectiveYears + 7) : null;

  // Deceased clock (only when deceased).
  const deceased = toDate(row.deceased_date);
  const deceasedClock = deceased ? addYears(deceased, effectiveYears) : null;

  // Purgeable when ALL applicable clocks have passed.
  if (lastClock > now) return false;
  if (dobClock && dobClock > now) return false;
  if (deceasedClock && deceasedClock > now) return false;
  return true;
}

/**
 * BUG-374b — SQL-side equivalent of `isPurgeable` for the scheduler's
 * batch SELECT. Returns a parameterised SQL fragment usable inside a
 * `whereRaw(buildPurgeableSql(years))`.
 *
 * MAX(25, configuredYears) floor is computed at SQL-string build time
 * (not via SQL `GREATEST`) because the floor is fixed at 25 — the
 * `GREATEST(25, ...)` + `INTERVAL` text inside the resulting fragment
 * is purely defensive belt + readability for ops dashboards.
 *
 * **Asymmetric posture vs `isPurgeable`** (deliberate; do not "fix"):
 *   - `isPurgeable` THROWS on configuredYears < 25 — programmer-misuse
 *     signal. The unit-tested service-layer guard should never let a
 *     sub-25 value reach the predicate; if it does, fail loud at dev
 *     time so the bug surfaces immediately.
 *   - `buildPurgeableSql` SILENTLY FLOORS at 25 via Math.max — this is
 *     the L5 belt for the cron path. The cron may receive sub-25 from
 *     a hypothetical future ops-script bypass; throwing would crash
 *     the cron. Silent floor PRESERVES the floor semantically while
 *     keeping the cron alive.
 * The two functions form a complementary pair: dev-time loud throw
 * (catches typos) + production-time silent floor (closes ops bypass).
 * Removing the asymmetry breaks the L5 defence-in-depth contract.
 */
export function buildPurgeableSql(configuredYears: number): string {
  const effectiveYears = Math.max(DATA_RETENTION_YEARS_FLOOR, configuredYears);
  // Inline the 32y minor-protection literal so reviewers + ops can see
  // both clocks. GREATEST(25, ...) is included for transparency in
  // EXPLAIN output even though configuredYears is already floored.
  return `
    (
      COALESCE(p.last_contact_at, p.created_at) <= now() - GREATEST(25, ${effectiveYears}) * INTERVAL '1 year'
      AND (
        p.date_of_birth IS NULL
        OR p.date_of_birth <= (now() - (GREATEST(25, ${effectiveYears}) + 7) * INTERVAL '1 year')::date
      )
      AND (
        p.deceased_date IS NULL
        OR p.deceased_date <= (now() - GREATEST(25, ${effectiveYears}) * INTERVAL '1 year')::date
      )
    )
    /* INTERVAL '${effectiveYears} years' last_contact + INTERVAL '${effectiveYears + 7} years' minor + INTERVAL '${effectiveYears} years' deceased + INTERVAL '25 years' floor */
  `.trim();
}
