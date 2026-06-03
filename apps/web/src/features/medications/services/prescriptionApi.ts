import { apiClient } from '../../../shared/services/apiClient';
import type { PrescriptionResponse, PrescriptionCreateDTO, PrescriptionCancelResponse } from '@signacare/shared';

const BASE = 'prescriptions';

export const prescriptionApi = {
  listByPatient: async (patientId: string): Promise<PrescriptionResponse[]> => {
    return apiClient.get<PrescriptionResponse[]>(
      `${BASE}/patients/${patientId}/prescriptions`,
    );
  },

  getById: async (id: string): Promise<PrescriptionResponse> => {
    return apiClient.get<PrescriptionResponse>(`${BASE}/${id}`);
  },

  create: async (dto: PrescriptionCreateDTO): Promise<PrescriptionResponse> => {
    return apiClient.post<PrescriptionResponse>(BASE, dto);
  },

  runSafeScriptCheck: async (
    id: string,
    identifier: SafeScriptIdentifierPayload,
  ): Promise<PrescriptionResponse> => {
    return apiClient.post<PrescriptionResponse>(
      `${BASE}/${id}/safescript-check`,
      identifier,
    );
  },

  submitErx: async (id: string, payload: ErxPayload): Promise<{ prescription: PrescriptionResponse; token: unknown }> => {
    return apiClient.post(`${BASE}/${id}/submit-erx`, payload);
  },

  // BUG-371b — REQUIRED expectedLockVersion per CLAUDE.md §1.6.
  // BUG-553 — REQUIRED reasonForCancellation (1..500) for AHPRA S8/SafeScript
  // forensic chain. Caller MUST prompt the clinician for a reason before
  // posting; empty / whitespace-only reasons are rejected by Zod at the API.
  // BUG-553 cycle-2 — response now carries dspRevocation status; UI must
  // distinguish 'revoked' (eScript token actually invalidated at DSP) from
  // 'pending' (local-only cancel; pharmacy may still dispense).
  cancel: async (
    id: string,
    expectedLockVersion: number,
    reasonForCancellation: string,
  ): Promise<PrescriptionCancelResponse> => {
    return apiClient.post<PrescriptionCancelResponse>(`${BASE}/${id}/cancel`, {
      expectedLockVersion,
      reasonForCancellation,
    });
  },
};

export interface SafeScriptIdentifierPayload {
  ihi?: string;
  medicareNumber?: string;
  medicareIrn?: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string;
}

export interface ErxPayload {
  prescriptionId: string;
  patientIhi: string;
  prescriberHpii: string;
  prescriberHpio: string;
  medicationName: string;
  dose: string;
  route: string;
  frequency: string;
  quantity: number;
  repeats: number;
  isS8: boolean;
  prescribedDate: string;
  pbsItemCode?: string;
  directions?: string;
  authorityMode?: 'general' | 'streamlined' | 'phone' | 'written' | 'private';
  authorityApprovalNumber?: string;
  isPrivateScript?: boolean;
  privateScriptNumber?: string;
  privatePriceCents?: number;
  repeatIntervalDays?: number;
  deferredUntilDate?: string;
}
