import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { templateApi } from '../services/templateApi';
import { templateKeys } from '../queryKeys';
import type {
  CreateTemplateDTO, UpdateTemplateDTO, TemplateStatus,
} from '../types/templateTypes';

export const useTemplates = (params?: { status?: TemplateStatus; category?: string }) =>
  useQuery({
    queryKey: templateKeys.list(params),
    queryFn:  () => templateApi.list(params),
  });

export const useTemplate = (id: string) =>
  useQuery({
    queryKey: templateKeys.detail(id),
    queryFn:  () => templateApi.getById(id),
    enabled:  !!id,
  });

export const useCreateTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateTemplateDTO) => templateApi.create(dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: templateKeys.all }),
  });
};

export const useUpdateTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateTemplateDTO }) =>
      templateApi.update(id, dto),
    onSuccess: (tpl) => {
      void qc.invalidateQueries({ queryKey: templateKeys.all });
      void qc.invalidateQueries({ queryKey: templateKeys.detail(tpl.id) });
    },
  });
};

export const usePublishTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => templateApi.publish(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: templateKeys.all }),
  });
};

export const useRetireTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => templateApi.retire(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: templateKeys.all }),
  });
};
