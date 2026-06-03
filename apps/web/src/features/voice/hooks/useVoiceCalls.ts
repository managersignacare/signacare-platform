// apps/web/src/features/voice/hooks/useVoiceCalls.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { voiceApi } from '../services/voiceApi';
import type { VoiceCallFilters, VoiceOptOut } from '../types/voiceTypes';

export const voiceKeys = {
  all: ['voice'] as const,
  calls: (filters: VoiceCallFilters) =>
    [...voiceKeys.all, 'calls', filters] as const,
  call: (callId: string) =>
    [...voiceKeys.all, 'calls', callId] as const,
  transcript: (transcriptId: string) =>
    [...voiceKeys.all, 'transcripts', transcriptId] as const,
};

export function useVoiceCalls(filters: VoiceCallFilters) {
  return useQuery({
    queryKey: voiceKeys.calls(filters),
    queryFn: () => voiceApi.listCalls(filters),
    staleTime: 2 * 60 * 1_000,
  });
}

export function useVoiceCall(callId: string) {
  return useQuery({
    queryKey: voiceKeys.call(callId),
    queryFn: () => voiceApi.getCall(callId),
    enabled: Boolean(callId),
  });
}

export function useVoiceTranscript(transcriptId: string | null) {
  return useQuery({
    queryKey: voiceKeys.transcript(transcriptId ?? ''),
    queryFn: () => voiceApi.getTranscript(transcriptId!),
    enabled: Boolean(transcriptId),
  });
}

export function useRequestTranscript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (callId: string) => voiceApi.requestTranscript(callId),
    onSuccess: (_, callId) => {
      void qc.invalidateQueries({ queryKey: voiceKeys.call(callId) });
    },
  });
}

export function useSetOptOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: VoiceOptOut) => voiceApi.setOptOut(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: voiceKeys.all });
    },
  });
}

export function useAddCallNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ callId, notes }: { callId: string; notes: string }) =>
      voiceApi.addCallNote(callId, notes),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: voiceKeys.call(vars.callId) });
    },
  });
}
