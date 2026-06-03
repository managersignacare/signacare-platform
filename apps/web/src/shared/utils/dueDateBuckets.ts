/**
 * Shared SSoT for the dynamic due-date count header + the list date-range
 * filter on the clinical list surfaces (LAI / MHA / 91-day-review and any
 * other listKey served by ClinicalListPage).
 *
 * Semantics (operator-frozen, see plan PART 6):
 *  - Buckets are NESTED / CUMULATIVE with CALENDAR boundaries:
 *      dueThisWeek ⊆ dueNextWeek ⊆ dueThisMonth ⊆ dueThisQuarter
 *    Each forward bucket = items due from clinic-today through the END of
 *    that named calendar period. Monotonic horizon clamping guarantees the
 *    subset invariant even when "next week" spills past month/quarter end.
 *  - `overdue` is a separate category: due strictly before clinic-today
 *    MINUS a per-domain grace (LAI = LAI_OVERDUE_GRACE_DAYS, others = 0).
 *  - Week starts MONDAY (AU clinical convention).
 *  - All date math is performed against the CLINIC timezone civil date, not
 *    the browser/UTC date. `now` and `timeZone` are injected so the function
 *    is pure and deterministic (unit-testable without machine-tz reliance).
 *  - Rows with a missing/blank/invalid due date count only in `total`.
 *
 * This module is the single source of truth: the count cards AND the
 * date-range filter both go through it, so they can never drift apart.
 * Regression-guarded by scripts/guards/check-no-inline-date-bucket-math.ts.
 */

const DAY_MS = 86_400_000;

export type ForwardBucketKey = 'dueThisWeek' | 'dueNextWeek' | 'dueThisMonth' | 'dueThisQuarter';
export type DueBucketKey = 'total' | 'overdue' | ForwardBucketKey;

export interface DueBucketCounts {
  total: number;
  overdue: number;
  dueThisWeek: number;
  dueNextWeek: number;
  dueThisMonth: number;
  dueThisQuarter: number;
}

export interface DueBucketOptions {
  /** Injected current instant — keeps the function pure/deterministic. */
  now: Date;
  /** Clinic IANA timezone, e.g. 'Australia/Melbourne'. */
  timeZone: string;
  /** Per-domain overdue grace in days (LAI = 7, MHA/91-day = 0). */
  graceDays?: number;
}

/** UTC-midnight epoch ms of a civil (y, m-1-based-via JS, d) date. */
function civilToUtc(y: number, monthOneBased: number, d: number): number {
  return Date.UTC(y, monthOneBased - 1, d);
}

/** Clinic-local civil date of an instant, as {y, m(1-12), d}. */
function civilInTz(instant: Date, timeZone: string): { y: number; m: number; d: number } {
  // en-CA yields YYYY-MM-DD; timeZone shifts the instant to clinic-local.
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

/**
 * Normalise a due-date value to a UTC-midnight epoch (civil-day granularity)
 * or null if absent/unparseable. DATE-typed columns (lai.next_due_date,
 * legal_orders.review_date) arrive as 'YYYY-MM-DD' (no tz) — we take the
 * civil date verbatim. ISO timestamps are reduced to their date part.
 */
function dueToUtc(due: string | null | undefined): number | null {
  if (typeof due !== 'string' || due.length < 10) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(due)) {
    const y = Number(due.slice(0, 4));
    const m = Number(due.slice(5, 7));
    const d = Number(due.slice(8, 10));
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return civilToUtc(y, m, d);
  }
  return null;
}

interface Horizons {
  startTodayUtc: number;
  overdueThresholdUtc: number;
  hWeek: number;
  hNextWeek: number;
  hMonth: number;
  hQuarter: number;
}

function buildHorizons(opts: DueBucketOptions): Horizons {
  const grace = Math.max(0, opts.graceDays ?? 0);
  const { y, m, d } = civilInTz(opts.now, opts.timeZone);
  const startTodayUtc = civilToUtc(y, m, d);

  // ISO week: Monday = 0 … Sunday = 6.
  const jsDow = new Date(startTodayUtc).getUTCDay(); // 0=Sun … 6=Sat
  const isoDow = (jsDow + 6) % 7;
  const endThisWeek = startTodayUtc + (6 - isoDow) * DAY_MS;
  const endNextWeek = endThisWeek + 7 * DAY_MS;

  // Last civil day of this month / this quarter (UTC-midnight of that day).
  const endThisMonth = civilToUtc(y, m + 1, 0); // day 0 of next month = last of this
  const qEndMonth = Math.ceil(m / 3) * 3; // 3,6,9,12
  const endThisQuarter = civilToUtc(y, qEndMonth + 1, 0);

  // Monotonic clamp ⇒ week ⊆ nextWeek ⊆ month ⊆ quarter ALWAYS holds, even
  // when the calendar week spills across a month/quarter boundary.
  const hWeek = endThisWeek;
  const hNextWeek = Math.max(endNextWeek, hWeek);
  const hMonth = Math.max(endThisMonth, hNextWeek);
  const hQuarter = Math.max(endThisQuarter, hMonth);

  return {
    startTodayUtc,
    overdueThresholdUtc: startTodayUtc - grace * DAY_MS,
    hWeek,
    hNextWeek,
    hMonth,
    hQuarter,
  };
}

