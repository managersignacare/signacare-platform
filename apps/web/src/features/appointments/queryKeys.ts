// apps/web/src/features/appointments/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the appointments feature.
// Single source of truth for cache keys so mutation invalidations always
// match the corresponding queries (CLAUDE.md §4.1).
import type { AppointmentFilters } from './types/appointmentTypes';

export const appointmentKeys = {
  all: ['appointments'] as const,
  lists: () => [...appointmentKeys.all, 'list'] as const,
  list: (filters?: AppointmentFilters) =>
    [...appointmentKeys.lists(), filters ?? {}] as const,
  clinic: (patientIdFilter: string) =>
    [...appointmentKeys.all, 'clinic', patientIdFilter] as const,
  detail: (id: string) => [...appointmentKeys.all, 'detail', id] as const,
  // Cross-feature helpers — used by the shared scheduling workspace and
  // appointment dialogs. Namespace prefixes preserved so broad invalidations
  // on the parent feature still drop these caches (CLAUDE.md §4.1).
  staffLookup: () => ['staff', 'lookup'] as const,
  staffSettingsAppointmentModes: () =>
    ['staff-settings', 'appointment-modes'] as const,
  patientSearch: (search: string) => ['patients', 'search', search] as const,
  episodeActiveForAppt: (patientId: string) =>
    ['episodes', patientId, 'active-for-appt'] as const,
  episodeAllocation: (episodeId: string) =>
    ['episode-allocation', episodeId] as const,
} as const;
