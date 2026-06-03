type DashboardView =
  | 'my_dashboard'
  | 'team_dashboard'
  | 'clinician'
  | 'nurse'
  | 'case_manager'
  | 'receptionist'
  | 'manager';

const VIEW_BY_ROLE: Record<string, DashboardView> = {
  clinician: 'my_dashboard',
  psychiatrist: 'my_dashboard',
  psychiatry_registrar: 'my_dashboard',
  junior_medical_staff: 'my_dashboard',
  registrar: 'my_dashboard',
  psychologist: 'my_dashboard',
  manager: 'manager',
  receptionist: 'receptionist',
  nurse: 'nurse',
  case_manager: 'case_manager',
  readonly: 'my_dashboard',
  referral_coordinator: 'my_dashboard',
};

function normalizeRole(role: string | null | undefined): string {
  return (role ?? '').trim().toLowerCase();
}

export function getDashboardViewsForRole(role: string | null | undefined): DashboardView[] {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === 'manager') {
    return ['manager', 'team_dashboard'];
  }

  if (
    normalizedRole === 'clinician'
    || normalizedRole === 'psychiatrist'
    || normalizedRole === 'psychiatry_registrar'
    || normalizedRole === 'junior_medical_staff'
    || normalizedRole === 'registrar'
    || normalizedRole === 'psychologist'
    || normalizedRole === 'nurse'
    || normalizedRole === 'case_manager'
  ) {
    return [VIEW_BY_ROLE[normalizedRole], 'team_dashboard'];
  }

  // Elevated platform roles intentionally retain a multi-view switcher.
  if (normalizedRole === 'superadmin' || normalizedRole === 'admin') {
    return ['my_dashboard', 'team_dashboard', 'manager', 'clinician'];
  }

  const mappedView = VIEW_BY_ROLE[normalizedRole];
  if (mappedView) {
    return [mappedView];
  }

  return ['my_dashboard'];
}
