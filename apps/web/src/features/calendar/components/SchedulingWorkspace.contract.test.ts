import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SchedulingWorkspace source contract', () => {
  const source = readFileSync(resolve(__dirname, './SchedulingWorkspace.tsx'), 'utf8');
  const calendarViewsSource = readFileSync(
    resolve(__dirname, './SchedulingWorkspaceCalendarViews.tsx'),
    'utf8',
  );

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
    expect(source).toContain('<TimeBlockingRulesDialog');
    expect(source).toContain('<TodayContactsView');
    expect(source).toContain('<ICalSubscribeCard');
    expect(source).toContain('Time blocking is integrated into the calendar above as green, yellow, and red overlays');
    expect(source).toContain('Manage Time Blocking');
  });

  it('degrades gracefully when auxiliary calendar panels fail', () => {
    expect(source).toContain('Failed to load appointments. Try refreshing.');
    expect(source).toContain('Appointments are loaded, but time blocking is temporarily unavailable.');
    expect(source).toContain("Today&apos;s contacts and workload summary are temporarily unavailable.");
  });

  it('supports mine, team, and clinic scheduling scopes', () => {
    expect(source).toContain('value="mine"');
    expect(source).toContain('value="team"');
    expect(source).toContain('value="clinic"');
  });

  it('keeps calendar, contacts, and DNA inside one My Calendar surface', () => {
    expect(source).toContain('value="calendar"');
    expect(source).toContain('value="contacts"');
    expect(source).toContain('value="dna"');
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
    expect(calendarViewsSource).toContain('draggable');
  });

  it('surfaces explicit refresh and sync setup controls in My Calendar', () => {
    expect(source).toContain('Refresh Calendar');
    expect(source).toContain('Sync Setup');
    expect(source).toContain('<ICalSubscribeCard onRefreshCalendar={refreshCalendarWorkspace} />');
  });

  it('loads the calendar page appointments through the calendar module surface', () => {
    expect(source).toContain('calendarApi');
    expect(source).toContain('listAppointments');
    expect(source).toContain("limit: '200'");
    expect(source).not.toContain('appointmentApi.list({');
  });

  it('renders time block placeholder text directly inside the calendar cells', () => {
    expect(calendarViewsSource).toContain('slotSummary.primaryText');
    expect(calendarViewsSource).toContain('slotSummary.notes[0]');
  });
});
