import { describe, expect, it } from 'vitest';
import type { AuthUser } from '@signacare/shared';
import {
  canAccessPatientTab,
  canAccessPermission,
  canAccessRoute,
  firstAccessiblePatientTab,
  getEffectivePermissions,
} from '../frontendAccessPolicy';

const SUPERADMIN_USER: AuthUser = {
  id: '00000000-0000-0000-0000-000000000001',
  clinicId: '11111111-1111-1111-1111-111111111111',
  givenName: 'Super',
  familyName: 'Admin',
  email: 'superadmin@signacare.local',
  role: 'superadmin',
};

const CLINIC_MANAGER_USER: AuthUser = {
  id: '00000000-0000-0000-0000-000000000002',
  clinicId: '11111111-1111-1111-1111-111111111111',
  givenName: 'Clinic',
  familyName: 'Manager',
  email: 'manager@signacare.local',
  role: 'manager',
};

const ADMIN_USER: AuthUser = {
  id: '00000000-0000-0000-0000-000000000004',
  clinicId: '11111111-1111-1111-1111-111111111111',
  givenName: 'Clinic',
  familyName: 'Admin',
  email: 'admin@signacare.local',
  role: 'admin',
};

const RECEPTIONIST_USER: AuthUser = {
  id: '00000000-0000-0000-0000-000000000003',
  clinicId: '11111111-1111-1111-1111-111111111111',
  givenName: 'Front',
  familyName: 'Desk',
  email: 'reception@signacare.local',
  role: 'receptionist',
};

const CLINICIAN_USER: AuthUser = {
  id: '00000000-0000-0000-0000-000000000005',
  clinicId: '11111111-1111-1111-1111-111111111111',
  givenName: 'Care',
  familyName: 'Clinician',
  email: 'clinician@signacare.local',
  role: 'clinician',
};

describe('A1d frontendAccessPolicy', () => {
  it('falls back to role defaults when JWT does not carry explicit permissions', () => {
    const permissions = getEffectivePermissions(RECEPTIONIST_USER);
    expect(permissions.has('appointment:create')).toBe(true);
    expect(permissions.has('note:create')).toBe(false);
  });

  it('enforces route-level policy for power settings and admin rails', () => {
    expect(canAccessRoute(SUPERADMIN_USER, '/settings')).toBe(true);
    expect(canAccessRoute(CLINIC_MANAGER_USER, '/settings')).toBe(true);
    expect(canAccessRoute(RECEPTIONIST_USER, '/settings')).toBe(true);
    expect(canAccessRoute(SUPERADMIN_USER, '/power-settings')).toBe(true);
    expect(canAccessRoute(CLINIC_MANAGER_USER, '/power-settings')).toBe(false);
    expect(canAccessRoute(CLINIC_MANAGER_USER, '/org-settings')).toBe(false);
    expect(canAccessRoute(ADMIN_USER, '/org-settings')).toBe(true);
    expect(canAccessRoute(CLINIC_MANAGER_USER, '/audit')).toBe(true);
    expect(canAccessRoute(ADMIN_USER, '/audit')).toBe(true);
  });

  it('enforces clinical-notes route as clinical-access only', () => {
    expect(canAccessRoute(RECEPTIONIST_USER, '/clinical-notes')).toBe(false);
    expect(canAccessRoute(CLINIC_MANAGER_USER, '/clinical-notes')).toBe(false);
    expect(canAccessRoute(ADMIN_USER, '/clinical-notes')).toBe(true);
  });

  it('enforces pathways route as clinical-access only', () => {
    expect(canAccessRoute(RECEPTIONIST_USER, '/pathways')).toBe(false);
    expect(canAccessRoute(CLINIC_MANAGER_USER, '/pathways')).toBe(false);
    expect(canAccessRoute(ADMIN_USER, '/pathways')).toBe(true);
  });

  it('gates reports routes by report:read permission', () => {
    expect(canAccessRoute(RECEPTIONIST_USER, '/reports')).toBe(false);
    expect(canAccessRoute(CLINICIAN_USER, '/reports')).toBe(false);
    expect(canAccessRoute(CLINIC_MANAGER_USER, '/reports')).toBe(true);
    expect(canAccessRoute(SUPERADMIN_USER, '/reports/compliance')).toBe(true);
  });

  it('limits operational roles to non-clinical patient tabs', () => {
    expect(canAccessPatientTab(RECEPTIONIST_USER, 'overview')).toBe(true);
    expect(canAccessPatientTab(RECEPTIONIST_USER, 'appointments')).toBe(true);
    expect(canAccessPatientTab(RECEPTIONIST_USER, 'billing')).toBe(true);
    expect(canAccessPatientTab(RECEPTIONIST_USER, 'summary')).toBe(false);
    expect(canAccessPatientTab(RECEPTIONIST_USER, 'episodes')).toBe(false);
    expect(canAccessPatientTab(RECEPTIONIST_USER, 'alerts-plans')).toBe(false);
  });

  it('allows clinical roles to access clinical patient tabs', () => {
    expect(canAccessPatientTab(CLINIC_MANAGER_USER, 'episodes')).toBe(true);
    expect(canAccessPatientTab(CLINIC_MANAGER_USER, 'alerts-plans')).toBe(true);
  });

  it('provides deterministic fallback tab for restricted users', () => {
    expect(firstAccessiblePatientTab(RECEPTIONIST_USER)).toBe('overview');
  });

  it('supports direct permission checks for UI affordance gates', () => {
    expect(canAccessPermission(RECEPTIONIST_USER, 'note:create')).toBe(false);
    expect(canAccessPermission(RECEPTIONIST_USER, 'appointment:create')).toBe(true);
  });
});
