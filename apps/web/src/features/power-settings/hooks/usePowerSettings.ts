import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { powerSettingsApi } from '../services/powerSettingsApi'
import { sharedBrandingKeys } from '../../../shared/queryKeys'
import { powerSettingsKeys } from '../queryKeys'

const BRANDING_KEY = ['power-settings', 'branding'] as const
const MY_BRANDING_KEY = sharedBrandingKeys.mine()
const CLINICS_KEY = ['clinics'] as const

export function useMyBranding() {
  return useQuery({
    queryKey: MY_BRANDING_KEY,
    queryFn: () => powerSettingsApi.getMyBranding(),
  })
}

export function useAllBranding() {
  return useQuery({
    queryKey: BRANDING_KEY,
    queryFn: () => powerSettingsApi.getAllBranding(),
  })
}

export function useAllClinics() {
  return useQuery({
    queryKey: CLINICS_KEY,
    queryFn: () => powerSettingsApi.getAllClinics(),
  })
}

export function useClinicAiRuntimeSettings(clinicId: string) {
  return useQuery({
    queryKey: powerSettingsKeys.aiRuntime(clinicId),
    queryFn: () => powerSettingsApi.getClinicAiRuntimeSettings(clinicId),
    enabled: clinicId.length > 0,
  })
}

export function useAiRuntimeHealth() {
  return useQuery({
    queryKey: powerSettingsKeys.aiRuntimeHealth(),
    queryFn: () => powerSettingsApi.getAiRuntimeHealth(),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

export function useUpdateClinicAiRuntimeSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      clinicId,
      data,
    }: {
      clinicId: string
      data: {
        llmBackend?: 'local_ollama' | 'azure_openai'
        scribeRuntimeMode?: 'standard' | 'agentic'
        localStyleAdapterModelName?: string | null
      }
    }) => powerSettingsApi.setClinicAiRuntimeSettings(clinicId, data),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: powerSettingsKeys.aiRuntime(variables.clinicId) })
    },
  })
}

export function useUpsertBranding() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      clinicId,
      data,
    }: {
      clinicId: string
      data: { sidebarTitle?: string; sidebarSubtitle?: string; logoUrl?: string }
    }) => powerSettingsApi.upsertBranding(clinicId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BRANDING_KEY })
      qc.invalidateQueries({ queryKey: MY_BRANDING_KEY })
    },
  })
}
