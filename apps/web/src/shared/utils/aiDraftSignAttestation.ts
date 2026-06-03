export function requiresAiDraftSignAttestation(
  isAiDraft: boolean,
): boolean {
  return isAiDraft;
}

export function canSignAiDraftNote(
  isAiDraft: boolean,
  reviewedAndAdopted: boolean,
): boolean {
  if (!requiresAiDraftSignAttestation(isAiDraft)) {
    return true;
  }
  return reviewedAndAdopted;
}
