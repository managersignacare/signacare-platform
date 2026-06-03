// apps/web/src/features/receptionist/queryKeys.ts
// Phase 0.7 PR2 Class F — React Query key factory for receptionist (CLAUDE.md §4.1).
//
// Note: "tasks" and "staff-lookup" are cross-feature root namespaces also used
// by features/tasks and intake/patients flows. The literal root strings are
// preserved so invalidations from receptionist continue to match those caches.
export const receptionistKeys = {
  all: ['receptionist'] as const,
  schedule: (date: string) => ['reception-schedule', date] as const,
  checkinAppointments: (date: string) =>
    ['checkin-appointments', date] as const,
  checkinAppointmentsAll: () => ['checkin-appointments'] as const,
  checkinOutstanding: (appointmentId: string) =>
    ['checkin-outstanding', appointmentId] as const,
  checkinOutstandingAll: () => ['checkin-outstanding'] as const,
  phoneTriage: () => ['phone-triage'] as const,
  staffLookup: () => ['staff-lookup'] as const,
  tasks: () => ['tasks'] as const,
  waitlistPositions: () => ['waitlist-positions'] as const,
  smsReminderAppts: (targetDate: string) =>
    ['sms-reminder-appts', targetDate] as const,
} as const;
