// apps/web/src/features/patients/services/patientApi.ts
import type {
  CreatePatientDTO,
  UpdatePatientDTO,
  PatientResponse,
  PaginatedResponse,
} from '@signacare/shared';
import { apiClient } from '../../../services/apiClient';
import type { PatientFlagResponse } from '../types/patientTypes';

export type PatientSearchDTO = Record<string, string | number | boolean | undefined>;

export const patientApi = {
  async listPatients(filters: PatientSearchDTO): Promise<PaginatedResponse<PatientResponse>> {
    return apiClient.get<PaginatedResponse<PatientResponse>>('patients', filters as Record<string, unknown>);
  },

  async getPatient(id: string): Promise<PatientResponse> {
    return apiClient.get<PatientResponse>(`patients/${id}`);
  },

  async createPatient(dto: CreatePatientDTO): Promise<PatientResponse> {
    return apiClient.post<PatientResponse>('patients', dto);
  },

  async updatePatient(id: string, dto: UpdatePatientDTO): Promise<PatientResponse> {
    return apiClient.patch<PatientResponse>(`patients/${id}`, dto);
  },

  async deletePatient(id: string): Promise<void> {
    await apiClient.delete(`patients/${id}`);
  },

  async getPatientFlags(patientId: string): Promise<PatientFlagResponse[]> {
    return apiClient.get<PatientFlagResponse[]>(
      `patients/${patientId}/flags`,
    );
  },

  async getPatientContacts(patientId: string): Promise<{ contacts: PatientContact[] }> {
    return apiClient.get<{ contacts: PatientContact[] }>(`patients/${patientId}/contacts`);
  },
};

export interface PatientContact {
  id: string;
  givenName: string | null;
  familyName: string | null;
  relationship: string | null;
  phoneMobile: string | null;
  phoneHome: string | null;
  email: string | null;
  isEmergencyContact: boolean;
  isCarer: boolean;
  hasConsent: boolean;
  consentLevel?: 'full' | 'partial' | 'emergency_only' | '';
  consentNotes?: string | null;
}
