import type { Knex } from 'knex';
import type { AuthContext } from '@signacare/shared';
import {
  RECENT_RISK_ASSESSMENT_GATED_NOTE_TYPES,
  RECENT_RISK_ASSESSMENT_WINDOW_HOURS,
  isRecentRiskAssessmentGatedNoteType,
} from '@signacare/shared';
import { shouldEnforceRecentRiskAssessment } from './recentRiskAssessmentPolicy';

type EvaluateRecentRiskAssessmentSignGateArgs = {
  dbConn: Knex;
  auth: AuthContext;
  patientId: string;
  noteType: string | null | undefined;
  isSigning: boolean;
  currentNoteId?: string;
  now?: Date;
};

type LatestRiskAssessmentRow = {
  assessment_date?: unknown;
  created_at?: unknown;
};

export type RecentRiskAssessmentSignGateResult = {
  requiresRecentRiskAssessment: boolean;
  hasRecentRiskAssessment: boolean;
  latestRiskAssessmentAtIso: string | null;
};

export async function evaluateRecentRiskAssessmentSignGate({
  dbConn,
  auth,
  patientId,
  noteType,
  isSigning,
  currentNoteId,
  now = new Date(),
}: EvaluateRecentRiskAssessmentSignGateArgs): Promise<RecentRiskAssessmentSignGateResult> {
  if (!isSigning || !isRecentRiskAssessmentGatedNoteType(noteType)) {
    return {
      requiresRecentRiskAssessment: false,
      hasRecentRiskAssessment: true,
      latestRiskAssessmentAtIso: null,
    };
  }

  const enforceRecentRiskAssessment = await shouldEnforceRecentRiskAssessment(auth);
  if (!enforceRecentRiskAssessment) {
    return {
      requiresRecentRiskAssessment: false,
      hasRecentRiskAssessment: true,
      latestRiskAssessmentAtIso: null,
    };
  }

  const hasPriorSignedPsychNote = await dbConn('clinical_notes')
    .where({
      clinic_id: auth.clinicId,
      patient_id: patientId,
      status: 'signed',
    })
    .whereIn('note_type', RECENT_RISK_ASSESSMENT_GATED_NOTE_TYPES as readonly string[])
    .whereNull('deleted_at')
    .modify((query) => {
      if (currentNoteId) query.whereNot('id', currentNoteId);
    })
    .first('id');

  const requiresRecentRiskAssessment = !hasPriorSignedPsychNote;
  if (!requiresRecentRiskAssessment) {
    return {
      requiresRecentRiskAssessment: false,
      hasRecentRiskAssessment: true,
      latestRiskAssessmentAtIso: null,
    };
  }

  const latest = await dbConn('risk_assessments')
    .where({
      clinic_id: auth.clinicId,
      patient_id: patientId,
    })
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc')
    .orderBy('assessment_date', 'desc')
    .first<LatestRiskAssessmentRow>('assessment_date', 'created_at');

  const latestRiskAssessmentAt = coerceRiskAssessmentCompletionTime(latest);
  const hasRecentRiskAssessment = isWithinRecentWindow(latestRiskAssessmentAt, now);

  return {
    requiresRecentRiskAssessment: true,
    hasRecentRiskAssessment,
    latestRiskAssessmentAtIso: latestRiskAssessmentAt?.toISOString() ?? null,
  };
}

function coerceRiskAssessmentCompletionTime(row: LatestRiskAssessmentRow | undefined): Date | null {
  if (!row) return null;
  const fromCreatedAt = parseAnyDate(row.created_at);
  if (fromCreatedAt) return fromCreatedAt;

  const assessmentDate =
    typeof row.assessment_date === 'string' ? row.assessment_date : null;
  if (!assessmentDate) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(assessmentDate)) return null;

  // assessment_date has day precision only; choose end-of-day UTC so we
  // do not falsely reject a same-day assessment near midnight boundaries.
  return new Date(`${assessmentDate}T23:59:59.999Z`);
}

function parseAnyDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function isWithinRecentWindow(candidate: Date | null, now: Date): boolean {
  if (!candidate) return false;
  const windowMs = RECENT_RISK_ASSESSMENT_WINDOW_HOURS * 60 * 60 * 1000;
  return now.getTime() - candidate.getTime() <= windowMs;
}
