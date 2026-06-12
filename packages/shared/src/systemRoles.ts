import type { Role } from './rbac.schemas';

export const PRESCRIBER_CONSULTANT_ROLE = 'prescriber_consultant' as const;
export const PRESCRIBER_REGISTRAR_ROLE = 'prescriber_registrar' as const;
export const PRESCRIBER_HMO_ROLE = 'prescriber_hmo' as const;
export const PRESCRIBER_NURSE_PRACTITIONER_ROLE = 'prescriber_nurse_practitioner' as const;

export const PRESCRIBER_SYSTEM_ROLES = [
  PRESCRIBER_CONSULTANT_ROLE,
  PRESCRIBER_REGISTRAR_ROLE,
  PRESCRIBER_HMO_ROLE,
  PRESCRIBER_NURSE_PRACTITIONER_ROLE,
] as const satisfies readonly Role[];

export const PSYCHIATRY_PRESCRIBER_SYSTEM_ROLES = [
  PRESCRIBER_CONSULTANT_ROLE,
  PRESCRIBER_REGISTRAR_ROLE,
  PRESCRIBER_HMO_ROLE,
] as const satisfies readonly Role[];

export type PrescriberSystemRole = (typeof PRESCRIBER_SYSTEM_ROLES)[number];

const INHERITED_ROLE_MEMBERSHIP: Record<Role, readonly string[]> = {
  superadmin: ['superadmin'],
  admin: ['admin'],
  clinician: ['clinician'],
  manager: ['manager'],
  receptionist: ['receptionist'],
  readonly: ['readonly'],
  referral_coordinator: ['referral_coordinator'],
  prescriber_consultant: [
    'prescriber_consultant',
    'clinician',
    'manager',
  ],
  prescriber_registrar: [
    'prescriber_registrar',
    'clinician',
  ],
  prescriber_hmo: [
    'prescriber_hmo',
    'clinician',
  ],
  prescriber_nurse_practitioner: [
    'prescriber_nurse_practitioner',
    'clinician',
  ],
};

export function isPrescriberSystemRole(role: string | null | undefined): role is PrescriberSystemRole {
  return role !== null && role !== undefined && PRESCRIBER_SYSTEM_ROLES.includes(role as PrescriberSystemRole);
}

export function isPsychiatryPrescriberSystemRole(role: string | null | undefined): boolean {
  return role === PRESCRIBER_CONSULTANT_ROLE
    || role === PRESCRIBER_REGISTRAR_ROLE
    || role === PRESCRIBER_HMO_ROLE;
}

export function isPrescriberConsultantRole(role: string | null | undefined): boolean {
  return role === PRESCRIBER_CONSULTANT_ROLE;
}

export function roleHasManagerPrivileges(role: string | null | undefined): boolean {
  return role === 'manager' || role === 'admin' || role === 'superadmin' || role === PRESCRIBER_CONSULTANT_ROLE;
}

export function expandRoleMembership(role: string | null | undefined): Set<string> {
  if (!role) return new Set();
  const inherited = INHERITED_ROLE_MEMBERSHIP[role as Role];
  if (!inherited) return new Set([role]);
  return new Set(inherited);
}

export function roleSatisfiesRequirement(
  actualRole: string | null | undefined,
  allowedRole: string,
): boolean {
  if (!actualRole) return false;
  if (actualRole === 'superadmin') return true;
  return expandRoleMembership(actualRole).has(allowedRole);
}

export function canCompleteEctTmsForms(role: string | null | undefined): boolean {
  return isPsychiatryPrescriberSystemRole(role);
}

export function canApproveEctTmsForms(role: string | null | undefined): boolean {
  return isPrescriberConsultantRole(role);
}

export function requiresConsultantApprovalForEctTms(role: string | null | undefined): boolean {
  return canCompleteEctTmsForms(role) && !canApproveEctTmsForms(role);
}
