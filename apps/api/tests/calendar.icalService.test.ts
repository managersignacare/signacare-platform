import { describe, it, expect } from 'vitest';
import {
  buildCalendarIcs,
  firstOccurrenceOnOrAfter,
} from '../src/features/calendar/icalService';
import type { AvailabilityBlock } from '@signacare/shared';

// Phase 13 PR2c — unit tests for icalService. Pure function,
// no DB, no network. Covers:
//
//  - RFC 5545 structural basics (BEGIN:VCALENDAR, VEVENT, END:VCALENDAR)
//  - colour → SUMMARY/STATUS/TRANSP mapping
//  - weekly RRULE generation + BYDAY
//  - one-off event on specific_date
//  - firstOccurrenceOnOrAfter date arithmetic

function makeBlock(overrides: Partial<AvailabilityBlock>): AvailabilityBlock {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    clinicianId: '22222222-2222-2222-2222-222222222222',
    colour: 'green',
    recurrence: 'weekly',
    dayOfWeek: 1,
    specificDate: null,
    startTime: '09:00',
    endTime: '12:00',
    effectiveFrom: '2026-04-13',
    effectiveUntil: null,
    label: null,
    notes: null,
    ...overrides,
  };
}

const base = {
  clinicId: '33333333-3333-3333-3333-333333333333',
  clinicianId: '22222222-2222-2222-2222-222222222222',
  clinicianName: 'Dr Jane Test',
  clinicTimeZone: 'Australia/Melbourne',
};

describe('icalService — firstOccurrenceOnOrAfter', () => {
  it('same-weekday input returns same date', () => {
    // 2026-04-13 is a Monday (day 1)
    expect(firstOccurrenceOnOrAfter('2026-04-13', 1)).toBe('2026-04-13');
  });

  it('later-weekday in same week', () => {
    // 2026-04-13 Monday → next Wednesday (day 3)
    expect(firstOccurrenceOnOrAfter('2026-04-13', 3)).toBe('2026-04-15');
  });

  it('earlier-weekday wraps to next week', () => {
    // 2026-04-13 Monday → next Sunday (day 0)
    expect(firstOccurrenceOnOrAfter('2026-04-13', 0)).toBe('2026-04-19');
  });

  it('Saturday input targeting Sunday wraps', () => {
    // 2026-04-11 is Saturday (day 6) → next Sun is 2026-04-12
    expect(firstOccurrenceOnOrAfter('2026-04-11', 0)).toBe('2026-04-12');
  });
});

