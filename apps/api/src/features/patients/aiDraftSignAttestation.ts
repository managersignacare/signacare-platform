import type { AuthContext } from '@signacare/shared';
import { AppError } from '../../shared/errors';
import { shouldEnforceAiDraftSignAttestation } from '../../shared/aiDraftSignAttestationPolicy';

type EnforceAiDraftSignAttestationArgs = {
  auth: AuthContext;
  isSigning: boolean;
  isAiDraft: boolean;
  reviewedAndAdopted?: boolean;
};

type EnforceAiDraftSignAttestationResult = {
  blocked: boolean;
  requiresReviewedAndAdopted: boolean;
};

export async function enforceAiDraftSignAttestationOrRespond({
  auth,
  isSigning,
  isAiDraft,
  reviewedAndAdopted,
}: EnforceAiDraftSignAttestationArgs): Promise<EnforceAiDraftSignAttestationResult> {
  if (!isSigning) {
    return { blocked: false, requiresReviewedAndAdopted: false };
  }

  const enforceAiDraftAttestation = await shouldEnforceAiDraftSignAttestation(auth);
  const requiresReviewedAndAdopted = enforceAiDraftAttestation && isAiDraft;

  if (requiresReviewedAndAdopted && reviewedAndAdopted !== true) {
    throw new AppError(
      'This AI-drafted note requires explicit review and adoption attestation before signing.',
      409,
      'REVIEW_AND_ADOPT_REQUIRED',
    );
  }

  return { blocked: false, requiresReviewedAndAdopted };
}

export function reviewedAndAdoptedPatch(
  requiresReviewedAndAdopted: boolean,
  staffId: string | null,
): Record<string, unknown> {
  if (!requiresReviewedAndAdopted) {
    return {};
  }

  return {
    reviewed_and_adopted_by_id: staffId,
    reviewed_and_adopted_at: new Date(),
  };
}
