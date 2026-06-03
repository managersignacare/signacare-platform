// apps/web/src/features/patient-outreach/api.ts
//
// Phase 12E — apiClient wrappers for the clinician-facing Patient
// Delivery Panel. Relative paths per the URL1-15 fix-registry rule.
import type {
  OutreachLogResponse,
  PatientDeliveryProfileResponse,
  SendOutreachDTO,
  SetSmsConsentDTO,
} from '@signacare/shared';
import { apiClient } from '../../shared/services/apiClient';

export async function getDeliveryProfile(patientId: string): Promise<PatientDeliveryProfileResponse> {
  return apiClient.get<PatientDeliveryProfileResponse>(`patient-outreach/delivery-profile/${patientId}`);
}

export async function setSmsConsent(patientId: string, dto: SetSmsConsentDTO): Promise<{ ok: true }> {
  return apiClient.post<{ ok: true }>(`patient-outreach/delivery-profile/${patientId}/consent`, dto);
}

export async function sendOutreach(dto: SendOutreachDTO): Promise<{
  channel: 'fcm' | 'acs_sms' | 'skipped';
  logId: string;
  overridden: boolean;
  skipReason?: string;
}> {
  return apiClient.post('patient-outreach/send', dto);
}

export async function getDeliveryLogs(patientId: string): Promise<{ items: OutreachLogResponse[] }> {
  return apiClient.get<{ items: OutreachLogResponse[] }>(`patient-outreach/logs/${patientId}`);
}
