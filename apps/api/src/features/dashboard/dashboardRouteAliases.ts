export type DashboardResolvedSurface = 'clinician' | 'manager';

export function resolveDashboardSurfaceForRole(role: string | null | undefined): DashboardResolvedSurface {
  const normalized = role?.trim().toLowerCase() ?? '';
  if (normalized === 'manager' || normalized === 'admin' || normalized === 'superadmin') {
    return 'manager';
  }
  return 'clinician';
}

export function buildDashboardDiscoveryPayload(role: string | null | undefined): {
  role: DashboardResolvedSurface;
  defaultRoute: string;
  routes: string[];
} {
  const resolved = resolveDashboardSurfaceForRole(role);
  return {
    role: resolved,
    defaultRoute: `/api/v1/dashboard/${resolved}`,
    routes: [
      '/api/v1/dashboard',
      '/api/v1/dashboard/my',
      '/api/v1/dashboard/metrics',
      '/api/v1/dashboard/role',
      '/api/v1/dashboard/clinician',
      '/api/v1/dashboard/manager',
      '/api/v1/dashboard/team',
      '/api/v1/dashboard/team/scopes',
      '/api/v1/dashboard/preferences',
    ],
  };
}
