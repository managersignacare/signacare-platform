/**
 * Phase 0.7.1 C6b — Calendar query key factory test.
 * Verifies key structure matches CLAUDE.md §4.1 patterns so
 * mutation invalidations always hit the right cache entries.
 */
import { describe, it, expect } from 'vitest';
import { calendarKeys } from './queryKeys';

describe('calendarKeys factory', () => {
  it('all starts with "calendar"', () => {
    expect(calendarKeys.all[0]).toBe('calendar');
  });

  it('blocks key includes clinicianId', () => {
    const key = calendarKeys.blocks('c123');
    expect(key).toEqual(['calendar', 'blocks', 'c123']);
  });

  it('blocks key defaults to "me" when no clinicianId', () => {
    const key = calendarKeys.blocks();
    expect(key).toEqual(['calendar', 'blocks', 'me']);
  });

  it('today key includes clinicianId and date', () => {
    const key = calendarKeys.today('c123', '2026-04-16');
    expect(key).toEqual(['calendar', 'today', 'c123', '2026-04-16']);
  });

  it('today key is a prefix of all', () => {
    const all = calendarKeys.all;
    const today = calendarKeys.today('c1', '2026-04-16');
    expect(today[0]).toBe(all[0]);
  });
});
