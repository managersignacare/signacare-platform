import { apiClient } from '../../../shared/services/apiClient';
import type {
  CreateReferral,
  Referral,
  ReferralDecision,
  ReferralFilters,
  ReferralWorkflowEvent,
} from '../types/intakeTypes';
import type {
  ReferralOffer,
  RespondToOfferDTO,
  ClarificationRequestDTO,
  ClarificationResponseDTO,
  ReferralFeedbackLog,
  MyOffersFilters,
} from '@signacare/shared';

export const intakeApi = {
  list: async (filters?: ReferralFilters): Promise<Referral[]> => {
    const response = await apiClient.get<Referral[] | { items?: Referral[] }>('referrals', filters);
    if (Array.isArray(response)) return response;
    return response.items ?? [];
  },

  getById: async (id: string): Promise<Referral> => {
    return apiClient.get<Referral>(`referrals/${id}`);
  },

  create: async (dto: CreateReferral): Promise<Referral> => {
    return apiClient.post<Referral>('referrals', dto);
  },

  decide: async (id: string, dto: ReferralDecision): Promise<Referral> => {
    return apiClient.post<Referral>(`referrals/${id}/decision`, dto);
  },

  uploadLetter: async (id: string, file: File): Promise<Referral> => {
    const formData = new FormData();
    formData.append('file', file);

    return apiClient.instance
      .post<Referral>(`referrals/${id}/letter`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },

  getWorkflowEvents: async (id: string): Promise<ReferralWorkflowEvent[]> => {
    return apiClient.get<ReferralWorkflowEvent[]>(`referrals/${id}/events`);
  },

  // ── Solo & Team Module APIs ────────────────────────────────────────────

  getMyOffers: async (filters?: MyOffersFilters): Promise<{ items: ReferralOffer[]; total: number }> => {
    return apiClient.get('referrals/my-offers', { params: filters });
  },

  respondToOffer: async (
    referralId: string,
    offerId: string,
    dto: RespondToOfferDTO,
  ): Promise<{ ok: boolean; response: string }> => {
    return apiClient.post(`referrals/${referralId}/offers/${offerId}/respond`, dto);
  },

  broadcastReferral: async (
    referralId: string,
    opts?: { distributionMode?: string; distributionSpeciality?: string },
  ): Promise<{ ok: boolean }> => {
    return apiClient.post(`referrals/${referralId}/broadcast`, opts ?? {});
  },

  requestClarification: async (
    referralId: string,
    dto: ClarificationRequestDTO,
  ): Promise<{ ok: boolean }> => {
    return apiClient.post(`referrals/${referralId}/clarification`, dto);
  },

  addClarificationResponse: async (
    referralId: string,
    dto: ClarificationResponseDTO,
  ): Promise<{ ok: boolean }> => {
    return apiClient.patch(`referrals/${referralId}/clarification-response`, dto);
  },

  getReferralOffers: async (referralId: string): Promise<{ items: ReferralOffer[] }> => {
    return apiClient.get(`referrals/${referralId}/offers`);
  },

  getReferralFeedbackLog: async (referralId: string): Promise<{ items: ReferralFeedbackLog[] }> => {
    return apiClient.get(`referrals/${referralId}/feedback-log`);
  },
};
