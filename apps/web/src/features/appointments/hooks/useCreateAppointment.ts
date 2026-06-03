// apps/web/src/features/appointments/hooks/useCreateAppointment.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { appointmentApi } from '../services/appointmentApi';
import type { CreateAppointment } from '../types/appointmentTypes';
import { appointmentQueryKeys } from './useAppointments';

export const useCreateAppointment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateAppointment) => appointmentApi.create(dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentQueryKeys.all });
    },
  });
};

type RecurrencePayload = CreateAppointment & {
  recurrenceRule: 'daily' | 'weekly' | 'fortnightly' | 'monthly';
  recurrenceEndDate: string;
  /** Optional days-of-week for weekly/fortnightly: 0=Sunday, 1=Monday ... 6=Saturday. */
  daysOfWeek?: number[];
};

export const useCreateRecurringAppointment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: RecurrencePayload) => {
      const needsDayExpansion = (dto.recurrenceRule === 'weekly' || dto.recurrenceRule === 'fortnightly')
        && dto.daysOfWeek && dto.daysOfWeek.length > 0;
      if (!needsDayExpansion) {
        return [await appointmentApi.createRecurring(dto)];
      }

      // Expand: for each selected day-of-week, shift the first occurrence to
      // that weekday and create one weekly/fortnightly recurring series.
      const baseStart = new Date(dto.startTime);
      const baseEnd = new Date(dto.endTime);
      const durationMs = baseEnd.getTime() - baseStart.getTime();
      const results = [];
      const uniqueDays = Array.from(new Set(dto.daysOfWeek!)).sort();
      for (const dow of uniqueDays) {
        const firstStart = new Date(baseStart);
        const shift = (dow - firstStart.getDay() + 7) % 7;
        firstStart.setDate(firstStart.getDate() + shift);
        const firstEnd = new Date(firstStart.getTime() + durationMs);
        results.push(
          await appointmentApi.createRecurring({
            ...dto,
            startTime: firstStart.toISOString(),
            endTime: firstEnd.toISOString(),
          }),
        );
      }
      return results;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentQueryKeys.all });
    },
  });
};