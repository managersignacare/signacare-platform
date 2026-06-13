// apps/web/src/features/calendar/services/calendarApi.ts
//
// Phase 13 PR2b pre-stage — the typed apiClient wrappers for the
// backend calendar routes mounted at /api/v1/calendar. Phase 13
// PR3 (the web UI) will import from here when it lands; in the
// meantime this file exists so (a) the backend routes aren't
// flagged as dead mounts by the per-PR guard, and (b) the
// frontend URL guard sees real callers for every backend route.
//
// Every function uses the baseURL-relative form (no leading /api/v1)
// per CLAUDE.md §1.5.

import { apiClient } from '../../../shared/services/apiClient';
import type {
  AppointmentResponse,
  AvailabilityBlock,
  AvailabilityBlockCreateDTO,
  AvailabilityBlockUpdateDTO,
  CalendarPreferences,
  TodayViewResponse,
} from '@signacare/shared';

export interface CalendarSubscriptionInfo {
  token: string;
  issuedAt: string;
  url: string;
}

export const calendarApi = {
  // ── Calendar appointments (calendar-module scoped) ───────────

  listAppointments: async (params?: {
    clinicianId?: string;
    patientId?: string;
    specialtyCode?: string;
    status?: string;
    from?: string;
    to?: string;
    limit?: string;
    offset?: string;
  }): Promise<{ appointments: AppointmentResponse[] }> =>
    apiClient.get<{ appointments: AppointmentResponse[] }>(
      'calendar/appointments',
      params,
    ),

  // ── Availability blocks ─────────────────────────────────────

  listBlocks: async (params?: {
    clinicianId?: string;
    from?: string;
    to?: string;
  }): Promise<{ blocks: AvailabilityBlock[] }> =>
    apiClient.get<{ blocks: AvailabilityBlock[] }>('calendar/blocks', params),

  createBlock: async (
    dto: AvailabilityBlockCreateDTO,
  ): Promise<AvailabilityBlock> =>
    apiClient.post<AvailabilityBlock>('calendar/blocks', dto),

  updateBlock: async (
    id: string,
    patch: AvailabilityBlockUpdateDTO,
  ): Promise<AvailabilityBlock> =>
    apiClient.put<AvailabilityBlock>(`calendar/blocks/${id}`, patch),

  deleteBlock: async (id: string): Promise<void> => {
    await apiClient.delete(`calendar/blocks/${id}`);
  },

  // ── Preferences ─────────────────────────────────────────────

  getPreferences: async (): Promise<CalendarPreferences> =>
    apiClient.get<CalendarPreferences>('calendar/preferences'),

  updatePreferences: async (
    patch: Partial<CalendarPreferences>,
  ): Promise<CalendarPreferences> =>
    apiClient.put<CalendarPreferences>('calendar/preferences', patch),

  // ── iCal subscription URL ──────────────────────────────────

  getIcalSubscriptionUrl: async (): Promise<CalendarSubscriptionInfo> =>
    apiClient.get<CalendarSubscriptionInfo>('calendar/ical/subscribe'),

  rotateIcalToken: async (): Promise<CalendarSubscriptionInfo> =>
    apiClient.post<CalendarSubscriptionInfo>('calendar/ical/rotate', {}),

  // ── Today view (aggregate for one clinician on one date) ──

  getToday: async (params?: {
    clinicianId?: string;
    date?: string;
  }): Promise<TodayViewResponse> =>
    apiClient.get<TodayViewResponse>('calendar/today', params),
};
