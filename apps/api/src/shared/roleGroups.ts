// apps/api/src/shared/roleGroups.ts
//
// Shared role group constants. Every route that gates by role
// imports from here instead of hardcoding role arrays inline.

export const RECEPTIONIST_ROLES = ['receptionist', 'admin', 'superadmin'] as const;
export const MANAGER_ROLES = ['manager', 'admin', 'superadmin'] as const;
export const NURSE_ROLES = ['nurse', 'clinician', 'admin', 'superadmin'] as const;
export const CASE_MANAGER_ROLES = ['case_manager', 'clinician', 'admin', 'superadmin'] as const;
export const PSYCHIATRIST_ROLES = ['psychiatrist', 'clinician', 'admin', 'superadmin'] as const;
export const CLINICAL_ROLES = ['clinician', 'nurse', 'psychiatrist', 'psychologist', 'admin', 'superadmin'] as const;
