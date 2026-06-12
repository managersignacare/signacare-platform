import { describe, expect, it } from 'vitest';
import {
  buildDashboardDiscoveryPayload,
  resolveDashboardSurfaceForRole,
} from './dashboardRouteAliases';

describe('dashboardRouteAliases', () => {
  it('routes managers and elevated roles to the manager dashboard surface', () => {
    expect(resolveDashboardSurfaceForRole('manager')).toBe('manager');
    expect(resolveDashboardSurfaceForRole('admin')).toBe('manager');
    expect(resolveDashboardSurfaceForRole('superadmin')).toBe('manager');
  });

  it('routes clinicians and unknown roles to the clinician surface', () => {
    expect(resolveDashboardSurfaceForRole('clinician')).toBe('clinician');
    expect(resolveDashboardSurfaceForRole('receptionist')).toBe('clinician');
    expect(resolveDashboardSurfaceForRole(undefined)).toBe('clinician');
  });

  it('publishes stable alias and discovery routes for dashboard clients', () => {
    const payload = buildDashboardDiscoveryPayload('admin');
    expect(payload.defaultRoute).toBe('/api/v1/dashboard/manager');
    expect(payload.routes).toContain('/api/v1/dashboard');
    expect(payload.routes).toContain('/api/v1/dashboard/my');
    expect(payload.routes).toContain('/api/v1/dashboard/metrics');
    expect(payload.routes).toContain('/api/v1/dashboard/role');
  });
});
