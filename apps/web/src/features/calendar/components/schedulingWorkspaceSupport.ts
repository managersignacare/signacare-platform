import type { AppointmentResponse, AvailabilityBlock, AvailabilityColour } from '@signacare/shared';

export interface SchedulingSearchableAppointment {
  clinicianName: string;
  modeLabel: string;
  patientId: string;
  status: string;
  teamName: string;
  title: string;
  attendeeStaffNames?: string[];
}

export interface SchedulingAvailabilitySummary {
  blockCount: number;
  dominantColour: AvailabilityColour | null;
  labels: string[];
}

export interface SchedulingAvailabilitySlotSummary {
  dominantColour: AvailabilityColour | null;
  labels: string[];
  notes: string[];
  primaryText: string | null;
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

function toMinutes(clock: string): number {
  const [hh, mm] = clock.split(':');
  return (Number(hh) * 60) + Number(mm);
}

function dayOfWeekForIsoDate(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00`).getDay();
}

function isBlockActiveOnDate(block: AvailabilityBlock, isoDate: string): boolean {
  if (block.effectiveFrom > isoDate) {
    return false;
  }
  if (block.effectiveUntil && block.effectiveUntil < isoDate) {
    return false;
  }
  if (block.recurrence === 'none') {
    return block.specificDate === isoDate;
  }
  return block.dayOfWeek === dayOfWeekForIsoDate(isoDate);
}

export function listAvailabilityBlocksForDate(
  blocks: readonly AvailabilityBlock[],
  isoDate: string,
): AvailabilityBlock[] {
  return blocks.filter((block) => isBlockActiveOnDate(block, isoDate));
}

export function listAvailabilityBlocksForSlot(
  blocks: readonly AvailabilityBlock[],
  isoDate: string,
  slotStartMinutes: number,
  slotDurationMinutes: number,
): AvailabilityBlock[] {
  const slotEndMinutes = slotStartMinutes + slotDurationMinutes;
  return listAvailabilityBlocksForDate(blocks, isoDate).filter((block) => {
    const start = toMinutes(block.startTime);
    const end = toMinutes(block.endTime);
    return start < slotEndMinutes && end > slotStartMinutes;
  });
}

export function getAvailabilitySummaryForDate(
  blocks: readonly AvailabilityBlock[],
  isoDate: string,
): SchedulingAvailabilitySummary {
  const active = listAvailabilityBlocksForDate(blocks, isoDate);
  if (active.length === 0) {
    return { blockCount: 0, dominantColour: null, labels: [] };
  }

  const priority: AvailabilityColour[] = ['red', 'yellow', 'green'];
  const dominantColour =
    priority.find((colour) => active.some((block) => block.colour === colour)) ?? null;

  return {
    blockCount: active.length,
    dominantColour,
    labels: active
      .map((block) => block.label?.trim())
      .filter((label): label is string => Boolean(label)),
  };
}

export function getAvailabilityColourForSlot(
  blocks: readonly AvailabilityBlock[],
  isoDate: string,
  slotStartMinutes: number,
  slotDurationMinutes: number,
): AvailabilityColour | null {
  const active = listAvailabilityBlocksForSlot(
    blocks,
    isoDate,
    slotStartMinutes,
    slotDurationMinutes,
  );

  if (active.some((block) => block.colour === 'red')) return 'red';
  if (active.some((block) => block.colour === 'yellow')) return 'yellow';
  if (active.some((block) => block.colour === 'green')) return 'green';
  return null;
}

export function summarizeAvailabilityForSlot(
  blocks: readonly AvailabilityBlock[],
  isoDate: string,
  slotStartMinutes: number,
  slotDurationMinutes: number,
): SchedulingAvailabilitySlotSummary {
  const active = listAvailabilityBlocksForSlot(
    blocks,
    isoDate,
    slotStartMinutes,
    slotDurationMinutes,
  );

  const labels = active
    .map((block) => block.label?.trim() ?? '')
    .filter((value): value is string => value.length > 0);
  const notes = active
    .map((block) => block.notes?.trim() ?? '')
    .filter((value): value is string => value.length > 0);

  const primaryText = labels[0] ?? notes[0] ?? null;

  return {
    dominantColour: getAvailabilityColourForSlot(
      blocks,
      isoDate,
      slotStartMinutes,
      slotDurationMinutes,
    ),
    labels,
    notes,
    primaryText,
  };
}
