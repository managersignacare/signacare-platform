import { useQuery } from '@tanstack/react-query';
import {
  RECENT_RISK_ASSESSMENT_BYPASS_FLAG,
  RECENT_RISK_ASSESSMENT_GATED_NOTE_TYPES,
  RECENT_RISK_ASSESSMENT_WINDOW_HOURS,
} from '@signacare/shared';
import { apiClient } from '../../../../shared/services/apiClient';
import { useFeatureFlag } from '../../../../shared/hooks/useFeatureFlag';
import {
  hasRecentRiskAssessment,
  resolveRiskAssessmentCompletionTime,
} from '../../../../shared/utils/recentRiskAssessment';
import { patientsKeys, riskAllergiesKeys } from '../../queryKeys';

const RECENT_RISK_ASSESSMENT_ERROR =
  `A risk assessment completed within the last ${RECENT_RISK_ASSESSMENT_WINDOW_HOURS} hours is required before signing this first psychiatric note for a new patient.`;

type ExistingNoteForRiskGate = {
  noteType?: string;
  status?: string;
};

type RiskAssessmentForGate = {
  assessmentDate?: string | null;
  createdAt?: string | null;
};

type UseRecentRiskAssessmentSignGateArgs = {
  open: boolean;
  patientId: string;
  noteType: string;
};

export function useRecentRiskAssessmentSignGate({
  open,
  patientId,
  noteType,
}: UseRecentRiskAssessmentSignGateArgs) {
  const recentRiskAssessmentBypass = useFeatureFlag(RECENT_RISK_ASSESSMENT_BYPASS_FLAG);

  const { data: existingNotes, isLoading: notesLoading } = useQuery({
    queryKey: patientsKeys.notes(patientId),
    queryFn: () =>
      apiClient
        .get<{ notes?: ExistingNoteForRiskGate[] }>(`patients/${patientId}/notes`)
        .then((r) => r.notes ?? []),
    enabled: open && !!patientId,
  });

  const { data: riskAssessments, isLoading: risksLoading } = useQuery({
    queryKey: riskAllergiesKeys.risks(patientId),
    queryFn: () =>
      apiClient.get<RiskAssessmentForGate[]>(`patients/${patientId}/risk-assessments`),
    enabled: open && !!patientId,
  });

  const gatedNoteTypes = RECENT_RISK_ASSESSMENT_GATED_NOTE_TYPES as readonly string[];
  const isRiskGatedNoteType = gatedNoteTypes.includes(noteType);
  const hasPriorSignedGatedNote = (existingNotes ?? []).some(
    (n: ExistingNoteForRiskGate) =>
      n.status === 'signed' &&
      typeof n.noteType === 'string' &&
      gatedNoteTypes.includes(n.noteType),
  );

  const requiresRecentRiskAssessment =
    !recentRiskAssessmentBypass &&
    isRiskGatedNoteType &&
    !hasPriorSignedGatedNote;
  const hasRecentRisk = hasRecentRiskAssessment(riskAssessments ?? []);
  const isCheckingRecentRiskAssessment = requiresRecentRiskAssessment && (notesLoading || risksLoading);
  const canSignRecentRiskAssessment =
    !requiresRecentRiskAssessment ||
    (hasRecentRisk && !isCheckingRecentRiskAssessment);

  const latestRiskAssessmentAt = [...(riskAssessments ?? [])]
    .map(resolveRiskAssessmentCompletionTime)
    .filter((candidate): candidate is Date => candidate !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const ensureCanSignRecentRiskAssessment = (
    setSaveError: (message: string) => void,
  ): boolean => {
    if (canSignRecentRiskAssessment) return true;
    setSaveError(RECENT_RISK_ASSESSMENT_ERROR);
    return false;
  };

  return {
    requiresRecentRiskAssessment,
    hasRecentRiskAssessment: hasRecentRisk,
    canSignRecentRiskAssessment,
    isCheckingRecentRiskAssessment,
    latestRiskAssessmentAtIso: latestRiskAssessmentAt?.toISOString() ?? null,
    ensureCanSignRecentRiskAssessment,
  };
}
