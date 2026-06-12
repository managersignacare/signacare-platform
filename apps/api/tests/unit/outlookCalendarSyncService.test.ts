import { describe, expect, it } from 'vitest';
import {
  buildAppointmentCancellationPatch,
  buildAppointmentPatchFromGraphEvent,
  buildOutlookCalendarSyncUrls,
  graphDateTimeToIso,
  isSubscriptionExpiringSoon,
} from '../../src/integrations/outlook/outlookCalendarSyncService';
import type { OutlookAppointmentSyncRow } from '../../src/integrations/outlook/outlookCalendarSyncRepository';

function makeAppointment(partial?: Partial<OutlookAppointmentSyncRow>): OutlookAppointmentSyncRow {
  const start = new Date('2026-06-20T00:00:00.000Z');
  const end = new Date('2026-06-20T00:30:00.000Z');
  return {
    id: 'appointment-1',
    clinic_id: 'clinic-1',
    patient_id: 'patient-1',
    clinician_id: 'staff-1',
    appointment_start: start,
    appointment_end: end,
    start_time: start,
    end_time: end,
    status: 'scheduled',
    mode: 'direct',
    telehealth: false,
    telehealth_url: null,
    notes: null,
    reminder_scheduled: true,
    reminder_sent: true,
    reminder_sent_at: new Date('2026-06-18T00:00:00.000Z'),
    outlook_event_id: 'event-1',
    outlook_change_key: 'change-1',
    ...partial,
  };
}

describe('outlookCalendarSyncService helpers', () => {
  it('builds public webhook URLs from API base URL', () => {
    const urls = buildOutlookCalendarSyncUrls('https://api.example.com');
    expect(urls.webhookUrl).toBe('https://api.example.com/api/v1/integrations/outlook/calendar-sync/webhook');
    expect(urls.lifecycleUrl).toBe(urls.webhookUrl);
  });

  it('normalises Graph UTC date-time values to ISO strings', () => {
    expect(
      graphDateTimeToIso({
        dateTime: '2026-06-20T10:15:00.0000000',
        timeZone: 'UTC',
      }),
    ).toBe('2026-06-20T10:15:00.000Z');
  });

  it('detects subscriptions inside the renewal window', () => {
    const now = new Date('2026-06-20T00:00:00.000Z');
    expect(isSubscriptionExpiringSoon(new Date('2026-06-20T12:00:00.000Z'), now)).toBe(true);
    expect(isSubscriptionExpiringSoon(new Date('2026-06-22T00:00:00.000Z'), now)).toBe(false);
  });

  it('builds an appointment patch that resets reminder flags when timing changes', () => {
    const appointment = makeAppointment();
    const patch = buildAppointmentPatchFromGraphEvent(
      appointment,
      {
        id: 'event-1',
        start: { dateTime: '2026-06-20T01:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-06-20T01:45:00.0000000', timeZone: 'UTC' },
        onlineMeeting: { joinUrl: 'https://teams.example/join' },
        changeKey: 'change-2',
        lastModifiedDateTime: '2026-06-19T23:00:00.000Z',
      },
      new Date('2026-06-19T23:01:00.000Z'),
    );

    expect(patch).not.toBeNull();
    expect(patch?.appointment_start.toISOString()).toBe('2026-06-20T01:00:00.000Z');
    expect(patch?.appointment_end.toISOString()).toBe('2026-06-20T01:45:00.000Z');
    expect(patch?.telehealth_url).toBe('https://teams.example/join');
    expect(patch?.mode).toBe('videoconference');
    expect(patch?.reminder_scheduled).toBe(false);
    expect(patch?.reminder_sent).toBe(false);
    expect(patch?.reminder_sent_at).toBeNull();
    expect(patch?.outlook_change_key).toBe('change-2');
    expect(patch?.outlook_sync_status).toBe('synced');
  });

  it('preserves reminder flags when the remote event timing is unchanged', () => {
    const reminderSentAt = new Date('2026-06-18T00:00:00.000Z');
    const appointment = makeAppointment({
      mode: 'telehealth',
      telehealth: true,
      telehealth_url: 'https://old.example/join',
      reminder_sent_at: reminderSentAt,
    });
    const patch = buildAppointmentPatchFromGraphEvent(
      appointment,
      {
        id: 'event-1',
        start: { dateTime: '2026-06-20T00:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-06-20T00:30:00.0000000', timeZone: 'UTC' },
        changeKey: 'change-3',
      },
      new Date('2026-06-19T23:01:00.000Z'),
    );

    expect(patch).not.toBeNull();
    expect(patch?.reminder_scheduled).toBe(true);
    expect(patch?.reminder_sent).toBe(true);
    expect(patch?.reminder_sent_at).toBe(reminderSentAt);
    expect(patch?.mode).toBe('telehealth');
    expect(patch?.telehealth_url).toBe('https://old.example/join');
  });

  it('builds a safe cancellation patch for remote deletions', () => {
    const patch = buildAppointmentCancellationPatch(new Date('2026-06-20T00:00:00.000Z'));
    expect(patch.status).toBe('cancelled');
    expect(patch.cancellation_reason).toBe('Cancelled in linked Outlook calendar');
    expect(patch.outlook_sync_status).toBe('deleted_remote');
    expect(patch.reminder_scheduled).toBe(false);
    expect(patch.reminder_sent).toBe(false);
    expect(patch.reminder_sent_at).toBeNull();
  });
});
