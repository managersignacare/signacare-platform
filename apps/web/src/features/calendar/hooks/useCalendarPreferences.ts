// apps/web/src/features/calendar/hooks/useCalendarPreferences.ts
//
// Phase 13 PR3 — read + write hooks for the per-clinician calendar
// preferences blob (slotMinutes, weekStart, icalToken). The grid
// editor reads slotMinutes to decide row granularity; the iCal card
// reads icalToken to render the subscribe URL.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CalendarPreferences } from '@signacare/shared';
import { calendarApi } from '../services/calendarApi';
import { calendarKeys } from '../queryKeys';

export function useCalendarPreferences() {
  return useQuery({
    queryKey: calendarKeys.preferences(),
    queryFn: () => calendarApi.getPreferences(),
    staleTime: 60_000,
  });
}

export function useUpdateCalendarPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<CalendarPreferences>) =>
      calendarApi.updatePreferences(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.preferences() });
    },
  });
}

export function useRotateIcalToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => calendarApi.rotateIcalToken(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.preferences() });
      qc.invalidateQueries({ queryKey: calendarKeys.ical() });
    },
  });
}
