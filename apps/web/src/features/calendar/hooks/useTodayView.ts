// apps/web/src/features/calendar/hooks/useTodayView.ts
//
// Phase 13 PR3 — read hook for the aggregate today-view endpoint.
// One query → blocks + appointments + DNAs + contacts + counts +
// clinician name. Refetches every minute so the day view stays
// fresh without requiring a manual refresh.

import { useQuery } from '@tanstack/react-query';
import { calendarApi } from '../services/calendarApi';
import { calendarKeys } from '../queryKeys';

export function useTodayView(params: {
  clinicianId?: string;
  date: string; // YYYY-MM-DD
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: calendarKeys.today(params.clinicianId, params.date),
    queryFn: () =>
      calendarApi.getToday({
        ...(params.clinicianId ? { clinicianId: params.clinicianId } : {}),
        date: params.date,
      }),
    enabled: params.enabled ?? true,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
