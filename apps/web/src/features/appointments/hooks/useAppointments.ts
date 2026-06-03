// apps/web/src/features/appointments/hooks/useAppointments.ts
import { useQuery } from '@tanstack/react-query';
import { appointmentApi } from '../services/appointmentApi';
import { appointmentKeys } from '../queryKeys';
import type { AppointmentFilters } from '../types/appointmentTypes';

// Legacy alias — kept so existing call sites keep compiling while we migrate
// every import to `appointmentKeys` from `../queryKeys`. The canonical factory
// now lives in apps/web/src/features/appointments/queryKeys.ts.
export const appointmentQueryKeys = appointmentKeys;

export const useAppointments = (filters?: AppointmentFilters) =>
  useQuery({
    queryKey: appointmentKeys.list(filters),
    queryFn: () => appointmentApi.list(filters),
    staleTime: 30_000,
  });