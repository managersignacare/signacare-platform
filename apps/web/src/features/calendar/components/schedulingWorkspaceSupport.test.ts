import { describe, expect, it } from 'vitest';
import { buildRescheduledTimes, matchesSchedulingSearch } from './schedulingWorkspaceSupport';

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
});
