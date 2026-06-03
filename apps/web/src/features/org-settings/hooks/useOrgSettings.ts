import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orgSettingsApi } from '../services/orgSettingsApi'

const LABELS_KEY = ['org-settings', 'level-labels'] as const
const TREE_KEY = ['org-settings', 'tree'] as const
const PROGRAMS_KEY = ['org-settings', 'programs'] as const

export function useLevelLabels() {
  return useQuery({ queryKey: LABELS_KEY, queryFn: () => orgSettingsApi.getLevelLabels() })
}

export function useBulkSetLevelLabels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (labels: { level: number; label: string }[]) =>
      orgSettingsApi.bulkSetLevelLabels(labels),
    onSuccess: () => qc.invalidateQueries({ queryKey: LABELS_KEY }),
  })
}

export function useOrgTree(clinicId?: string) {
  return useQuery({
    queryKey: [...TREE_KEY, clinicId ?? 'session'],
    queryFn: () => orgSettingsApi.getOrgTree(clinicId),
  })
}

export function useCreateOrgUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { parentId?: string | null; name: string; level: number; sortOrder?: number }) =>
      orgSettingsApi.createUnit(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: TREE_KEY }),
  })
}

export function useUpdateOrgUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof orgSettingsApi.updateUnit>[1] }) =>
      orgSettingsApi.updateUnit(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: TREE_KEY }),
  })
}

export function useDeleteOrgUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => orgSettingsApi.deleteUnit(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: TREE_KEY }),
  })
}

export function usePrograms() {
  return useQuery({ queryKey: PROGRAMS_KEY, queryFn: () => orgSettingsApi.getPrograms() })
}

export function useCreateProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      orgSettingsApi.createProgram(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PROGRAMS_KEY })
      qc.invalidateQueries({ queryKey: TREE_KEY })
    },
  })
}

export function useUpdateProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string; isActive?: boolean } }) =>
      orgSettingsApi.updateProgram(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PROGRAMS_KEY })
      qc.invalidateQueries({ queryKey: TREE_KEY })
    },
  })
}

export function useDeleteProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => orgSettingsApi.deleteProgram(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PROGRAMS_KEY })
      qc.invalidateQueries({ queryKey: TREE_KEY })
    },
  })
}

export function useAssignProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orgUnitId, programId }: { orgUnitId: string; programId: string }) =>
      orgSettingsApi.assignProgram(orgUnitId, programId),
    onSuccess: () => qc.invalidateQueries({ queryKey: TREE_KEY }),
  })
}

export function useUnassignProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orgUnitId, programId }: { orgUnitId: string; programId: string }) =>
      orgSettingsApi.unassignProgram(orgUnitId, programId),
    onSuccess: () => qc.invalidateQueries({ queryKey: TREE_KEY }),
  })
}
