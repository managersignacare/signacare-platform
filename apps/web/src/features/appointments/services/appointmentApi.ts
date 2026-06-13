// apps/web/src/features/appointments/services/appointmentApi.ts
import { apiClient } from '../../../shared/services/apiClient';
import type {
  Appointment,
  AppointmentFilters,
  AppointmentStatus,
  CreateAppointment,
} from '../types/appointmentTypes';

export const appointmentApi = {
  list: async (filters?: AppointmentFilters): Promise<Appointment[]> => {
    return apiClient.get<Appointment[]>('appointments', filters);
  },

  create: async (dto: CreateAppointment): Promise<Appointment> => {
    return apiClient.post<Appointment>('appointments', dto);
  },

  createRecurring: async (
    dto: CreateAppointment & { recurrenceRule: 'daily' | 'weekly' | 'fortnightly' | 'monthly'; recurrenceEndDate: string },
  ): Promise<Appointment[]> => {
    return apiClient.post<Appointment[]>('appointments/recurring', dto);
  },

  update: async (
    id: string,
    dto: Partial<Pick<CreateAppointment, 'startTime' | 'endTime' | 'type' | 'notes'> & {
      clinicianId?: string;
      episodeId?: string | null;
      mode?: CreateAppointment['mode'];
      attendeeStaffIds?: string[];
      telehealthDetails?: { telehealthLink: string; telehealthProvider?: string; telehealthPasscode?: string };
    }>,
  ): Promise<Appointment> => {
    return apiClient.patch<Appointment>(`appointments/${id}`, dto);
  },

  updateStatus: async (
    id: string,
    status: AppointmentStatus,
    checkInNotes?: string,
  ): Promise<Appointment> => {
    return apiClient.post<Appointment>(`appointments/${id}/status`, {
      status,
      checkInNotes,
    });
  },
};
