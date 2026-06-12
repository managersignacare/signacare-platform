// apps/api/src/shared/roleGroups.ts
//
// Shared role group constants. Every route that gates by role
// imports from here instead of hardcoding role arrays inline.

import {
  PRESCRIBER_CONSULTANT_ROLE,
  PRESCRIBER_HMO_ROLE,
  PRESCRIBER_NURSE_PRACTITIONER_ROLE,
  PRESCRIBER_REGISTRAR_ROLE,
} from '@signacare/shared';

export const RECEPTIONIST_ROLES = ['receptionist', 'admin', 'superadmin'] as const;
export const MANAGER_ROLES = ['manager', PRESCRIBER_CONSULTANT_ROLE, 'admin', 'superadmin'] as const;
export const NURSE_ROLES = ['nurse', 'clinician', PRESCRIBER_CONSULTANT_ROLE, PRESCRIBER_REGISTRAR_ROLE, PRESCRIBER_HMO_ROLE, PRESCRIBER_NURSE_PRACTITIONER_ROLE, 'admin', 'superadmin'] as const;
export const CASE_MANAGER_ROLES = ['case_manager', 'clinician', 'admin', 'superadmin'] as const;
export const PSYCHIATRIST_ROLES = ['psychiatrist', 'clinician', PRESCRIBER_CONSULTANT_ROLE, PRESCRIBER_REGISTRAR_ROLE, PRESCRIBER_HMO_ROLE, 'admin', 'superadmin'] as const;
export const CLINICAL_ROLES = ['clinician', 'nurse', 'psychiatrist', 'psychologist', PRESCRIBER_CONSULTANT_ROLE, PRESCRIBER_REGISTRAR_ROLE, PRESCRIBER_HMO_ROLE, PRESCRIBER_NURSE_PRACTITIONER_ROLE, 'admin', 'superadmin'] as const;
