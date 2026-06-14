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
  primaryLabel: string | null;
}

export interface SchedulingAvailabilitySlotSummary {
  dominantColour: AvailabilityColour | null;
  labels: string[];
  notes: string[];
  primaryLabel: string | null;
  primaryNote: string | null;
  primaryText: string | null;
}

function sortBlocksByPriority(
  blocks: readonly AvailabilityBlock[],
): AvailabilityBlock[] {
  const priority = new Map<AvailabilityColour, number>([
    ['red', 0],
    ['yellow', 1],
    ['green', 2],
  ]);
  return [...blocks].sort((left, right) => {
    const leftRank = priority.get(left.colour) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = priority.get(right.colour) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
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

function firstOccurrenceOnOrAfter(
  isoDate: string,
  targetDayOfWeek: number,
): string {
  const base = new Date(`${isoDate}T00:00:00Z`);
  const current = base.getUTCDay();
  const delta = (targetDayOfWeek - current + 7) % 7;
  const out = new Date(base);
  out.setUTCDate(base.getUTCDate() + delta);
  return out.toISOString().slice(0, 10);
}

function isFortnightBoundary(anchorIsoDate: string, candidateIsoDate: string): boolean {
  const anchor = new Date(`${anchorIsoDate}T00:00:00Z`);
  const candidate = new Date(`${candidateIsoDate}T00:00:00Z`);
  const diffDays = Math.floor((candidate.getTime() - anchor.getTime()) / 86_400_000);
  return diffDays >= 0 && diffDays % 14 === 0;
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
  if (block.recurrence === 'fortnightly') {
    if (block.dayOfWeek !== dayOfWeekForIsoDate(isoDate) || block.dayOfWeek === null) {
      return false;
    }
    const anchor = firstOccurrenceOnOrAfter(block.effectiveFrom, block.dayOfWeek);
    return isFortnightBoundary(anchor, isoDate);
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
    return { blockCount: 0, dominantColour: null, labels: [], primaryLabel: null };
  }

  const priority: AvailabilityColour[] = ['red', 'yellow', 'green'];
  const dominantColour =
    priority.find((colour) => active.some((block) => block.colour === colour)) ?? null;
  const prioritized = sortBlocksByPriority(active);
  const primaryLabel =
    prioritized
      .map((block) => block.label?.trim() ?? '')
      .find((label) => label.length > 0) ?? null;

  return {
    blockCount: active.length,
    dominantColour,
    labels: active
      .map((block) => block.label?.trim())
      .filter((label): label is string => Boolean(label)),
    primaryLabel,
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
  const prioritized = sortBlocksByPriority(active);

  const labels = active
    .map((block) => block.label?.trim() ?? '')
    .filter((value): value is string => value.length > 0);
  const notes = active
    .map((block) => block.notes?.trim() ?? '')
    .filter((value): value is string => value.length > 0);
  const primaryLabel =
    prioritized
      .map((block) => block.label?.trim() ?? '')
      .find((value) => value.length > 0) ?? null;
  const primaryNote =
    prioritized
      .map((block) => block.notes?.trim() ?? '')
      .find((value) => value.length > 0) ?? null;
  const primaryText = primaryLabel ?? primaryNote;

  return {
    dominantColour: getAvailabilityColourForSlot(
      blocks,
      isoDate,
      slotStartMinutes,
      slotDurationMinutes,
    ),
    labels,
    notes,
    primaryLabel,
    primaryNote,
    primaryText,
  };
}
