import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dashboardApi,
  type DashboardFilters,
  type TeamDashboardFilters,
} from '../services/dashboardApi';
import type { DashboardPreferencesUpdate } from '@signacare/shared';
import { useAuthStore }  from '../../../shared/store/authStore';
import { dashboardKeys } from '../queryKeys';

const CLINICIAN_DASHBOARD_ROLES = new Set([
  'clinician',
  'psychiatrist',
  'psychologist',
  'nurse',
  'case_manager',
  'readonly',
  'referral_coordinator',
  'admin',
  'superadmin',
]);

const TEAM_DASHBOARD_ROLES = new Set([
  'clinician',
  'psychiatrist',
  'psychologist',
  'nurse',
  'case_manager',
  'manager',
  'admin',
  'superadmin',
]);

function normalizeRole(role: string | undefined): string {
  return (role ?? '').trim().toLowerCase();
}

export function useClinicianMetrics(filters?: DashboardFilters, enabled = true) {
  const role = useAuthStore((s) => normalizeRole(s.user?.role));
  const clinicScope = useAuthStore((s) => s.user?.clinicId ?? '');
  const canRead = CLINICIAN_DASHBOARD_ROLES.has(role);
  return useQuery({
    queryKey: dashboardKeys.clinician(clinicScope, filters?.period, filters?.team),
    queryFn: () => dashboardApi.getClinicianDashboard(filters),
    enabled: enabled && canRead,
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });
}

export function useManagerMetrics(filters?: DashboardFilters) {
  const clinicScope = useAuthStore((s) => s.user?.clinicId ?? '');
  const role = useAuthStore((s) => normalizeRole(s.user?.role));
  const isManager = ['superadmin', 'admin', 'manager'].includes(role);
  return useQuery({
    queryKey: dashboardKeys.manager(clinicScope, filters?.period, filters?.team),
    queryFn: () => dashboardApi.getManagerDashboard(filters),
    enabled: isManager,
    staleTime: 60_000,
  });
}

export function useTeamDashboardMetrics(filters?: TeamDashboardFilters, enabled = true) {
  const role = useAuthStore((s) => normalizeRole(s.user?.role));
  const clinicScope = useAuthStore((s) => s.user?.clinicId ?? '');
  const canRead = TEAM_DASHBOARD_ROLES.has(role);
  return useQuery({
    queryKey: dashboardKeys.team(clinicScope, filters?.period, filters?.scopeType, filters?.scopeId),
    queryFn: () => dashboardApi.getTeamDashboard(filters),
    enabled: enabled && canRead,
    staleTime: 60_000,
  });
}

export function useTeamDashboardScopes(enabled = true) {
  const role = useAuthStore((s) => normalizeRole(s.user?.role));
  const clinicScope = useAuthStore((s) => s.user?.clinicId ?? '');
  const canRead = TEAM_DASHBOARD_ROLES.has(role);
  return useQuery({
    queryKey: dashboardKeys.teamScopes(clinicScope),
    queryFn: () => dashboardApi.getTeamDashboardScopes(),
    enabled: enabled && canRead,
    staleTime: 5 * 60_000,
  });
}

export function useDashboardPreferences(enabled = true) {
  const user = useAuthStore((s) => s.user);
  const clinicScope = user?.clinicId ?? '';
  return useQuery({
    queryKey: dashboardKeys.preferences(clinicScope, user?.id),
    queryFn: () => dashboardApi.getDashboardPreferences(),
    enabled: enabled && !!user?.id,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateDashboardPreferences() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const clinicScope = user?.clinicId ?? '';
  return useMutation({
    mutationFn: (preferences: DashboardPreferencesUpdate) =>
      dashboardApi.updateDashboardPreferences(preferences),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: dashboardKeys.preferences(clinicScope, user?.id),
      });
    },
  });
}
