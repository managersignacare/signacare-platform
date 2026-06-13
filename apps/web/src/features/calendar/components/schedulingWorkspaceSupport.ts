import type { AppointmentResponse } from '@signacare/shared';

export interface SchedulingSearchableAppointment {
  clinicianName: string;
  modeLabel: string;
  patientId: string;
  status: string;
  teamName: string;
  title: string;
  attendeeStaffNames?: string[];
}

export function buildRescheduledTimes(
  appointment: Pick<AppointmentResponse, 'endTime' | 'startTime'>,
  targetDate: string,
  targetStartTime?: string,
): { endTime: string; startTime: string } {
  const existingStart = new Date(appointment.startTime);
  const existingEnd = new Date(appointment.endTime);
  const durationMs = Math.max(15 * 60_000, existingEnd.getTime() - existingStart.getTime());
  const fallbackTime = appointment.startTime.slice(11, 16);
  const nextStart = new Date(`${targetDate}T${targetStartTime ?? fallbackTime}:00Z`);
  const nextEnd = new Date(nextStart.getTime() + durationMs);
  return {
    startTime: nextStart.toISOString(),
    endTime: nextEnd.toISOString(),
  };
}

export function matchesSchedulingSearch(
  appointment: SchedulingSearchableAppointment,
  rawSearchTerm: string,
): boolean {
  const normalized = rawSearchTerm.trim().toLocaleLowerCase();
  if (!normalized) {
    return true;
  }

  const haystack = [
    appointment.title,
    appointment.clinicianName,
    appointment.teamName,
    appointment.modeLabel,
    appointment.status,
    appointment.patientId,
    ...(appointment.attendeeStaffNames ?? []),
  ]
    .join(' ')
    .toLocaleLowerCase();

  return haystack.includes(normalized);
}
