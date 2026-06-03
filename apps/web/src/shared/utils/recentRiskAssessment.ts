import { RECENT_RISK_ASSESSMENT_WINDOW_HOURS } from '@signacare/shared';

type RiskAssessmentLike = {
  assessmentDate?: string | null;
  createdAt?: string | null;
};

export function resolveRiskAssessmentCompletionTime(
  assessment: RiskAssessmentLike,
): Date | null {
  const fromCreatedAt = parseAnyDate(assessment.createdAt);
  if (fromCreatedAt) return fromCreatedAt;

  const assessmentDate =
    typeof assessment.assessmentDate === 'string'
      ? assessment.assessmentDate
      : null;
  if (!assessmentDate) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(assessmentDate)) return null;

  return new Date(`${assessmentDate}T23:59:59.999Z`);
}

export function hasRecentRiskAssessment(
  assessments: readonly RiskAssessmentLike[],
  now: Date = new Date(),
): boolean {
  const latest = [...assessments]
    .map(resolveRiskAssessmentCompletionTime)
    .filter((candidate): candidate is Date => candidate !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (!latest) return false;

  const windowMs = RECENT_RISK_ASSESSMENT_WINDOW_HOURS * 60 * 60 * 1000;
  return now.getTime() - latest.getTime() <= windowMs;
}

function parseAnyDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
