export interface StaffDirectoryRow {
  id: string;
  givenName: string;
  familyName: string;
  email: string;
  role?: string | null;
  discipline?: string | null;
  teams?: string[] | null;
  teamRoles?: string[] | null;
}

export interface StaffRoleVisual {
  bg: string;
  fg: string;
  border: string;
}

const DEFAULT_ROLE_VISUAL: StaffRoleVisual = {
  bg: '#F3F4F6',
  fg: '#374151',
  border: '#D1D5DB',
};

const ROLE_VISUALS: Record<string, StaffRoleVisual> = {
  superadmin: { bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5' },
  admin: { bg: '#FFE9D6', fg: '#9A3412', border: '#FDBA74' },
  manager: { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
  clinician: { bg: '#DBEAFE', fg: '#1E3A8A', border: '#93C5FD' },
  receptionist: { bg: '#D1FAE5', fg: '#065F46', border: '#6EE7B7' },
  referral_coordinator: { bg: '#E9D5FF', fg: '#6B21A8', border: '#C4B5FD' },
  readonly: { bg: '#E5E7EB', fg: '#4B5563', border: '#D1D5DB' },
};

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function getRoleVisual(role: string | null | undefined): StaffRoleVisual {
  return ROLE_VISUALS[normalize(role)] ?? DEFAULT_ROLE_VISUAL;
}

export function getUniqueStaffRoles(rows: StaffDirectoryRow[]): string[] {
  return [...new Set(rows.map((row) => normalize(row.role)).filter(Boolean))].sort();
}

export function getUniqueStaffTeams(rows: StaffDirectoryRow[]): string[] {
  const uniqueByNormalized = new Map<string, string>();
  for (const row of rows) {
    for (const teamName of row.teams ?? []) {
      const normalized = normalize(teamName);
      if (!normalized) continue;
      if (!uniqueByNormalized.has(normalized)) {
        uniqueByNormalized.set(normalized, teamName.trim());
      }
    }
  }

  return [...uniqueByNormalized.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, displayName]) => displayName);
}

export function filterStaffDirectory(
  rows: StaffDirectoryRow[],
  searchTerm: string,
  roleFilter: string,
  teamFilter = '',
): StaffDirectoryRow[] {
  const roleNeedle = normalize(roleFilter);
  const teamNeedle = normalize(teamFilter);
  const searchNeedle = normalize(searchTerm);

  return rows.filter((row) => {
    const rowRole = normalize(row.role);
    if (roleNeedle && rowRole !== roleNeedle) return false;
    if (teamNeedle) {
      const teamMatch = (row.teams ?? []).some((teamName) => normalize(teamName) === teamNeedle);
      if (!teamMatch) return false;
    }

    if (!searchNeedle) return true;
    const fullName = `${row.givenName} ${row.familyName}`.toLowerCase();
    return fullName.includes(searchNeedle) || row.email.toLowerCase().includes(searchNeedle);
  });
}
