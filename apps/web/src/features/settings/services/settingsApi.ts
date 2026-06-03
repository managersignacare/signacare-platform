// apps/web/src/features/settings/services/settingsApi.ts
import { apiClient } from '../../../shared/services/apiClient'

export const settingsApi = {
  getThresholds(): Promise<Record<string, number>> {
    return apiClient
      .get<{ thresholds: Record<string, number> }>('settings/thresholds')
      .then((r) => r.thresholds)
  },

  setThreshold(key: string, value: number): Promise<void> {
    return apiClient
      .put<void>('settings/thresholds', { key, value })
  },

  bulkSetThresholds(thresholds: Record<string, number>): Promise<void> {
    return apiClient
      .put<void>('settings/thresholds/bulk', { thresholds })
  },
}