/**
 * Count rows into nested due-date buckets. Pass the per-row due date already
 * resolved by the caller (caller maps per listKey: mha→reviewDate, else→
 * nextDueDate). `total` always equals dueDates.length.
 */
export function computeDueDateBuckets(
  dueDates: ReadonlyArray<string | null | undefined>,
  opts: DueBucketOptions,
): DueBucketCounts {
  const h = buildHorizons(opts);
  const c: DueBucketCounts = {
    total: dueDates.length,
    overdue: 0,
    dueThisWeek: 0,
    dueNextWeek: 0,
    dueThisMonth: 0,
    dueThisQuarter: 0,
  };
  for (const raw of dueDates) {
    const u = dueToUtc(raw);
    if (u === null) continue; // total only
    if (u < h.overdueThresholdUtc) {
      c.overdue += 1;
      continue;
    }
    if (u < h.startTodayUtc) continue; // within grace, past — total only
    if (u <= h.hWeek) c.dueThisWeek += 1;
    if (u <= h.hNextWeek) c.dueNextWeek += 1;
    if (u <= h.hMonth) c.dueThisMonth += 1;
    if (u <= h.hQuarter) c.dueThisQuarter += 1;
  }
  return c;
}

/**
 * Single-row predicate used by the list date-range filter so the filter and
 * the count cards share one definition (no drift). `bucket` accepts the
 * forward buckets and `overdue`.
 */
export function isInDueBucket(
  due: string | null | undefined,
  bucket: Exclude<DueBucketKey, 'total'>,
  opts: DueBucketOptions,
): boolean {
  const u = dueToUtc(due);
  if (u === null) return false;
  const h = buildHorizons(opts);
  if (bucket === 'overdue') return u < h.overdueThresholdUtc;
  if (u < h.startTodayUtc) return false;
  switch (bucket) {
    case 'dueThisWeek':
      return u <= h.hWeek;
    case 'dueNextWeek':
      return u <= h.hNextWeek;
    case 'dueThisMonth':
      return u <= h.hMonth;
    case 'dueThisQuarter':
      return u <= h.hQuarter;
    default:
      return false;
  }
}

// ─── Per-list policy + ListCountCards tile builder ─────────────────────
//
// Plan PART 6 DoD#7 (L5). Pulled out of ClinicalListPage.tsx so the count
// header's logic is unit-testable via Vitest (the project policy is
// "pure logic in Vitest; rendering via Playwright" — see web vitest
// config docblock re: the React 19 hooks-dispatcher constraint). Keeping
// the per-list policy adjacent to the bucket SSoT also closes the obvious
// drift risk: anyone touching bucket semantics now sees the per-list
// policy in the same file.

/**
 * Per-list due-date field policy. `mha` (and the 91-day-review list that
 * shares its listType) key on `reviewDate`; every other clinical list
 * (lai / clozapine / referrals / team) keys on `nextDueDate`.
 */
export function dueDateForRow(
  listKey: string,
  row: { nextDueDate?: string | null; reviewDate?: string | null },
): string | null {
  return listKey === 'mha' ? (row.reviewDate ?? null) : (row.nextDueDate ?? null);
}

/**
 * Per-list overdue-grace policy. LAI carries a 7-day grace identical to
 * the backend (`LAI_OVERDUE_GRACE_DAYS`); every other list = 0.
 *
 * The numeric value is intentionally NOT imported from `@signacare/shared`
 * here — this function is the policy router; the value-source SSoT lives
 * in `packages/shared/src/lai.schemas.ts` and reaches this file via the
 * caller (the ClinicalListPage page-level import). Keeping the import
 * graph at the call-site avoids a cross-package import from a shared util
 * and matches how isInDueBucket already accepts `graceDays` as a prop.
 */
export function overdueGraceDaysFor(listKey: string, laiGraceDays: number): number {
  return listKey === 'lai' ? laiGraceDays : 0;
}

export interface ListCountTiles extends DueBucketCounts {
  /** filteredRows where status === 'active' (non-due-date scoped). */
  active: number;
  /** Distinct teamName count across filteredRows (blank teamNames excluded). */
  teams: number;
}

export interface ListCountTileRow {
  status?: string;
  teamName?: string;
  nextDueDate?: string | null;
  reviewDate?: string | null;
}

/**
 * Compute the 8 dynamic count-card tile counts for a filtered list of
 * rows. Recomputes on every change to `filteredRows` (callers wire via
 * `useMemo([filteredRows, listKey])`). Pure / deterministic — `now`,
 * `timeZone`, and `laiGraceDays` are injected for test-friendliness.
 */
export function computeListCountTiles(
  filteredRows: ReadonlyArray<ListCountTileRow>,
  listKey: string,
  opts: { now: Date; timeZone: string; laiGraceDays: number },
): ListCountTiles {
  const dueDates = filteredRows.map((r) =>
    dueDateForRow(listKey, { nextDueDate: r.nextDueDate ?? null, reviewDate: r.reviewDate ?? null }),
  );
  const buckets = computeDueDateBuckets(dueDates, {
    now: opts.now,
    timeZone: opts.timeZone,
    graceDays: overdueGraceDaysFor(listKey, opts.laiGraceDays),
  });
  let active = 0;
  const teamNames = new Set<string>();
  for (const r of filteredRows) {
    if (r.status === 'active') active += 1;
    if (r.teamName) teamNames.add(r.teamName);
  }
  return { ...buckets, active, teams: teamNames.size };
}
