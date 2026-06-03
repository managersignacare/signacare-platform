import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { powerSettingsApi } from '../services/powerSettingsApi'
import { sharedBrandingKeys } from '../../../shared/queryKeys'

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
