import { describe, it, expect } from 'vitest';
import {
  computeDueDateBuckets,
  isInDueBucket,
  dueDateForRow,
  overdueGraceDaysFor,
  computeListCountTiles,
  type DueBucketCounts,
  type ListCountTileRow,
} from './dueDateBuckets';

// Anchor "now": Wed 2026-05-13 09:00 AEST. In Australia/Melbourne that civil
// date is 2026-05-13; in UTC the instant is 2026-05-12T23:00Z — the cross-
// midnight divergence is deliberate to prove tz-correctness.
const NOW = new Date('2026-05-12T23:00:00Z');
const TZ = 'Australia/Melbourne';

function counts(
  dueDates: Array<string | null | undefined>,
  graceDays = 0,
  now: Date = NOW,
): DueBucketCounts {
  return computeDueDateBuckets(dueDates, { now, timeZone: TZ, graceDays });
}

describe('computeDueDateBuckets — clinic-local civil date (tz-correct)', () => {
  it('uses clinic timezone, not UTC, for "today"', () => {
    // NOW is 2026-05-12T23:00Z = 2026-05-13 in Melbourne. A due date of
    // 2026-05-13 must be "due today" (in this week), NOT overdue.
    const c = counts(['2026-05-13']);
    expect(c.overdue).toBe(0);
    expect(c.dueThisWeek).toBe(1);
  });

  it('total counts every row incl. null/undefined due dates', () => {
    const c = counts(['2026-05-13', null, undefined, '2020-01-01']);
    expect(c.total).toBe(4);
  });

  it('null/blank/invalid due date is in total only — never overdue, never a forward bucket', () => {
    const c = counts([null, undefined, '', 'not-a-date']);
    expect(c).toMatchObject({
      total: 4,
      overdue: 0,
      dueThisWeek: 0,
      dueNextWeek: 0,
      dueThisMonth: 0,
      dueThisQuarter: 0,
    });
  });
});

describe('overdue (with per-domain grace)', () => {
  it('graceDays=0: any due date strictly before clinic-today is overdue', () => {
    // today (clinic) = 2026-05-13. 2026-05-12 is yesterday → overdue.
    expect(counts(['2026-05-12'], 0).overdue).toBe(1);
    // exactly today is NOT overdue
    expect(counts(['2026-05-13'], 0).overdue).toBe(0);
  });

  it('LAI graceDays=7: due 6 days ago = NOT overdue; 8 days ago = overdue', () => {
    // today 2026-05-13; minus 7d grace ⇒ overdue only if due < 2026-05-06.
    expect(counts(['2026-05-07'], 7).overdue).toBe(0); // within grace
    expect(counts(['2026-05-06'], 7).overdue).toBe(0); // boundary: == today-grace, not strictly before
    expect(counts(['2026-05-05'], 7).overdue).toBe(1); // beyond grace
  });

  it('within-grace past-due item sits in total only (not overdue, not forward bucket)', () => {
    const c = counts(['2026-05-10'], 7); // past but within 7d grace
    expect(c.overdue).toBe(0);
    expect(c.dueThisWeek).toBe(0); // due date is before today → not a forward bucket
    expect(c.total).toBe(1);
  });
});

describe('forward calendar buckets — nested/cumulative, Monday week-start', () => {
  // today (clinic) = Wed 2026-05-13.
  // This calendar week (Mon-Sun) = 2026-05-11 .. 2026-05-17.
  // Next calendar week = 2026-05-18 .. 2026-05-24.
  // This month = .. 2026-05-31. This quarter (Q2) = .. 2026-06-30.
  it('due Sunday 2026-05-17 is in thisWeek and every wider bucket', () => {
    const c = counts(['2026-05-17']);
    expect(c.dueThisWeek).toBe(1);
    expect(c.dueNextWeek).toBe(1);
    expect(c.dueThisMonth).toBe(1);
    expect(c.dueThisQuarter).toBe(1);
  });

  it('due Mon 2026-05-18 is NOT thisWeek but IS nextWeek/month/quarter', () => {
    const c = counts(['2026-05-18']);
    expect(c.dueThisWeek).toBe(0);
    expect(c.dueNextWeek).toBe(1);
    expect(c.dueThisMonth).toBe(1);
    expect(c.dueThisQuarter).toBe(1);
  });

  it('due 2026-05-28 (in month, beyond next week) is month+quarter only', () => {
    const c = counts(['2026-05-28']);
    expect(c.dueThisWeek).toBe(0);
    expect(c.dueNextWeek).toBe(0);
    expect(c.dueThisMonth).toBe(1);
    expect(c.dueThisQuarter).toBe(1);
  });

  it('due 2026-06-20 (next month, same quarter) is quarter only', () => {
    const c = counts(['2026-06-20']);
    expect(c.dueThisMonth).toBe(0);
    expect(c.dueThisQuarter).toBe(1);
  });

  it('due 2026-07-01 (next quarter) is in NO forward bucket but in total', () => {
    const c = counts(['2026-07-01']);
    expect(c).toMatchObject({
      total: 1, overdue: 0, dueThisWeek: 0, dueNextWeek: 0, dueThisMonth: 0, dueThisQuarter: 0,
    });
  });

  it('accepts ISO timestamps, taking the date part', () => {
    expect(counts(['2026-05-17T13:45:00.000Z']).dueThisWeek).toBe(1);
  });
});

