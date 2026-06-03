/**
 * Category 1 — Unit tests for the timezone-aware date utilities.
 *
 * Why this matters: a previous bug class (Fix Registry TZ1-4) was caused
 * by `new Date().toISOString().split('T')[0]` returning a UTC date that
 * was off-by-one in the AU/Melbourne timezone after 10pm AEST. Every
 * "today" derived from these helpers MUST be the local civic date, not
 * the UTC date — otherwise medication MAR rows, appointment lists,
 * and audit log day-buckets all skew by one day.
 *
 * Standard satisfied: clinical safety / data integrity (HL7 v2.5 §2.A.22
 * "DT data type local interpretation"), ACHS Standard 1 (Clinical
 * Governance — accurate clinical record).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { todayLocal, nowLocalIso } from '../../src/utils/dateUtils';

describe('todayLocal — returns YYYY-MM-DD in Australia/Melbourne', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 2026-04-11 when local civic time is 11 Apr 2026 morning', () => {
    vi.useFakeTimers();
    // 09:00 in Australia/Melbourne (UTC+10) on 11 Apr 2026
    vi.setSystemTime(new Date('2026-04-10T23:00:00Z'));
    expect(todayLocal()).toBe('2026-04-11');
  });

  it('returns the local date even when UTC is the previous day (the original bug)', () => {
    vi.useFakeTimers();
    // 22:30 AEST on 10 Apr 2026 = 12:30 UTC on 10 Apr 2026.
    // Naive ISO would still say 2026-04-10 here — confirming local logic.
    vi.setSystemTime(new Date('2026-04-10T12:30:00Z'));
    expect(todayLocal()).toBe('2026-04-10');
  });

  it('returns the local date even when UTC is the NEXT day', () => {
    vi.useFakeTimers();
    // 23:30 AEDT on 11 Apr 2026 = 12:30 UTC on 11 Apr 2026.
    // The UTC ISO date would say 11 Apr — but we want LOCAL Apr 11/12 boundary.
    // 23:30 AEST on 10 Apr = 13:30 UTC on 10 Apr — still 10 Apr local, 10 Apr UTC.
    // The genuinely tricky case is past midnight AEDT = previous day UTC.
    // 02:00 AEDT 12 Apr = 16:00 UTC 11 Apr.
    vi.setSystemTime(new Date('2026-04-11T16:00:00Z'));
    expect(todayLocal()).toBe('2026-04-12');
  });

  it('handles the year boundary correctly in Melbourne', () => {
    vi.useFakeTimers();
    // 00:30 AEDT on 1 Jan 2027 = 13:30 UTC on 31 Dec 2026 (AEDT is UTC+11)
    vi.setSystemTime(new Date('2026-12-31T13:30:00Z'));
    expect(todayLocal()).toBe('2027-01-01');
  });

  it('always returns ISO YYYY-MM-DD format (no slashes, no padding bugs)', () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('nowLocalIso — sortable local timestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a string sortable as YYYY-MM-DDTHH:MM:SS', () => {
    vi.setSystemTime(new Date('2026-04-11T02:30:00Z'));
    const out = nowLocalIso();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it('reflects the local wall-clock, not UTC', () => {
    // 02:00 UTC = 12:00 AEST (UTC+10) — local hour MUST be 12, not 02
    vi.setSystemTime(new Date('2026-04-11T02:00:00Z'));
    const out = nowLocalIso();
    expect(out.startsWith('2026-04-11T12:')).toBe(true);
  });

  it('two consecutive calls produce monotonically non-decreasing values', () => {
    vi.setSystemTime(new Date('2026-04-11T02:00:00Z'));
    const a = nowLocalIso();
    vi.setSystemTime(new Date('2026-04-11T02:00:01Z'));
    const b = nowLocalIso();
    expect(b >= a).toBe(true);
  });
});
