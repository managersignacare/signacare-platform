// apps/web/src/features/patients/hooks/useProviderSearch.ts
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../services/apiClient';
import { patientsKeys } from '../queryKeys';

export interface NhsdProvider {
  id: string;
  name: string;
  givenName?: string;
  familyName?: string;
  practiceName?: string;
  providerNumber?: string;
  specialty?: string;
  phone?: string;
  fax?: string;
  email?: string;
  address: {
    street?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
    formatted?: string;
  };
}

interface NhsdSearchResult {
  providers: NhsdProvider[];
  total: number;
  error?: string;
}

export function useProviderSearch(query: string, postcode?: string) {
  return useQuery<NhsdSearchResult>({
    queryKey: patientsKeys.providerSearchByPostcode(query, postcode),
    queryFn: () => {
      const params = new URLSearchParams();
      if (query) params.set('name', query);
      if (postcode) params.set('postcode', postcode);
      params.set('limit', '10');
      return apiClient.get<NhsdSearchResult>(`nhsd/providers/search?${params}`);
    },
    enabled: query.length >= 2,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useNhsdStatus() {
  return useQuery<{ configured: boolean }>({
    queryKey: patientsKeys.providerStatus(),
    queryFn: () => apiClient.get<{ configured: boolean }>('nhsd/status'),
    staleTime: 300_000,
  });
}
