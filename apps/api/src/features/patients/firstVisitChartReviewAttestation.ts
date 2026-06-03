import type { Knex } from 'knex';
import type { AuthContext, FirstVisitChartReviewAttestationDTO } from '@signacare/shared';
import {
  FIRST_VISIT_CHART_REVIEW_GATED_NOTE_TYPES,
  FirstVisitChartReviewAttestationSchema,
  isFirstVisitChartReviewGatedNoteType,
} from '@signacare/shared';
import { AppError } from '../../shared/errors';
import { shouldEnforceFirstVisitChartReview } from '../../shared/firstVisitChartReviewPolicy';

type EnforceFirstVisitChartReviewArgs = {
  dbConn: Knex;
  auth: AuthContext;
  patientId: string;
  noteType: string | null | undefined;
  isSigning: boolean;
  attestation: unknown;
  currentNoteId?: string;
};

type EnforceFirstVisitChartReviewResult = {
  blocked: boolean;
  requiresAttestation: boolean;
  attestation: FirstVisitChartReviewAttestationDTO | null;
};

type ResolveFirstVisitCreateContactMetaArgs = {
  dbConn: Knex;
  auth: AuthContext;
  patientId: string;
  noteType: string | null | undefined;
  isSigning: boolean;
  attestation: unknown;
  contactMeta: unknown;
  staffId: string | null;
};

type ResolveFirstVisitSignPatchArgs = {
  dbConn: Knex;
  auth: AuthContext;
  patientId: string;
  noteType: string | null | undefined;
  attestation: unknown;
  currentNoteId: string;
  sourceContactMeta: unknown;
  staffId: string | null;
};

export async function enforceFirstVisitChartReviewOrRespond({
  dbConn,
  auth,
  patientId,
  noteType,
  isSigning,
  attestation,
  currentNoteId,
}: EnforceFirstVisitChartReviewArgs): Promise<EnforceFirstVisitChartReviewResult> {
  if (!isSigning || !isFirstVisitChartReviewGatedNoteType(noteType)) {
    return { blocked: false, requiresAttestation: false, attestation: null };
  }

  const enforceChartReview = await shouldEnforceFirstVisitChartReview(auth);
  if (!enforceChartReview) {
    return { blocked: false, requiresAttestation: false, attestation: null };
  }

  const hasPriorSignedGatedNote = await dbConn('clinical_notes')
    .where({
      clinic_id: auth.clinicId,
      patient_id: patientId,
      status: 'signed',
    })
    .whereIn('note_type', FIRST_VISIT_CHART_REVIEW_GATED_NOTE_TYPES as readonly string[])
    .whereNull('deleted_at')
    .modify((query) => {
      if (currentNoteId) query.whereNot('id', currentNoteId);
    })
    .first('id');

  const requiresAttestation = !hasPriorSignedGatedNote;
  if (!requiresAttestation) {
    return { blocked: false, requiresAttestation: false, attestation: null };
  }

  const parsed = FirstVisitChartReviewAttestationSchema.safeParse(attestation);
  if (!parsed.success) {
    throw new AppError(
      'First-visit chart review is required before signing. Review recent labs, imaging, and medications and re-sign.',
      409,
      'FIRST_VISIT_CHART_REVIEW_REQUIRED',
    );
  }

  return { blocked: false, requiresAttestation: true, attestation: parsed.data };
}

export function buildFirstVisitChartReviewContactMetaPatch(
  contactMeta: unknown,
  attestation: FirstVisitChartReviewAttestationDTO,
  staffId: string | null,
): Record<string, unknown> {
  const baseMeta = parseContactMetaRecord(contactMeta);
  return {
    ...baseMeta,
    firstVisitChartReview: {
      recentLabsReviewed: true,
      recentImagingReviewed: true,
      recentMedicationsReviewed: true,
      reviewedAt: attestation.reviewedAt ?? new Date().toISOString(),
      reviewedByStaffId: staffId,
    },
  };
}

export async function resolveFirstVisitCreateContactMeta({
  dbConn,
  auth,
  patientId,
  noteType,
  isSigning,
  attestation,
  contactMeta,
  staffId,
}: ResolveFirstVisitCreateContactMetaArgs): Promise<{
  blocked: boolean;
  contactMeta: unknown;
}> {
  const gate = await enforceFirstVisitChartReviewOrRespond({
    dbConn,
    auth,
    patientId,
    noteType,
    isSigning,
    attestation,
  });
  if (gate.blocked) return { blocked: true, contactMeta };
  if (!gate.attestation) return { blocked: false, contactMeta };
  return {
    blocked: false,
    contactMeta: buildFirstVisitChartReviewContactMetaPatch(contactMeta, gate.attestation, staffId),
  };
}

export async function resolveFirstVisitSignPatch({
  dbConn,
  auth,
  patientId,
  noteType,
  attestation,
  currentNoteId,
  sourceContactMeta,
  staffId,
}: ResolveFirstVisitSignPatchArgs): Promise<{
  blocked: boolean;
  contactMetaPatch: Record<string, unknown> | null;
}> {
  const gate = await enforceFirstVisitChartReviewOrRespond({
    dbConn,
    auth,
    patientId,
    noteType,
    isSigning: true,
    attestation,
    currentNoteId,
  });
  if (gate.blocked) return { blocked: true, contactMetaPatch: null };
  if (!gate.attestation) return { blocked: false, contactMetaPatch: null };
  return {
    blocked: false,
    contactMetaPatch: buildFirstVisitChartReviewContactMetaPatch(
      sourceContactMeta,
      gate.attestation,
      staffId,
    ),
  };
}

function parseContactMetaRecord(input: unknown): Record<string, unknown> {
  if (!input) return {};
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      return {};
    }
    return {};
  }
  if (typeof input === 'object' && !Array.isArray(input)) {
    return { ...(input as Record<string, unknown>) };
  }
  return {};
}