describe('icalService — buildCalendarIcs structural', () => {
  it('emits a well-formed empty VCALENDAR for zero blocks', () => {
    const ics = buildCalendarIcs({ ...base, blocks: [] });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('PRODID:');
    expect(ics).toContain('METHOD:PUBLISH');
    // No VEVENT in an empty calendar
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('emits the clinician name in the calendar NAME property', () => {
    const ics = buildCalendarIcs({ ...base, blocks: [] });
    expect(ics).toContain('Dr Jane Test');
  });

  it('emits one VEVENT for one block', () => {
    const ics = buildCalendarIcs({ ...base, blocks: [makeBlock({})] });
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
  });

  it('emits one VEVENT per block for multiple blocks', () => {
    const ics = buildCalendarIcs({
      ...base,
      blocks: [
        makeBlock({ id: 'a', dayOfWeek: 1, colour: 'green' }),
        makeBlock({ id: 'b', dayOfWeek: 3, colour: 'yellow' }),
        makeBlock({ id: 'c', dayOfWeek: 5, colour: 'red' }),
      ],
    });
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(3);
  });
});

describe('icalService — colour → VEVENT mapping', () => {
  it('green block is CONFIRMED + TRANSPARENT + summary "Available"', () => {
    const ics = buildCalendarIcs({
      ...base,
      blocks: [makeBlock({ colour: 'green' })],
    });
    expect(ics).toContain('SUMMARY:Available');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('TRANSP:TRANSPARENT');
  });

  it('yellow block is TENTATIVE + TRANSPARENT + "Tentative — contact clinician"', () => {
    const ics = buildCalendarIcs({
      ...base,
      blocks: [makeBlock({ colour: 'yellow' })],
    });
    expect(ics).toContain('Tentative');
    expect(ics).toContain('STATUS:TENTATIVE');
    expect(ics).toContain('TRANSP:TRANSPARENT');
  });

  it('red block is CONFIRMED + OPAQUE + summary "Unavailable"', () => {
    const ics = buildCalendarIcs({
      ...base,
      blocks: [makeBlock({ colour: 'red' })],
    });
    expect(ics).toContain('SUMMARY:Unavailable');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('TRANSP:OPAQUE');
  });

  it('block with a label overrides the colour-default summary', () => {
    const ics = buildCalendarIcs({
      ...base,
      blocks: [makeBlock({ colour: 'green', label: 'Clozapine clinic' })],
    });
    expect(ics).toContain('SUMMARY:Clozapine clinic');
    expect(ics).not.toContain('SUMMARY:Available');
  });
});

describe('icalService — weekly recurrence', () => {
  it('weekly block emits an RRULE with FREQ=WEEKLY', () => {
    const ics = buildCalendarIcs({
      ...base,
      blocks: [makeBlock({ recurrence: 'weekly', dayOfWeek: 1 })],
    });
    expect(ics).toContain('RRULE:');
    expect(ics).toContain('FREQ=WEEKLY');
  });

  it('RRULE includes BYDAY matching the dayOfWeek', () => {
    const ics = buildCalendarIcs({
      ...base,
      blocks: [makeBlock({ recurrence: 'weekly', dayOfWeek: 3 })], // WE
    });
    expect(ics).toMatch(/BYDAY=WE/);
  });

  it('block with effectiveUntil emits UNTIL in RRULE', () => {
    const ics = buildCalendarIcs({
      ...base,
      blocks: [
        makeBlock({
          recurrence: 'weekly',
          dayOfWeek: 1,
          effectiveUntil: '2026-12-31',
        }),
      ],
    });
    expect(ics).toContain('UNTIL=');
  });
});

describe('icalService — one-off blocks', () => {
  it('recurrence=none emits a VEVENT with NO RRULE', () => {
    const ics = buildCalendarIcs({
      ...base,
      blocks: [
        makeBlock({
          recurrence: 'none',
          dayOfWeek: null,
          specificDate: '2026-04-20',
        }),
      ],
    });
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).not.toContain('RRULE:');
  });

  it('skips malformed weekly block with null dayOfWeek', () => {
    const ics = buildCalendarIcs({
      ...base,
      blocks: [
        makeBlock({ recurrence: 'weekly', dayOfWeek: null }),
        makeBlock({ id: 'b', recurrence: 'weekly', dayOfWeek: 1 }),
      ],
    });
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
  });

  it('skips malformed one-off block with null specificDate', () => {
    const ics = buildCalendarIcs({
      ...base,
      blocks: [
        makeBlock({ recurrence: 'none', dayOfWeek: null, specificDate: null }),
        makeBlock({
          id: 'b',
          recurrence: 'none',
          dayOfWeek: null,
          specificDate: '2026-04-20',
        }),
      ],
    });
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
  });
});

describe('icalService — determinism', () => {
  it('same input produces same ICS output (modulo DTSTAMP)', () => {
    const blocks = [
      makeBlock({ id: 'a', colour: 'green', dayOfWeek: 1 }),
      makeBlock({ id: 'b', colour: 'red', dayOfWeek: 3 }),
    ];
    const a = buildCalendarIcs({ ...base, blocks }).replace(
      /DTSTAMP:\S+/g,
      'DTSTAMP:XXX',
    );
    const b = buildCalendarIcs({ ...base, blocks }).replace(
      /DTSTAMP:\S+/g,
      'DTSTAMP:XXX',
    );
    expect(a).toBe(b);
  });
});
