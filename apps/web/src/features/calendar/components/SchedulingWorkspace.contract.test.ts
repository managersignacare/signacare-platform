import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SchedulingWorkspace source contract', () => {
  const source = readFileSync(resolve(__dirname, './SchedulingWorkspace.tsx'), 'utf8');

  it('pins My Calendar as the unified scheduling surface', () => {
    expect(source).toContain('One scheduling surface for clinician, team, and clinic appointments');
    expect(source).toContain('New Appointment');
  });

  it('keeps the five scheduling views on the one page', () => {
    expect(source).toContain('value="month"');
    expect(source).toContain('value="day"');
    expect(source).toContain('value="workweek"');
    expect(source).toContain('value="week"');
    expect(source).toContain('value="list"');
  });

  it('keeps appointments and time blocking on the same page', () => {
    expect(source).toContain('<AvailabilityGridEditor');
    expect(source).toContain('<TodayContactsView');
    expect(source).toContain('<ICalSubscribeCard');
  });

  it('supports mine, team, and clinic scheduling scopes', () => {
    expect(source).toContain('value="mine"');
    expect(source).toContain('value="team"');
    expect(source).toContain('value="clinic"');
  });

  it('supports slot creation and appointment details from the same workspace', () => {
    expect(source).toContain('<AppointmentDetailsDrawer');
    expect(source).toContain('onCreateSlot');
    expect(source).toContain('handleOpenNew({ date, startTime })');
  });

  it('supports calendar search, status filtering, and drag-drop rescheduling', () => {
    expect(source).toContain('label="Status"');
    expect(source).toContain('label="Search"');
    expect(source).toContain('handleDropAppointment');
    expect(source).toContain('draggable');
  });
});
