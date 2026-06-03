// apps/web/src/featurespathology/servicespathologyApi.ts
import { apiClient } from '../../../shared/services/apiClient';
import type {
  CreateLabOrderDTO,
  LabOrderResponse,
  LabResultResponse,
} from '../types/pathologyTypes';

export const pathologyApi = {
  listOrders: async (patientId: string): Promise<LabOrderResponse[]> => {
    return apiClient.get('pathology/orders', {
      params: { patientId },
    });
  },

  getOrder: async (id: string): Promise<LabOrderResponse> => {
    return apiClient.get(`pathology/orders/${id}`);
  },

  createOrder: async (dto: CreateLabOrderDTO): Promise<LabOrderResponse> => {
    return apiClient.post('pathology/orders', dto);
  },

  cancelOrder: async (id: string): Promise<void> => {
    await apiClient.patch(`pathology/orders/${id}/cancel`);
  },

  listResults: async (patientId: string): Promise<LabResultResponse[]> => {
    return apiClient.get('pathology/results', {
      params: { patientId },
    });
  },

  getResult: async (id: string): Promise<LabResultResponse> => {
    return apiClient.get(`pathology/results/${id}`);
  },

  acknowledgeCritical: async (resultId: string): Promise<LabResultResponse> => {
    return apiClient.post(
      `pathology/results/${resultId}/acknowledge`,
    );
  },
};
