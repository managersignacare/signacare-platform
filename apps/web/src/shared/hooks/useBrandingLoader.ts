import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../services/apiClient'
import { sharedBrandingKeys } from '../queryKeys'
import { useBrandingStore } from '../store/brandingStore'

export function useBrandingLoader(): void {
  const setBranding = useBrandingStore((s) => s.setBranding)

  const { data, isFetched } = useQuery({
    queryKey: sharedBrandingKeys.mine(),
    queryFn: () =>
      apiClient
        .get<{ branding: { sidebarTitle?: string; sidebarSubtitle?: string; logoUrl?: string } | null }>(
          'power-settings/branding/me',
        )
        .then((r) => r.branding),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (!isFetched) return
    // Fail-closed against stale tenant chrome: when the API returns
    // null (no branding row for this clinic), reset to defaults
    // instead of retaining the previous clinic's branding in store.
    setBranding(data ?? {})
  }, [data, isFetched, setBranding])
}
