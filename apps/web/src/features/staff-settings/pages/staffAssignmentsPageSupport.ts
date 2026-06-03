import { SignacareApiError } from '../../../shared/services/apiClient'
import type { RoleAssignment, TeamAssignment } from '../services/staffSettingsApi'
import { RoleTypeEnum } from '@signacare/shared'

export interface StaffLookupRow {
  id: string
  givenName: string
  familyName: string
  email: string
  role?: string
  discipline?: string | null
}

export interface StaffCreateResponse {
  id?: string
  temporaryPassword?: string
  data?: {
    id?: string
    temporaryPassword?: string
  }
}

interface StaffApiErrorLike {
  response?: { data?: { error?: string } }
  message?: string
}

export interface TeamAssignmentCompat extends TeamAssignment {
  staff_id?: string
  org_unit_name?: string
  orgunitname?: string
  start_date?: string
  startdate?: string
  end_date?: string | null
  enddate?: string | null
  is_active?: boolean
}

export interface RoleAssignmentCompat extends RoleAssignment {
  staff_id?: string
  org_unit_name?: string
  orgunitname?: string
  clinical_role_name?: string
  clinicalrolename?: string
  role_type?: string
  roletype?: string
  start_date?: string
  startdate?: string
  end_date?: string | null
  enddate?: string | null
  is_active?: boolean
}

export const ASSIGNABLE_ROLE_TYPES = RoleTypeEnum.options
export type AssignableRoleType = (typeof ASSIGNABLE_ROLE_TYPES)[number]
const ASSIGNABLE_ROLE_TYPE_SET = new Set<string>(ASSIGNABLE_ROLE_TYPES)

export function normalizeAssignableRoleType(value: string | null | undefined): AssignableRoleType | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_')
  if (ASSIGNABLE_ROLE_TYPE_SET.has(normalized)) return normalized as AssignableRoleType
  if (normalized === 'main' || normalized === 'default') return 'primary'
  if (normalized === 'secondary' || normalized === 'acting' || normalized === 'secondment' || normalized === 'supervision' || normalized === 'locum') {
    return 'additional'
  }
  if (normalized === 'delegate' || normalized === 'delegation') return 'delegated'
  return null
}

export function readStaffApiError(err: unknown): string {
  if (err instanceof SignacareApiError) return err.message
  const maybe = err as StaffApiErrorLike
  return maybe?.response?.data?.error ?? maybe?.message ?? 'Unknown error'
}
