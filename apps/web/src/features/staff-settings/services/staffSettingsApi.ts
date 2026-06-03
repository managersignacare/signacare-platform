import { apiClient } from '../../../shared/services/apiClient'
import type { RoleType } from '@signacare/shared'

export interface Discipline { id: string; clinicId: string; name: string; isActive: boolean; sortOrder: number }
export interface ClinicalRole { id: string; clinicId: string; name: string; isActive: boolean; sortOrder: number }
export interface ReferralSource { id: string; clinicId: string; category: string; name: string; isActive: boolean; sortOrder: number }
export interface InvestigationType { id: string; clinicId: string; name: string; isActive: boolean; sortOrder: number }
export interface TeamAssignment { id: string; staffId: string; orgUnitId: string; orgUnitName: string; startDate: string; endDate: string | null; isActive: boolean; staffName?: string }
export interface RoleAssignment { id: string; staffId: string; orgUnitId: string; orgUnitName: string; clinicalRoleId: string; clinicalRoleName: string; roleType: RoleType; startDate: string; endDate: string | null; isActive: boolean; staffName?: string }

type LookupUpdateInput = Partial<{
  name: string
  isActive: boolean
  sortOrder: number
  is_active: boolean
  sort_order: number
  isactive: boolean
  sortorder: number
}>

type ReferralSourceUpdateInput = LookupUpdateInput & Partial<{ category: string }>

function toLookupUpdatePayload(data: LookupUpdateInput): Partial<{ name: string; is_active: boolean; sort_order: number }> {
  return {
    name: data.name,
    is_active: data.is_active ?? data.isActive ?? data.isactive,
    sort_order: data.sort_order ?? data.sortOrder ?? data.sortorder,
  }
}

