import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { taskApi } from '../services/taskApi';
import { tasksKeys } from '../queryKeys';
import type { CreateTaskDTO, UpdateTaskDTO } from '../types/taskTypes';

export const useTasks = (params: {
  patientId?: string;
  assignedToId?: string;
  status?: string;
  priority?: string;
  teamId?: string;
}) =>
  useQuery({
    queryKey: tasksKeys.list(params),
    queryFn: () => taskApi.list(params),
  });

export const useTask = (id: string) =>
  useQuery({
    queryKey: tasksKeys.detail(id),
    queryFn: () => taskApi.getById(id),
    enabled: !!id,
  });

export const useCreateTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateTaskDTO) => taskApi.create(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKeys.all }),
  });
};

export const useUpdateTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateTaskDTO }) =>
      taskApi.update(id, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKeys.all }),
  });
};

export const useCompleteTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => taskApi.complete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKeys.all }),
  });
};

export const useDeleteTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => taskApi.softDelete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKeys.all }),
  });
};
