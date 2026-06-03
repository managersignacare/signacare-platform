import { useQuery } from '@tanstack/react-query';
import { episodeApi } from '../services/episodeApi';
import type { EpisodeSearchDTO } from '../types/episodeTypes';

export const episodeQueryKeys = {
  all:            ['episodes'] as const,
  forPatient:     (patientId: string) => ['episodes', 'patient', patientId] as const,
  forPatientList: (patientId: string, filters?: Partial<EpisodeSearchDTO>) =>
                    ['episodes', 'patient', patientId, filters ?? {}] as const,
  detail:         (id: string) => ['episodes', 'detail', id] as const,
};

export function useEpisodes(
  patientId: string,
  filters?:  Partial<EpisodeSearchDTO>,
) {
  return useQuery({
    queryKey: episodeQueryKeys.forPatientList(patientId, filters),
    queryFn:  () => episodeApi.listForPatient(patientId, filters),
    enabled:  Boolean(patientId),
    staleTime: 30_000,
  });
}
