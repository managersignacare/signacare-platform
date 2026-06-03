import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { staffSettingsApi } from '../services/staffSettingsApi'
import { staffSettingsKeys } from '../queryKeys'
import type { RoleType } from '@signacare/shared'

// Disciplines
export function useDisciplines(clinicId?: string) {
  return useQuery({
    queryKey: [...staffSettingsKeys.disciplines(), clinicId ?? 'session'],
    queryFn: () => staffSettingsApi.getDisciplines(clinicId),
  })
}
export function useCreateDiscipline() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ name, sortOrder }: { name: string; sortOrder?: number }) => staffSettingsApi.createDiscipline(name, sortOrder), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.disciplines() }) }) }
export function useUpdateDiscipline() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, data }: { id: string; data: Partial<{ name: string; isActive: boolean; sortOrder: number }> }) => staffSettingsApi.updateDiscipline(id, data), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.disciplines() }) }) }
export function useDeleteDiscipline() { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => staffSettingsApi.deleteDiscipline(id), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.disciplines() }) }) }

// Clinical Roles
export function useClinicalRoles(clinicId?: string) {
  return useQuery({
    queryKey: [...staffSettingsKeys.clinicalRoles(), clinicId ?? 'session'],
    queryFn: () => staffSettingsApi.getClinicalRoles(clinicId),
  })
}
export function useCreateClinicalRole() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ name, sortOrder }: { name: string; sortOrder?: number }) => staffSettingsApi.createClinicalRole(name, sortOrder), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.clinicalRoles() }) }) }
export function useUpdateClinicalRole() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, data }: { id: string; data: Partial<{ name: string; isActive: boolean; sortOrder: number }> }) => staffSettingsApi.updateClinicalRole(id, data), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.clinicalRoles() }) }) }
export function useDeleteClinicalRole() { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => staffSettingsApi.deleteClinicalRole(id), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.clinicalRoles() }) }) }

// Team Assignments (staff-settings namespace)
export function useTeamAssignments(staffId?: string, clinicId?: string) {
  return useQuery({
    queryKey: staffSettingsKeys.teamAssignmentsByScope(staffId, clinicId),
    queryFn: () => staffSettingsApi.getTeamAssignments(staffId, clinicId),
  })
}
export function useCreateTeamAssignment() { const qc = useQueryClient(); return useMutation({ mutationFn: (data: { staffId: string; orgUnitId: string; startDate: string; endDate?: string | null; clinicId?: string }) => staffSettingsApi.createTeamAssignment(data), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.teamAssignments() }) }) }
export function useUpdateTeamAssignment() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, data, clinicId }: { id: string; data: Partial<{ endDate: string | null; isActive: boolean }>; clinicId?: string }) => staffSettingsApi.updateTeamAssignment(id, data, clinicId), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.teamAssignments() }) }) }
export function useDeleteTeamAssignment() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, clinicId }: { id: string; clinicId?: string }) => staffSettingsApi.deleteTeamAssignment(id, clinicId), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.teamAssignments() }) }) }

// Role Assignments (staff-settings namespace)
export function useRoleAssignments(staffId?: string, clinicId?: string) {
  return useQuery({
    queryKey: staffSettingsKeys.roleAssignmentsByScope(staffId, clinicId),
    queryFn: () => staffSettingsApi.getRoleAssignments(staffId, clinicId),
  })
}
export function useCreateRoleAssignment() { const qc = useQueryClient(); return useMutation({ mutationFn: (data: { staffId: string; orgUnitId: string; clinicalRoleId: string; roleType: RoleType; startDate: string; endDate?: string | null; clinicId?: string }) => staffSettingsApi.createRoleAssignment(data), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.roleAssignments() }) }) }
export function useUpdateRoleAssignment() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, data, clinicId }: { id: string; data: Partial<{ endDate: string | null; isActive: boolean; roleType: RoleType }>; clinicId?: string }) => staffSettingsApi.updateRoleAssignment(id, data, clinicId), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.roleAssignments() }) }) }
export function useDeleteRoleAssignment() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, clinicId }: { id: string; clinicId?: string }) => staffSettingsApi.deleteRoleAssignment(id, clinicId), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.roleAssignments() }) }) }

// Referral Sources
export function useReferralSources() { return useQuery({ queryKey: staffSettingsKeys.referralSources(), queryFn: staffSettingsApi.getReferralSources }) }
export function useCreateReferralSource() { const qc = useQueryClient(); return useMutation({ mutationFn: (data: { name: string; category: string; sortOrder?: number }) => staffSettingsApi.createReferralSource(data), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.referralSources() }) }) }
export function useUpdateReferralSource() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, data }: { id: string; data: Partial<{ name: string; category: string; isActive: boolean; sortOrder: number }> }) => staffSettingsApi.updateReferralSource(id, data), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.referralSources() }) }) }
export function useDeleteReferralSource() { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => staffSettingsApi.deleteReferralSource(id), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.referralSources() }) }) }

// Investigation Types
export function useInvestigationTypes() { return useQuery({ queryKey: staffSettingsKeys.investigationTypes(), queryFn: staffSettingsApi.getInvestigationTypes }) }
export function useCreateInvestigationType() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ name, sortOrder }: { name: string; sortOrder?: number }) => staffSettingsApi.createInvestigationType(name, sortOrder), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.investigationTypes() }) }) }
export function useUpdateInvestigationType() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, data }: { id: string; data: Partial<{ name: string; isActive: boolean; sortOrder: number }> }) => staffSettingsApi.updateInvestigationType(id, data), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.investigationTypes() }) }) }
export function useDeleteInvestigationType() { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => staffSettingsApi.deleteInvestigationType(id), onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsKeys.investigationTypes() }) }) }
