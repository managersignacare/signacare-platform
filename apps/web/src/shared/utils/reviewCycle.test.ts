import { describe, it, expect } from 'vitest';
import { compute91DayReviewCycle } from './reviewCycle';

const DAY_MS = 86_400_000;

/**
 * Reference implementation = the EXACT inline arithmetic that previously
 * lived in ClinicalListPage.tsx (lines 452-455 pre-PART-6-DoD#5). The
 * extraction is correct iff the helper is byte-identical to this for every
 * input — that is the regression pin (proves "behaviour-preserving").
 */
function inlineReference(episodeStart: string | null, now: Date) {
  const episodeStartDate = episodeStart ? new Date(episodeStart) : null;
  const daysSinceStart = episodeStartDate
    ? Math.floor((now.getTime() - episodeStartDate.getTime()) / DAY_MS)
    : 0;
  const reviewCycles = Math.floor(daysSinceStart / 91);
  const lastReviewDate =
    reviewCycles > 0 && episodeStartDate
      ? new Date(episodeStartDate.getTime() + reviewCycles * 91 * DAY_MS).toISOString()
      : null;
  const nextDueDate = episodeStartDate
    ? new Date(episodeStartDate.getTime() + (reviewCycles + 1) * 91 * DAY_MS).toISOString()
    : null;
  return { lastReviewDate, nextDueDate };
}

describe('compute91DayReviewCycle — null / invalid inputs', () => {
  it('no episode start ⇒ both null', () => {
    expect(compute91DayReviewCycle(null, new Date())).toEqual({ lastReviewDate: null, nextDueDate: null });
    expect(compute91DayReviewCycle(undefined, new Date())).toEqual({ lastReviewDate: null, nextDueDate: null });
  });
  it('unparseable episode start ⇒ both null (does not throw / RangeError)', () => {
    expect(compute91DayReviewCycle('not-a-date', new Date())).toEqual({ lastReviewDate: null, nextDueDate: null });
  });
});

describe('compute91DayReviewCycle — cadence boundaries', () => {
  const start = '2026-01-01T00:00:00.000Z';
  const startMs = new Date(start).getTime();

  it('before first cycle (day 0): no last review, next = start + 91d', () => {
    const r = compute91DayReviewCycle(start, new Date(start));
    expect(r.lastReviewDate).toBeNull();
    expect(r.nextDueDate).toBe(new Date(startMs + 91 * DAY_MS).toISOString());
  });

  it('day 90 (still cycle 0): last null, next = start + 91d', () => {
    const r = compute91DayReviewCycle(start, new Date(startMs + 90 * DAY_MS));
    expect(r.lastReviewDate).toBeNull();
    expect(r.nextDueDate).toBe(new Date(startMs + 91 * DAY_MS).toISOString());
  });

  it('exactly day 91 (cycle 1): last = start + 91d, next = start + 182d', () => {
    const r = compute91DayReviewCycle(start, new Date(startMs + 91 * DAY_MS));
    expect(r.lastReviewDate).toBe(new Date(startMs + 91 * DAY_MS).toISOString());
    expect(r.nextDueDate).toBe(new Date(startMs + 182 * DAY_MS).toISOString());
  });

  it('day 200 (cycle 2): last = start + 182d, next = start + 273d', () => {
    const r = compute91DayReviewCycle(start, new Date(startMs + 200 * DAY_MS));
    expect(r.lastReviewDate).toBe(new Date(startMs + 182 * DAY_MS).toISOString());
    expect(r.nextDueDate).toBe(new Date(startMs + 273 * DAY_MS).toISOString());
  });

  it('episode start in the future (now < start): cycles floor-negative, matches reference', () => {
    const r = compute91DayReviewCycle(start, new Date(startMs - 5 * DAY_MS));
    expect(r).toEqual(inlineReference(start, new Date(startMs - 5 * DAY_MS)));
  });
});

describe('compute91DayReviewCycle — byte-identical to the removed inline code (regression pin)', () => {
  it('matches the inline reference across a fuzz of (start, now) pairs spanning 3 years', () => {
    const base = Date.UTC(2025, 0, 1);
    for (let startOffset = 0; startOffset < 1095; startOffset += 7) {
      const start = new Date(base + startOffset * DAY_MS).toISOString();
      for (let dn = 0; dn < 1095; dn += 13) {
        const now = new Date(base + (startOffset + dn) * DAY_MS);
        expect(compute91DayReviewCycle(start, now)).toEqual(inlineReference(start, now));
      }
    }
  });
});
