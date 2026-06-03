import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { llmAmbientApi } from '../../../shared/services/llmAmbientApi';
import type { LLMSoapResponse } from '../../../shared/types/llmTypes';

export const useAmbientNote = () => {
  const [draft, setDraft] = useState<LLMSoapResponse | null>(null);

  const {
    mutate: generateDraft,
    isPending: isGenerating,
    error,
    reset,
    // @no-invalidate-needed: ambient draft generation is local/ephemeral state and does not mutate query-backed records.
  } = useMutation({
    mutationFn: ({
      audioBlob,
      patientId,
      consentId,
    }: {
      audioBlob: Blob;
      patientId: string;
      consentId: string;
    }) => llmAmbientApi.generateAmbientNoteDraft(audioBlob, { patientId, consentId }),
    onSuccess: (result) => setDraft(result),
  });

  const clearDraft = () => {
    setDraft(null);
    reset();
  };

  return { generateDraft, isGenerating, error, draft, clearDraft };
};
