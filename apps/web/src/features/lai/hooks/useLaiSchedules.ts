import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { laiApi } from '../services/laiApi';
import { laiKeys } from '../queryKeys';
import type {
  LaiScheduleCreateDTO,
  LaiScheduleUpdateDTO,
  LaiGivenCreateDTO,
  AimsAssessmentCreateDTO,
} from '@signacare/shared';

export const useLaiSchedules = (patientId: string) =>
  useQuery({
    queryKey: laiKeys.schedules(patientId),
    queryFn: () => laiApi.listByPatient(patientId),
    enabled: !!patientId,
    staleTime: 30_000,
  });

export const useCreateLaiSchedule = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: LaiScheduleCreateDTO) => laiApi.create(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: laiKeys.schedules(patientId) }),
  });
};

export const useUpdateLaiSchedule = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: LaiScheduleUpdateDTO }) =>
      laiApi.update(id, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: laiKeys.schedules(patientId) }),
  });
};

export const useLaiGiven = (scheduleId: string) =>
  useQuery({
    queryKey: laiKeys.given(scheduleId),
    queryFn: () => laiApi.listGiven(scheduleId),
    enabled: !!scheduleId,
    staleTime: 30_000,
  });

export const useRecordLaiGiven = (patientId: string, scheduleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: LaiGivenCreateDTO) => laiApi.recordGiven(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: laiKeys.schedules(patientId) });
      qc.invalidateQueries({ queryKey: laiKeys.given(scheduleId) });
    },
  });
};

export const useAimsAssessments = (patientId: string, scheduleId?: string) =>
  useQuery({
    queryKey: laiKeys.aims(patientId, scheduleId),
    queryFn: () => laiApi.listAimsAssessments(patientId, scheduleId),
    enabled: !!patientId,
    staleTime: 60_000,
  });

export const useCreateAimsAssessment = (patientId: string, scheduleId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: AimsAssessmentCreateDTO) => laiApi.createAimsAssessment(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: laiKeys.aims(patientId, scheduleId) });
      qc.invalidateQueries({ queryKey: laiKeys.schedules(patientId) });
    },
  });
};
