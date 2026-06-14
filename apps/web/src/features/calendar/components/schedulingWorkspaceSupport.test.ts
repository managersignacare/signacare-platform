import { describe, expect, it } from 'vitest';
import type { AvailabilityBlock } from '@signacare/shared';
import {
  buildRescheduledTimes,
  getAvailabilityColourForSlot,
  getAvailabilitySummaryForDate,
  listAvailabilityBlocksForSlot,
  listAvailabilityBlocksForDate,
  matchesSchedulingSearch,
  summarizeAvailabilityForSlot,
} from './schedulingWorkspaceSupport';

function block(overrides: Partial<AvailabilityBlock>): AvailabilityBlock {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    clinicianId: '22222222-2222-2222-2222-222222222222',
    colour: 'green',
    recurrence: 'weekly',
    dayOfWeek: 1,
    specificDate: null,
    startTime: '09:00',
    endTime: '11:00',
    effectiveFrom: '2026-01-01',
    effectiveUntil: null,
    label: null,
    notes: null,
    ...overrides,
  };
}

describe('schedulingWorkspaceSupport', () => {
  it('preserves appointment duration when rescheduling to a new slot', () => {
    const result = buildRescheduledTimes(
      {
        startTime: '2026-06-13T09:00:00.000Z',
        endTime: '2026-06-13T09:45:00.000Z',
      },
      '2026-06-15',
      '11:00',
    );

    expect(result.startTime).toBe('2026-06-15T11:00:00.000Z');
    expect(result.endTime).toBe('2026-06-15T11:45:00.000Z');
  });

  it('keeps the existing time of day when month-drop rescheduling only changes the date', () => {
    const result = buildRescheduledTimes(
      {
        startTime: '2026-06-13T14:20:00.000Z',
        endTime: '2026-06-13T15:20:00.000Z',
      },
      '2026-06-18',
    );

    expect(result.startTime).toBe('2026-06-18T14:20:00.000Z');
    expect(result.endTime).toBe('2026-06-18T15:20:00.000Z');
  });

  it('matches search text across title, clinician, team, status, and attendees', () => {
    const appointment = {
      title: 'Psychiatrist Review',
      clinicianName: 'Dr Keane',
      teamName: 'North Ward',
      modeLabel: 'Telehealth',
      status: 'confirmed',
      patientId: 'patient-123',
      attendeeStaffNames: ['Nurse Rivera', 'Psychologist Khan'],
    };

    expect(matchesSchedulingSearch(appointment, 'telehealth')).toBe(true);
    expect(matchesSchedulingSearch(appointment, 'rivera')).toBe(true);
    expect(matchesSchedulingSearch(appointment, 'confirmed')).toBe(true);
    expect(matchesSchedulingSearch(appointment, 'south ward')).toBe(false);
  });

  it('lists weekly and date-specific time blocks for a calendar date', () => {
    const result = listAvailabilityBlocksForDate([
      block({ id: 'a', dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }),
      block({ id: 'b', recurrence: 'none', dayOfWeek: null, specificDate: '2026-06-15', startTime: '13:00', endTime: '14:00' }),
      block({ id: 'c', dayOfWeek: 2, startTime: '09:00', endTime: '10:00' }),
    ], '2026-06-15');

    expect(result.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('activates fortnightly rules only on matching cadence weeks', () => {
    const fortnightly = block({
      id: 'fortnightly',
      recurrence: 'fortnightly',
      dayOfWeek: 1,
      effectiveFrom: '2026-06-01',
      startTime: '09:00',
      endTime: '12:00',
    });

    expect(listAvailabilityBlocksForDate([fortnightly], '2026-06-15').map((entry) => entry.id)).toEqual(['fortnightly']);
    expect(listAvailabilityBlocksForDate([fortnightly], '2026-06-22')).toEqual([]);
  });

  it('summarizes availability with the highest-priority colour for a date', () => {
    const summary = getAvailabilitySummaryForDate([
      block({ id: 'green', colour: 'green', label: 'Clinic hours' }),
      block({ id: 'yellow', colour: 'yellow', label: 'Tentative MDT' }),
      block({ id: 'red', colour: 'red', label: 'Leave' }),
    ], '2026-06-15');

    expect(summary).toEqual({
      blockCount: 3,
      dominantColour: 'red',
      labels: ['Clinic hours', 'Tentative MDT', 'Leave'],
      primaryLabel: 'Leave',
    });
  });

  it('returns slot colour for overlapping availability blocks', () => {
    const colour = getAvailabilityColourForSlot([
      block({ colour: 'green', startTime: '08:00', endTime: '12:00' }),
      block({ colour: 'red', startTime: '09:30', endTime: '10:30' }),
    ], '2026-06-15', 9 * 60, 60);

    expect(colour).toBe('red');
  });

  it('lists the named availability blocks active for a slot', () => {
    const blocks = listAvailabilityBlocksForSlot([
      block({ id: 'green', colour: 'green', startTime: '08:00', endTime: '12:00', label: 'Clinic availability' }),
      block({ id: 'yellow', colour: 'yellow', startTime: '09:00', endTime: '09:30', label: 'Phone triage' }),
      block({ id: 'other-day', dayOfWeek: 2, label: 'Ignore me' }),
    ], '2026-06-15', 9 * 60, 30);

    expect(blocks.map((entry) => entry.label)).toEqual([
      'Clinic availability',
      'Phone triage',
    ]);
  });

  it('summarizes slot booking guidance with visible primary text and notes', () => {
    const summary = summarizeAvailabilityForSlot([
      block({
        id: 'green',
        colour: 'green',
        startTime: '08:00',
        endTime: '12:00',
        label: 'Bookable clinic hours',
        notes: 'Reception can fill these slots.',
      }),
      block({
        id: 'yellow',
        colour: 'yellow',
        startTime: '09:00',
        endTime: '10:00',
        label: 'Protected MDT window',
        notes: 'Book only if released by admin.',
      }),
    ], '2026-06-15', 9 * 60, 30);

    expect(summary).toEqual({
      dominantColour: 'yellow',
      labels: ['Bookable clinic hours', 'Protected MDT window'],
      notes: ['Reception can fill these slots.', 'Book only if released by admin.'],
      primaryLabel: 'Protected MDT window',
      primaryNote: 'Book only if released by admin.',
      primaryText: 'Protected MDT window',
    });
  });
});
