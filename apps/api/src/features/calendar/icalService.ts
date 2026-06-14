// apps/api/src/features/calendar/icalService.ts
//
// Phase 13 PR2c — VCALENDAR builder for the public iCal
// subscription endpoint.
//
// What it ships:
//
//   buildCalendarIcs({ clinicianName, clinicTimeZone, blocks })
//     → a `text/calendar` body string suitable for returning
//       directly from a route handler. Uses the `ical-generator`
//       package (pinned 7.2.0 in apps/api/package.json by PR2a).
//
// Colour → VEVENT mapping (from the Phase 13 plan):
//
//   red    → STATUS:CONFIRMED   TRANSP:OPAQUE       SUMMARY:'Unavailable'
//   yellow → STATUS:TENTATIVE   TRANSP:TRANSPARENT  SUMMARY:'Tentative — contact clinician before booking'
//   green  → STATUS:CONFIRMED   TRANSP:TRANSPARENT  SUMMARY:'Available'
//
// Weekly recurrence maps `day_of_week` (0=Sun..6=Sat) to the
// ical-generator `ICalWeekday` enum. One-off blocks (recurrence='none')
// use the `specific_date` as both start and end date.
//
// This module does NOT handle HTTP, auth, or rate limiting — the
// route handler in calendarIcalPublicRoutes.ts owns those. The
// service is pure: it takes a typed input and returns a string,
// no side effects, testable without any Express or DB machinery.

import ical, {
  ICalCalendar,
  ICalEventStatus,
  ICalEventTransparency,
  ICalEventRepeatingFreq,
  ICalWeekday,
} from 'ical-generator';
import type { AvailabilityBlock } from '@signacare/shared';

export interface IcsBuildInput {
  readonly clinicId: string;
  readonly clinicianId: string;
  readonly clinicianName: string;
  readonly clinicTimeZone: string;
  readonly blocks: readonly AvailabilityBlock[];
}

interface ColourMeta {
  readonly summary: string;
  readonly status: ICalEventStatus;
  readonly transparency: ICalEventTransparency;
  readonly category: string;
}

const COLOUR_META: Record<'red' | 'yellow' | 'green', ColourMeta> = {
  red: {
    summary: 'Unavailable',
    status: ICalEventStatus.CONFIRMED,
    transparency: ICalEventTransparency.OPAQUE,
    category: 'UNAVAILABLE',
  },
  yellow: {
    summary: 'Tentative — contact clinician before booking',
    status: ICalEventStatus.TENTATIVE,
    transparency: ICalEventTransparency.TRANSPARENT,
    category: 'TENTATIVE',
  },
  green: {
    summary: 'Available',
    status: ICalEventStatus.CONFIRMED,
    transparency: ICalEventTransparency.TRANSPARENT,
    category: 'AVAILABLE',
  },
};

const DAY_OF_WEEK_MAP: Record<number, ICalWeekday> = {
  0: ICalWeekday.SU,
  1: ICalWeekday.MO,
  2: ICalWeekday.TU,
  3: ICalWeekday.WE,
  4: ICalWeekday.TH,
  5: ICalWeekday.FR,
  6: ICalWeekday.SA,
};

/**
 * Combine an ISO date (YYYY-MM-DD) and a time-of-day (HH:MM[:SS])
 * into a Date interpretable as "that wall-clock time on that date".
 * ical-generator's timezone handling then renders each event under
 * the clinic's VTIMEZONE block so subscribers see the right local
 * time regardless of their viewer's zone.
 */
function combineDateAndTime(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map((s) => parseInt(s, 10));
  const parts = time.split(':').map((s) => parseInt(s, 10));
  const hh = parts[0] ?? 0;
  const mm = parts[1] ?? 0;
  const ss = parts[2] ?? 0;
  return new Date(y, (m ?? 1) - 1, d ?? 1, hh, mm, ss, 0);
}

/**
 * Build an iCal VCALENDAR string for a clinician's availability.
 * Returns the full RFC 5545 text body — route handlers set
 * Content-Type: text/calendar and write the body directly.
 */
export function buildCalendarIcs(input: IcsBuildInput): string {
  const cal: ICalCalendar = ical({
    name: `${input.clinicianName} — Signacare`,
    prodId: {
      company: 'Signacare',
      product: 'EMR Calendar',
      language: 'EN',
    },
    timezone: input.clinicTimeZone,
    // A subscriber re-fetches the calendar on a schedule. The
    // PUBLISH method says "this is a one-way feed" so clients
    // don't try to reply to invitations.
    method: 'PUBLISH' as never,
  });

  for (const block of input.blocks) {
    const meta = COLOUR_META[block.colour];
    if (!meta) continue;

    if (block.recurrence === 'weekly' || block.recurrence === 'fortnightly') {
      // Weekly block — need a reference start date to anchor the
      // RRULE. Use `effective_from` so the first occurrence is
      // the first matching weekday on or after that date.
      if (block.dayOfWeek === null) continue;
      const weekday = DAY_OF_WEEK_MAP[block.dayOfWeek];
      if (!weekday) continue;

      const anchorDate = firstOccurrenceOnOrAfter(
        block.effectiveFrom,
        block.dayOfWeek,
      );
      const start = combineDateAndTime(anchorDate, block.startTime);
      const end = combineDateAndTime(anchorDate, block.endTime);

      cal.createEvent({
        id: block.id,
        start,
        end,
        timezone: input.clinicTimeZone,
        summary: block.label ?? meta.summary,
        description: block.notes ?? meta.summary,
        status: meta.status,
        transparency: meta.transparency,
        categories: [{ name: meta.category }],
        repeating: {
          freq: ICalEventRepeatingFreq.WEEKLY,
          interval: block.recurrence === 'fortnightly' ? 2 : 1,
          byDay: [weekday],
          until: block.effectiveUntil
            ? combineDateAndTime(block.effectiveUntil, '23:59:59')
            : undefined,
        },
      });
    } else {
      // One-off block — no RRULE, single VEVENT on specific_date.
      if (!block.specificDate) continue;
      const start = combineDateAndTime(block.specificDate, block.startTime);
      const end = combineDateAndTime(block.specificDate, block.endTime);
      cal.createEvent({
        id: block.id,
        start,
        end,
        timezone: input.clinicTimeZone,
        summary: block.label ?? meta.summary,
        description: block.notes ?? meta.summary,
        status: meta.status,
        transparency: meta.transparency,
        categories: [{ name: meta.category }],
      });
    }
  }

  return cal.toString();
}

/**
 * Given an ISO date (YYYY-MM-DD) and a target day-of-week
 * (0=Sun..6=Sat), return the ISO date of the first occurrence of
 * that weekday on or after the input date. Pure, deterministic,
 * timezone-independent (date arithmetic only).
 */
export function firstOccurrenceOnOrAfter(
  isoDate: string,
  targetDayOfWeek: number,
): string {
  const [y, m, d] = isoDate.split('-').map((s) => parseInt(s, 10));
  const base = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const current = base.getUTCDay();
  const delta = (targetDayOfWeek - current + 7) % 7;
  const out = new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate() + delta,
    ),
  );
  const yy = out.getUTCFullYear();
  const mm = String(out.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(out.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
