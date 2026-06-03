import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  FIRST_VISIT_CHART_REVIEW_BYPASS_FLAG,
  FIRST_VISIT_CHART_REVIEW_GATED_NOTE_TYPES,
} from '@signacare/shared';
import { apiClient } from '../../../../shared/services/apiClient';
import { useFeatureFlag } from '../../../../shared/hooks/useFeatureFlag';
import { patientsKeys } from '../../queryKeys';

const FIRST_VISIT_CHART_REVIEW_ERROR =
  'First-visit chart review is required before signing. Review recent labs, imaging, and medications.';

type ExistingNoteForFirstVisitGate = {
  noteType?: string;
  status?: string;
};

type FirstVisitChartReviewPayload = {
  recentLabsReviewed: boolean;
  recentImagingReviewed: boolean;
  recentMedicationsReviewed: boolean;
  reviewedAt: string;
};

type UseFirstVisitChartReviewGateArgs = {
  open: boolean;
  patientId: string;
  noteType: string;
};

export function useFirstVisitChartReviewGate({
  open,
  patientId,
  noteType,
}: UseFirstVisitChartReviewGateArgs) {
  const firstVisitChartReviewBypass = useFeatureFlag(FIRST_VISIT_CHART_REVIEW_BYPASS_FLAG);
  const [reviewedRecentLabs, setReviewedRecentLabs] = useState(false);
  const [reviewedRecentImaging, setReviewedRecentImaging] = useState(false);
  const [reviewedRecentMedications, setReviewedRecentMedications] = useState(false);

  const { data: existingNotes } = useQuery({
    queryKey: patientsKeys.notes(patientId),
    queryFn: () =>
      apiClient
        .get<{ notes?: ExistingNoteForFirstVisitGate[] }>(`patients/${patientId}/notes`)
        .then((r) => r.notes ?? []),
    enabled: open && !!patientId,
  });

  useEffect(() => {
    if (!open) return;
    setReviewedRecentLabs(false);
    setReviewedRecentImaging(false);
    setReviewedRecentMedications(false);
  }, [open, patientId]);

  const gatedNoteTypes = FIRST_VISIT_CHART_REVIEW_GATED_NOTE_TYPES as readonly string[];
  const isChartReviewGatedNoteType = gatedNoteTypes.includes(noteType);
  const hasPriorSignedGatedNote = (existingNotes ?? []).some(
    (n: ExistingNoteForFirstVisitGate) =>
      n.status === 'signed' &&
      typeof n.noteType === 'string' &&
      gatedNoteTypes.includes(n.noteType),
  );
  const requiresFirstVisitChartReview =
    !firstVisitChartReviewBypass &&
    isChartReviewGatedNoteType &&
    !hasPriorSignedGatedNote;
  const hasCompletedFirstVisitChartReview =
    reviewedRecentLabs &&
    reviewedRecentImaging &&
    reviewedRecentMedications;
  const canSignFirstVisitChartReview =
    !requiresFirstVisitChartReview || hasCompletedFirstVisitChartReview;

  const buildFirstVisitChartReviewPayload = (
    status: string,
  ): FirstVisitChartReviewPayload | undefined => {
    if (status !== 'signed' || !requiresFirstVisitChartReview) return undefined;
    return {
      recentLabsReviewed: reviewedRecentLabs,
      recentImagingReviewed: reviewedRecentImaging,
      recentMedicationsReviewed: reviewedRecentMedications,
      reviewedAt: new Date().toISOString(),
    };
  };

  const ensureCanSignFirstVisitChartReview = (
    setSaveError: (message: string) => void,
  ): boolean => {
    if (canSignFirstVisitChartReview) return true;
    setSaveError(FIRST_VISIT_CHART_REVIEW_ERROR);
    return false;
  };

  const resetFirstVisitChartReview = () => {
    setReviewedRecentLabs(false);
    setReviewedRecentImaging(false);
    setReviewedRecentMedications(false);
  };

  return {
    requiresFirstVisitChartReview,
    canSignFirstVisitChartReview,
    reviewedRecentLabs,
    reviewedRecentImaging,
    reviewedRecentMedications,
    setReviewedRecentLabs,
    setReviewedRecentImaging,
    setReviewedRecentMedications,
    buildFirstVisitChartReviewPayload,
    ensureCanSignFirstVisitChartReview,
    resetFirstVisitChartReview,
  };
}
