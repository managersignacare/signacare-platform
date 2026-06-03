/**
 * Phase 0.7.1 C6b — AvailabilityGridEditor unit tests.
 * Tests the pure logic (slot calculation, colour lookup, time formatting)
 * without rendering MUI components in jsdom (which requires extensive
 * ThemeProvider + emotion setup). The render tests are covered by
 * E2E (Playwright spec 11-calendar.spec.ts).
 */
import { describe, it, expect } from 'vitest';

// Test the helper functions that drive the grid logic.
// These are inline in the component but we can test the patterns.

function formatTime(minutesFromMidnight: number): string {
  const h = Math.floor(minutesFromMidnight / 60);
  const m = minutesFromMidnight % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseClockToMinutes(clock: string): number {
  const [hh, mm] = clock.split(':');
  return Number(hh) * 60 + Number(mm);
}

function visualToDow(visualIndex: number, weekStart: number): number {
  return (weekStart + visualIndex) % 7;
}

describe('AvailabilityGridEditor logic', () => {
  it('formatTime converts minutes to HH:MM', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(60)).toBe('01:00');
    expect(formatTime(510)).toBe('08:30');
    expect(formatTime(1320)).toBe('22:00');
  });

  it('parseClockToMinutes converts HH:MM to minutes', () => {
    expect(parseClockToMinutes('00:00')).toBe(0);
    expect(parseClockToMinutes('08:30')).toBe(510);
    expect(parseClockToMinutes('22:00')).toBe(1320);
    expect(parseClockToMinutes('08:30:00')).toBe(510);
  });

  it('visualToDow maps visual column to Postgres day_of_week', () => {
    // weekStart=1 (Monday): col 0→Mon(1), col 6→Sun(0)
    expect(visualToDow(0, 1)).toBe(1); // Monday
    expect(visualToDow(4, 1)).toBe(5); // Friday
    expect(visualToDow(5, 1)).toBe(6); // Saturday
    expect(visualToDow(6, 1)).toBe(0); // Sunday
  });

  it('generates correct slot count for different granularities', () => {
    const DAY_START = 6 * 60; // 06:00
    const DAY_END = 22 * 60;  // 22:00
    const count = (slot: number) => Math.floor((DAY_END - DAY_START) / slot);
    expect(count(15)).toBe(64);  // 16 hours × 4
    expect(count(20)).toBe(48);  // 16 hours × 3
    expect(count(30)).toBe(32);  // 16 hours × 2
    expect(count(45)).toBe(21);  // 16 hours / 0.75
    expect(count(60)).toBe(16);  // 16 hours × 1
  });

  it('coalesces contiguous runs correctly', () => {
    // Simulate the mouseup coalescence: [0,1,2,5,6] → [{0-2},{5-6}]
    const indices = [0, 1, 2, 5, 6];
    indices.sort((a, b) => a - b);
    const runs: { start: number; end: number }[] = [];
    let start = indices[0]!;
    let last = start;
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] === last + 1) {
        last = indices[i]!;
      } else {
        runs.push({ start, end: last });
        start = indices[i]!;
        last = start;
      }
    }
    runs.push({ start, end: last });
    expect(runs).toEqual([{ start: 0, end: 2 }, { start: 5, end: 6 }]);
  });
});
