// apps/web/src/features/waitlist/services/waitlistApi.ts
import { apiClient } from '../../../shared/services/apiClient';
import type {
  WaitlistCreateDTO,
  WaitlistEntryResponse,
  AppointmentResponse,
  CreateAppointmentDTO,
} from '@signacare/shared';

export const waitlistApi = {
  list: (params: { patientId?: string; status?: string; priority?: string }) =>
    apiClient.get<WaitlistEntryResponse[]>('waitlist', { params }),

  create: (payload: WaitlistCreateDTO) =>
    apiClient.post<WaitlistEntryResponse>('waitlist', payload),

  update: (id: string, payload: Partial<WaitlistCreateDTO>) =>
    apiClient.patch<WaitlistEntryResponse>(`waitlist/${id}`, payload),

  promote: (id: string, appointment: CreateAppointmentDTO) =>
    apiClient.post<AppointmentResponse>(`waitlist/${id}/promote`, appointment),
};
