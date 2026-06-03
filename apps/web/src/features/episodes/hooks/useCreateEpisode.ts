import { useMutation, useQueryClient } from '@tanstack/react-query';
import { episodeApi }       from '../services/episodeApi';
import { episodeQueryKeys } from './useEpisodes';
import type {
  CreateEpisodeDTO,
  UpdateEpisodeDTO,
  CloseEpisodeDTO,
} from '../types/episodeTypes';

export function useCreateEpisode(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateEpisodeDTO) => episodeApi.create(dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: episodeQueryKeys.forPatient(patientId),
      });
    },
  });
}

export function useUpdateEpisode(patientId: string, episodeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: UpdateEpisodeDTO) => episodeApi.update(episodeId, dto),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: episodeQueryKeys.forPatient(patientId) });
      queryClient.setQueryData(episodeQueryKeys.detail(episodeId), updated);
    },
  });
}

export function useCloseEpisode(patientId: string, episodeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CloseEpisodeDTO) => episodeApi.close(episodeId, dto),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: episodeQueryKeys.forPatient(patientId) });
      queryClient.setQueryData(episodeQueryKeys.detail(episodeId), updated);
    },
  });
}
