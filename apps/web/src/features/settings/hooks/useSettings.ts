// apps/web/src/features/settings/hooks/useSettings.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '../services/settingsApi'

const QUERY_KEY = ['settings', 'thresholds'] as const

export function useThresholds() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => settingsApi.getThresholds(),
  })
}

export function useSetThreshold() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: number }) =>
      settingsApi.setThreshold(key, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  })
}

export function useBulkSetThresholds() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (thresholds: Record<string, number>) =>
      settingsApi.bulkSetThresholds(thresholds),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  })
}