describe('month/quarter-boundary spill — monotonic horizon clamp keeps nesting', () => {
  // Pick "now" so that "next week" spills past month end:
  // Mon 2026-06-29 (clinic). This week = 2026-06-29..07-05 (spills into July).
  // This month ends 2026-06-30. Without clamping, dueThisWeek could exceed
  // dueThisMonth. The clamp guarantees thisWeek ⊆ nextWeek ⊆ month ⊆ quarter.
  const NOW_MONTH_EDGE = new Date('2026-06-28T23:00:00Z'); // = 2026-06-29 AEST
  it('a due date inside the spilled week is counted in month/quarter too (nesting holds)', () => {
    const c = computeDueDateBuckets(['2026-07-04'], {
      now: NOW_MONTH_EDGE, timeZone: TZ, graceDays: 0,
    });
    expect(c.dueThisWeek).toBe(1);
    // nesting invariant: any bucket count <= the next wider bucket
    expect(c.dueThisWeek).toBeLessThanOrEqual(c.dueNextWeek);
    expect(c.dueNextWeek).toBeLessThanOrEqual(c.dueThisMonth);
    expect(c.dueThisMonth).toBeLessThanOrEqual(c.dueThisQuarter);
  });
});

describe('nesting invariant — fuzzed across a full year of "today" positions', () => {
  it('thisWeek ⊆ nextWeek ⊆ thisMonth ⊆ thisQuarter for every day of 2026', () => {
    for (let d = 0; d < 365; d++) {
      const now = new Date(Date.UTC(2026, 0, 1) + d * 86_400_000);
      // a fixed spread of due dates across the year
      const dues = Array.from({ length: 40 }, (_, i) =>
        new Date(Date.UTC(2026, 0, 1) + i * 12 * 86_400_000).toISOString().slice(0, 10),
      );
      const c = computeDueDateBuckets(dues, { now, timeZone: TZ, graceDays: 0 });
      expect(c.dueThisWeek).toBeLessThanOrEqual(c.dueNextWeek);
      expect(c.dueNextWeek).toBeLessThanOrEqual(c.dueThisMonth);
      expect(c.dueThisMonth).toBeLessThanOrEqual(c.dueThisQuarter);
      expect(c.dueThisQuarter).toBeLessThanOrEqual(c.total);
      expect(c.overdue).toBeLessThanOrEqual(c.total);
    }
  });
});

describe('isInDueBucket — used by the date-range filter (SSoT with the cards)', () => {
  it('week filter matches exactly the dueThisWeek card definition', () => {
    expect(isInDueBucket('2026-05-17', 'dueThisWeek', { now: NOW, timeZone: TZ })).toBe(true);
    expect(isInDueBucket('2026-05-18', 'dueThisWeek', { now: NOW, timeZone: TZ })).toBe(false);
  });
  it('month/quarter filter matches the card definitions', () => {
    expect(isInDueBucket('2026-05-28', 'dueThisMonth', { now: NOW, timeZone: TZ })).toBe(true);
    expect(isInDueBucket('2026-06-20', 'dueThisMonth', { now: NOW, timeZone: TZ })).toBe(false);
    expect(isInDueBucket('2026-06-20', 'dueThisQuarter', { now: NOW, timeZone: TZ })).toBe(true);
  });
  it('null due date is not in any bucket', () => {
    expect(isInDueBucket(null, 'dueThisWeek', { now: NOW, timeZone: TZ })).toBe(false);
  });
});

// ─── Per-list policy + ListCountCards tile builder ────────────────────
// NOW anchor reused from above: Wed 2026-05-13 09:00 AEST.

describe('dueDateForRow — per-list due-field policy', () => {
  it('listKey="mha" keys on reviewDate (not nextDueDate)', () => {
    expect(dueDateForRow('mha', { reviewDate: '2026-06-01', nextDueDate: '2026-06-15' })).toBe('2026-06-01');
  });
  it('listKey="lai" / "91day" / "team" keys on nextDueDate', () => {
    expect(dueDateForRow('lai', { reviewDate: '2026-06-01', nextDueDate: '2026-06-15' })).toBe('2026-06-15');
    expect(dueDateForRow('91day', { nextDueDate: '2026-07-01' })).toBe('2026-07-01');
  });
  it('missing field returns null (not undefined)', () => {
    expect(dueDateForRow('lai', {})).toBeNull();
    expect(dueDateForRow('mha', {})).toBeNull();
  });
});

