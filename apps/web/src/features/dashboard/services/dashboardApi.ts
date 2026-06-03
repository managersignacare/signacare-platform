import type {
  ClinicianDashboard,
  ManagerDashboard,
  TeamDashboard,
  TeamDashboardScopes,
  TeamDashboardScopeType,
} from '@signacare/shared';
import { apiClient } from '../../../shared/services/apiClient';

export interface DashboardFilters {
  period?: string;  // today | week | month | quarter
  team?: string;    // legacy filter key (team id)
}

export interface TeamDashboardFilters {
  period?: string;
  scopeType?: TeamDashboardScopeType;
  scopeId?: string;
}

export const dashboardApi = {
  async getClinicianDashboard(filters?: DashboardFilters): Promise<ClinicianDashboard> {
    const resp = await apiClient.get<{ role: string; data: ClinicianDashboard }>('dashboard/clinician', filters as Record<string, unknown>);
    return resp.data;
  },
  async getManagerDashboard(filters?: DashboardFilters): Promise<ManagerDashboard> {
    const resp = await apiClient.get<{ role: string; data: ManagerDashboard }>('dashboard/manager', filters as Record<string, unknown>);
    return resp.data;
  },
  async getTeamDashboard(filters?: TeamDashboardFilters): Promise<TeamDashboard> {
    const resp = await apiClient.get<{ role: string; data: TeamDashboard }>(
      'dashboard/team',
      filters as Record<string, unknown>,
    );
    return resp.data;
  },
  async getTeamDashboardScopes(): Promise<TeamDashboardScopes> {
    const resp = await apiClient.get<{ data: TeamDashboardScopes }>('dashboard/team/scopes');
    return resp.data;
  },
} as const;
