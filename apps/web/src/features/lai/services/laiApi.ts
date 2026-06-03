import { apiClient } from '../../../shared/services/apiClient';
import type {
  LaiScheduleResponse,
  LaiScheduleCreateDTO,
  LaiScheduleUpdateDTO,
  LaiGivenResponse,
  LaiGivenCreateDTO,
  AimsAssessmentResponse,
  AimsAssessmentCreateDTO,
} from '@signacare/shared';

export const laiApi = {
  listByPatient: async (patientId: string): Promise<LaiScheduleResponse[]> => {
    return apiClient.get<LaiScheduleResponse[]>(
      `patients/${patientId}/lai-schedules`,
    );
  },

  getById: async (id: string): Promise<LaiScheduleResponse> => {
    return apiClient.get<LaiScheduleResponse>(`lai-schedules/${id}`);
  },

  create: async (dto: LaiScheduleCreateDTO): Promise<LaiScheduleResponse> => {
    return apiClient.post<LaiScheduleResponse>('lai-schedules', dto);
  },

  update: async (id: string, dto: LaiScheduleUpdateDTO): Promise<LaiScheduleResponse> => {
    return apiClient.patch<LaiScheduleResponse>(`lai-schedules/${id}`, dto);
  },

  listGiven: async (scheduleId: string): Promise<LaiGivenResponse[]> => {
    return apiClient.get<LaiGivenResponse[]>(
      `lai-schedules/${scheduleId}/given`,
    );
  },

  recordGiven: async (dto: LaiGivenCreateDTO): Promise<LaiGivenResponse> => {
    return apiClient.post<LaiGivenResponse>('lai-schedules/given', dto);
  },

  listAimsAssessments: async (
    patientId: string,
    scheduleId?: string,
  ): Promise<AimsAssessmentResponse[]> => {
    return apiClient.get<AimsAssessmentResponse[]>(
      `patients/${patientId}/aims-assessments`,
      { params: { scheduleId } },
    );
  },

  createAimsAssessment: async (dto: AimsAssessmentCreateDTO): Promise<AimsAssessmentResponse> => {
    return apiClient.post<AimsAssessmentResponse>(
      'lai-schedules/aims-assessments',
      dto,
    );
  },
};
