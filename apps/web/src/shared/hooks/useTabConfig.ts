/**
 * useTabConfig — Fetches per-clinic tab visibility configuration
 * Filters PATIENT_TABS based on clinic config and user role.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import { sharedTabConfigKeys } from '../queryKeys';
import { useAuthStore } from '../store/authStore';
import { PATIENT_TABS, type PatientTab } from '../../features/patients/types/patientTypes';

interface TabConfig {
  tab_id: string;
  is_enabled: boolean;
  required_role: string | null;
  sort_order: number;
}

export function useTabConfig() {
  const role = useAuthStore(s => s.user?.role ?? 'clinician');

  const { data } = useQuery({
    queryKey: sharedTabConfigKeys.current(),
    queryFn: async () => {
      try {
        const r = await apiClient.get<{ data: TabConfig[] }>('settings/tab-config');
        return r.data ?? [];
      } catch { return []; }
    },
    staleTime: 10 * 60_000, // Cache for 10 min
  });

  const configMap = new Map((data ?? []).map(c => [c.tab_id, c]));

  // Filter tabs based on config + role
  const visibleTabs: PatientTab[] = PATIENT_TABS.filter(tab => {
    const config = configMap.get(tab.id);
    if (!config) return true; // No config = visible by default
    if (!config.is_enabled) return false; // Explicitly disabled
    if (config.required_role && config.required_role !== role && role !== 'superadmin') return false;
    return true;
  });

  return { tabs: visibleTabs, configMap };
}