describe('overdueGraceDaysFor — per-list grace policy', () => {
  it('listKey="lai" returns the supplied grace; everything else returns 0', () => {
    expect(overdueGraceDaysFor('lai', 7)).toBe(7);
    expect(overdueGraceDaysFor('mha', 7)).toBe(0);
    expect(overdueGraceDaysFor('91day', 7)).toBe(0);
    expect(overdueGraceDaysFor('clozapine', 7)).toBe(0);
  });
});

describe('computeListCountTiles — dynamic count header (recomputes on filter)', () => {
  const baseOpts = { now: NOW, timeZone: TZ, laiGraceDays: 7 };
  // 5 rows, due dates relative to NOW (Wed 2026-05-13):
  const fiveRows: ListCountTileRow[] = [
    { status: 'active', teamName: 'TeamA', nextDueDate: '2026-05-13' }, // due today → thisWeek+
    { status: 'active', teamName: 'TeamA', nextDueDate: '2026-05-20' }, // next week
    { status: 'active', teamName: 'TeamB', nextDueDate: '2026-05-31' }, // this month, past nextWeek
    { status: 'closed', teamName: 'TeamB', nextDueDate: '2026-01-01' }, // overdue (>7d)
    { status: 'active', teamName: '',      nextDueDate: null         }, // null → total only
  ];

  it('empty rows ⇒ all zeros', () => {
    expect(computeListCountTiles([], 'lai', baseOpts)).toEqual({
      total: 0, overdue: 0, dueThisWeek: 0, dueNextWeek: 0, dueThisMonth: 0, dueThisQuarter: 0, active: 0, teams: 0,
    });
  });

  it('lai listKey: 5-row baseline counts (active + distinct teamNames + buckets via SSoT)', () => {
    const t = computeListCountTiles(fiveRows, 'lai', baseOpts);
    expect(t.total).toBe(5);
    expect(t.overdue).toBe(1);           // the 2026-01-01 row (well past 7d grace)
    expect(t.dueThisWeek).toBe(1);       // today
    expect(t.dueNextWeek).toBe(2);       // today + 2026-05-20 (nested cumulative)
    expect(t.dueThisMonth).toBe(3);      // + 2026-05-31
    expect(t.dueThisQuarter).toBe(3);    // same 3 (all in Q2)
    expect(t.active).toBe(4);            // 4 active (excludes the closed)
    expect(t.teams).toBe(2);             // TeamA + TeamB; blank teamName excluded
  });

  it('RECOMPUTES on filtered-rows change (the "dynamic" requirement)', () => {
    // Same data minus the overdue row → overdue drops to 0, total to 4.
    const filtered = fiveRows.filter((r) => r.status === 'active');
    const t = computeListCountTiles(filtered, 'lai', baseOpts);
    expect(t.total).toBe(4);
    expect(t.overdue).toBe(0);
    expect(t.active).toBe(4);
    // And further filter: only TeamA → teams drops to 1.
    const onlyA = filtered.filter((r) => r.teamName === 'TeamA');
    const t2 = computeListCountTiles(onlyA, 'lai', baseOpts);
    expect(t2.total).toBe(2);
    expect(t2.teams).toBe(1);
  });

  it('mha listKey uses reviewDate (NOT nextDueDate)', () => {
    const rows: ListCountTileRow[] = [
      { status: 'active', teamName: 'T', reviewDate: '2026-05-13', nextDueDate: '2027-01-01' }, // mha: today
      { status: 'active', teamName: 'T', reviewDate: null,         nextDueDate: '2026-05-13' }, // mha: null → total only
    ];
    const t = computeListCountTiles(rows, 'mha', baseOpts);
    expect(t.total).toBe(2);
    expect(t.dueThisWeek).toBe(1); // only the row whose reviewDate is today
  });

  it('lai grace shifts the overdue threshold (6d-past = NOT overdue; 8d-past = overdue)', () => {
    const rows: ListCountTileRow[] = [
      { status: 'active', teamName: 'T', nextDueDate: '2026-05-07' }, // 6 days before NOW → within 7d grace
      { status: 'active', teamName: 'T', nextDueDate: '2026-05-05' }, // 8 days before NOW → past grace, overdue
    ];
    const t = computeListCountTiles(rows, 'lai', baseOpts);
    expect(t.overdue).toBe(1);  // only the 2026-05-05 row
    // Same DATES but on the mha policy (which keys on reviewDate, grace=0):
    // both are strictly before clinic-today ⇒ BOTH overdue.
    const mhaRows: ListCountTileRow[] = [
      { status: 'active', teamName: 'T', reviewDate: '2026-05-07' },
      { status: 'active', teamName: 'T', reviewDate: '2026-05-05' },
    ];
    const tMha = computeListCountTiles(mhaRows, 'mha', baseOpts);
    expect(tMha.overdue).toBe(2);
  });
});
