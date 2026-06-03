// apps/web/src/features/voice/services/voiceApi.ts
import { apiClient } from '@/shared/services/apiClient';
import type { VoiceCall, VoiceTranscript, VoiceOptOut, VoiceCallFilters } from '../types/voiceTypes';

const BASE = '/voice';

export const voiceApi = {
  listCalls: async (filters: VoiceCallFilters): Promise<VoiceCall[]> => {
    return apiClient.get<VoiceCall[]>(`${BASE}/calls`, { params: filters });
  },

  getCall: async (callId: string): Promise<VoiceCall> => {
    return apiClient.get<VoiceCall>(`${BASE}/calls/${callId}`);
  },

  getTranscript: async (transcriptId: string): Promise<VoiceTranscript> => {
    return apiClient.get<VoiceTranscript>(
      `${BASE}/transcripts/${transcriptId}`,
    );
  },

  requestTranscript: async (callId: string): Promise<{ jobId: string }> => {
    return apiClient.post<{ jobId: string }>(
      `${BASE}/calls/${callId}/transcribe`,
    );
  },

  setOptOut: async (
    payload: VoiceOptOut,
  ): Promise<{ patientId: string; optedOut: boolean }> => {
    return apiClient.patch<{ patientId: string; optedOut: boolean }>(
      `${BASE}/patients/${payload.patientId}/opt-out`,
      { optedOut: payload.optedOut, reason: payload.reason },
    );
  },

  addCallNote: async (callId: string, notes: string): Promise<VoiceCall> => {
    return apiClient.patch<VoiceCall>(
      `${BASE}/calls/${callId}/notes`,
      { notes },
    );
  },

  linkCallToEncounter: async (
    callId: string,
    encounterId: string,
  ): Promise<VoiceCall> => {
    return apiClient.patch<VoiceCall>(
      `${BASE}/calls/${callId}/link-encounter`,
      { encounterId },
    );
  },
};
