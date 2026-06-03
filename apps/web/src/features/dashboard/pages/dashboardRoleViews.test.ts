import { describe, expect, it } from 'vitest';
import { getDashboardViewsForRole } from './dashboardRoleViews';

describe('dashboard role view policy', () => {
  it('returns clinician + team dashboard views for clinical users', () => {
    expect(getDashboardViewsForRole('clinician')).toEqual(['my_dashboard', 'team_dashboard']);
    expect(getDashboardViewsForRole('psychiatrist')).toEqual(['my_dashboard', 'team_dashboard']);
    expect(getDashboardViewsForRole('junior_medical_staff')).toEqual(['my_dashboard', 'team_dashboard']);
    expect(getDashboardViewsForRole('psychiatry_registrar')).toEqual(['my_dashboard', 'team_dashboard']);
    expect(getDashboardViewsForRole('nurse')).toEqual(['nurse', 'team_dashboard']);
  });

  it('returns a single role-specific view for operational roles', () => {
    expect(getDashboardViewsForRole('manager')).toEqual(['manager', 'team_dashboard']);
    expect(getDashboardViewsForRole('receptionist')).toEqual(['receptionist']);
    expect(getDashboardViewsForRole('referral_coordinator')).toEqual(['my_dashboard']);
  });

  it('keeps multi-view switcher for elevated platform roles', () => {
    expect(getDashboardViewsForRole('admin')).toEqual(['my_dashboard', 'team_dashboard', 'manager', 'clinician']);
    expect(getDashboardViewsForRole('superadmin')).toEqual(['my_dashboard', 'team_dashboard', 'manager', 'clinician']);
  });

  it('normalizes role input and falls back safely', () => {
    expect(getDashboardViewsForRole('  CLINICIAN  ')).toEqual(['my_dashboard', 'team_dashboard']);
    expect(getDashboardViewsForRole('unknown')).toEqual(['my_dashboard']);
    expect(getDashboardViewsForRole(undefined)).toEqual(['my_dashboard']);
  });
});
