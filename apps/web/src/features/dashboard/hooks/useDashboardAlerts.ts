import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../services/dashboardApi';
import { useAuthStore }  from '../../../shared/store/authStore';
import { dashboardKeys } from '../queryKeys';

export function useDashboardAlerts() {
  const role = useAuthStore((s) => s.user?.role ?? '');
  const clinicScope = useAuthStore((s) => s.user?.clinicId ?? '');
  const isManager = ['clinicManager', 'clinicSuperUser', 'superAdmin'].includes(role);

  return useQuery({
    queryKey: dashboardKeys.alerts(clinicScope, role),
    queryFn: async () => {
      const data = isManager
        ? await dashboardApi.getManagerDashboard()
        : await dashboardApi.getClinicianDashboard();
      return 'overnightAlerts' in data ? data.overnightAlerts : [];
    },
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });
}
