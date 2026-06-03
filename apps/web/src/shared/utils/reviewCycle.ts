/**
 * Shared SSoT for the synthetic 91-day clinical-review cadence used by the
 * "Clinical Review" (91day) list on ClinicalListPage.
 *
 * Extracted verbatim from the previous inline computation in
 * ClinicalListPage.tsx (plan PART 6, DoD#4/#5) so that:
 *  - there is ZERO inline day-ms date math left in the lists feature
 *    (precondition for the empty-allowlist regression guard
 *    scripts/guards/check-no-inline-date-bucket-math.ts), and
 *  - the cadence is unit-testable and cannot silently drift.
 *
 * Semantics (BEHAVIOUR-PRESERVING — intentionally identical to the prior
 * inline code; this is a refactor, not a fix):
 *  - Cadence is DURATION-based: 91 calendar days (91 * 86_400_000 ms) from
 *    the episode start, repeated. It is NOT calendar/timezone aligned —
 *    that matches the pre-existing product behaviour. Any move to
 *    civil-date / DST-safe arithmetic is a deliberate behaviour change and
 *    must be filed as its own BUG, not folded into this extraction.
 *  - `daysSinceStart = floor((now - episodeStart) / DAY_MS)`.
 *  - `reviewCycles  = floor(daysSinceStart / 91)` (completed full cycles).
 *  - `lastReviewDate` = episodeStart + reviewCycles*91 days, but only when
 *    at least one full cycle has elapsed (reviewCycles > 0); else null.
 *  - `nextDueDate`    = episodeStart + (reviewCycles+1)*91 days.
 *  - No episode start ⇒ both null.
 *  - `now` is injected so the function is pure/deterministic (unit-testable
 *    without machine-clock reliance), mirroring dueDateBuckets.ts.
 *
 * Regression-pinned by reviewCycle.test.ts and fix-registry anchor
 * R-FIX-PART6-REVIEW-CYCLE-UTIL.
 */

const DAY_MS = 86_400_000;
const REVIEW_CYCLE_DAYS = 91;

export interface ReviewCycle {
  /** ISO timestamp of the most recently completed 91-day review, or null. */
  lastReviewDate: string | null;
  /** ISO timestamp of the next 91-day review due date, or null. */
  nextDueDate: string | null;
}

/**
 * Compute the 91-day review cadence for an episode.
 *
 * @param episodeStart ISO date/timestamp string of the episode start (or the
 *   patient createdAt fallback the caller already resolved), or null.
 * @param now Injected current instant (keeps the function pure).
 */
export function compute91DayReviewCycle(
  episodeStart: string | null | undefined,
  now: Date,
): ReviewCycle {
  if (!episodeStart) return { lastReviewDate: null, nextDueDate: null };
  const startMs = new Date(episodeStart).getTime();
  if (!Number.isFinite(startMs)) return { lastReviewDate: null, nextDueDate: null };

  const daysSinceStart = Math.floor((now.getTime() - startMs) / DAY_MS);
  const reviewCycles = Math.floor(daysSinceStart / REVIEW_CYCLE_DAYS);

  const lastReviewDate =
    reviewCycles > 0
      ? new Date(startMs + reviewCycles * REVIEW_CYCLE_DAYS * DAY_MS).toISOString()
      : null;
  const nextDueDate = new Date(
    startMs + (reviewCycles + 1) * REVIEW_CYCLE_DAYS * DAY_MS,
  ).toISOString();

  return { lastReviewDate, nextDueDate };
}