export const staffSettingsApi = {
  // Disciplines
  getDisciplines: (clinicId?: string): Promise<Discipline[]> =>
    apiClient
      .get<{ disciplines: Discipline[] }>('staff-settings/disciplines', clinicId ? { clinicId } : undefined)
      .then(r => r.disciplines),
  createDiscipline: (name: string, sortOrder?: number): Promise<Discipline> => apiClient.post<{ discipline: Discipline }>('staff-settings/disciplines', { name, sortOrder }).then(r => r.discipline),
  updateDiscipline: (id: string, data: LookupUpdateInput): Promise<Discipline> =>
    apiClient
      .patch<{ discipline: Discipline }>(`staff-settings/disciplines/${id}`, toLookupUpdatePayload(data))
      .then(r => r.discipline),
  deleteDiscipline: (id: string): Promise<void> => apiClient.delete(`staff-settings/disciplines/${id}`),

  // Clinical Roles
  getClinicalRoles: (clinicId?: string): Promise<ClinicalRole[]> =>
    apiClient
      .get<{ roles: ClinicalRole[] }>('staff-settings/clinical-roles', clinicId ? { clinicId } : undefined)
      .then(r => r.roles),
  createClinicalRole: (name: string, sortOrder?: number): Promise<ClinicalRole> => apiClient.post<{ role: ClinicalRole }>('staff-settings/clinical-roles', { name, sortOrder }).then(r => r.role),
  updateClinicalRole: (id: string, data: LookupUpdateInput): Promise<ClinicalRole> =>
    apiClient
      .patch<{ role: ClinicalRole }>(`staff-settings/clinical-roles/${id}`, toLookupUpdatePayload(data))
      .then(r => r.role),
  deleteClinicalRole: (id: string): Promise<void> => apiClient.delete(`staff-settings/clinical-roles/${id}`),

  // Team Assignments
  getTeamAssignments: (staffId?: string, clinicId?: string): Promise<TeamAssignment[]> => {
    const params: Record<string, string> = {}
    if (staffId) params.staffId = staffId
    if (clinicId) params.clinicId = clinicId
    return apiClient
      .get<{ assignments: TeamAssignment[] }>('staff-settings/team-assignments', Object.keys(params).length ? params : undefined)
      .then(r => r.assignments)
  },
  createTeamAssignment: (data: { staffId: string; orgUnitId: string; startDate: string; endDate?: string | null; clinicId?: string }): Promise<TeamAssignment> =>
    apiClient
      .post<{ assignment: TeamAssignment }>('staff-settings/team-assignments', data)
      .then(r => r.assignment),
  updateTeamAssignment: (id: string, data: Partial<{ endDate: string | null; isActive: boolean }>, clinicId?: string): Promise<TeamAssignment> =>
    apiClient
      .patch<{ assignment: TeamAssignment }>(
        `staff-settings/team-assignments/${id}${clinicId ? `?clinicId=${encodeURIComponent(clinicId)}` : ''}`,
        data,
      )
      .then(r => r.assignment),
  deleteTeamAssignment: (id: string, clinicId?: string): Promise<void> =>
    apiClient.delete(`staff-settings/team-assignments/${id}${clinicId ? `?clinicId=${encodeURIComponent(clinicId)}` : ''}`),

  // Role Assignments
  getRoleAssignments: (staffId?: string, clinicId?: string): Promise<RoleAssignment[]> => {
    const params: Record<string, string> = {}
    if (staffId) params.staffId = staffId
    if (clinicId) params.clinicId = clinicId
    return apiClient
      .get<{ assignments: RoleAssignment[] }>('staff-settings/role-assignments', Object.keys(params).length ? params : undefined)
      .then(r => r.assignments)
  },
  createRoleAssignment: (data: { staffId: string; orgUnitId: string; clinicalRoleId: string; roleType: RoleType; startDate: string; endDate?: string | null; clinicId?: string }): Promise<RoleAssignment> =>
    apiClient
      .post<{ assignment: RoleAssignment }>('staff-settings/role-assignments', data)
      .then(r => r.assignment),
  updateRoleAssignment: (id: string, data: Partial<{ endDate: string | null; isActive: boolean; roleType: RoleType }>, clinicId?: string): Promise<RoleAssignment> =>
    apiClient
      .patch<{ assignment: RoleAssignment }>(
        `staff-settings/role-assignments/${id}${clinicId ? `?clinicId=${encodeURIComponent(clinicId)}` : ''}`,
        data,
      )
      .then(r => r.assignment),
  deleteRoleAssignment: (id: string, clinicId?: string): Promise<void> =>
    apiClient.delete(`staff-settings/role-assignments/${id}${clinicId ? `?clinicId=${encodeURIComponent(clinicId)}` : ''}`),

  // Referral Sources
  getReferralSources: (): Promise<ReferralSource[]> => apiClient.get<{ sources: ReferralSource[] }>('staff-settings/referral-sources').then(r => r.sources),
  createReferralSource: (data: { name: string; category: string; sortOrder?: number }): Promise<ReferralSource> => apiClient.post<{ source: ReferralSource }>('staff-settings/referral-sources', data).then(r => r.source),
  updateReferralSource: (id: string, data: ReferralSourceUpdateInput): Promise<ReferralSource> =>
    apiClient
      .patch<{ source: ReferralSource }>(`staff-settings/referral-sources/${id}`, {
        ...toLookupUpdatePayload(data),
        category: data.category,
      })
      .then(r => r.source),
  deleteReferralSource: (id: string): Promise<void> => apiClient.delete(`staff-settings/referral-sources/${id}`),

  // Investigation Types
  getInvestigationTypes: (): Promise<InvestigationType[]> => apiClient.get<{ types: InvestigationType[] }>('staff-settings/investigation-types').then(r => r.types),
  createInvestigationType: (name: string, sortOrder?: number): Promise<InvestigationType> => apiClient.post<{ type: InvestigationType }>('staff-settings/investigation-types', { name, sortOrder }).then(r => r.type),
  updateInvestigationType: (id: string, data: LookupUpdateInput): Promise<InvestigationType> =>
    apiClient
      .patch<{ type: InvestigationType }>(`staff-settings/investigation-types/${id}`, toLookupUpdatePayload(data))
      .then(r => r.type),
  deleteInvestigationType: (id: string): Promise<void> => apiClient.delete(`staff-settings/investigation-types/${id}`),
}
