import { useState } from 'react';
import { canSignAiDraftNote, requiresAiDraftSignAttestation } from '../../../../shared/utils/aiDraftSignAttestation';

type UseAiDraftSignAttestationArgs = {
  isAiDraftNote: boolean;
  saveError: string;
  setSaveError: (value: string) => void;
};

const AI_DRAFT_SIGN_ATTESTATION_ERROR =
  'Please confirm you reviewed and adopted this AI draft before signing.';

export function useAiDraftSignAttestation({
  isAiDraftNote,
  saveError,
  setSaveError,
}: UseAiDraftSignAttestationArgs) {
  const [reviewedAndAdopted, setReviewedAndAdopted] = useState(false);

  const requiresAiDraftAttestation = requiresAiDraftSignAttestation(isAiDraftNote);
  const canSign = canSignAiDraftNote(isAiDraftNote, reviewedAndAdopted);

  const onReviewedAndAdoptedChange = (checked: boolean) => {
    setReviewedAndAdopted(checked);
    if (checked && saveError.includes('reviewed and adopted')) {
      setSaveError('');
    }
  };

  const ensureCanSignAiDraft = (): boolean => {
    if (canSign) {
      return true;
    }
    setSaveError(AI_DRAFT_SIGN_ATTESTATION_ERROR);
    return false;
  };

  const resetReviewedAndAdopted = () => setReviewedAndAdopted(false);

  return {
    reviewedAndAdopted,
    requiresAiDraftAttestation,
    canSign,
    onReviewedAndAdoptedChange,
    ensureCanSignAiDraft,
    resetReviewedAndAdopted,
  };
}
