// @jsonb-extraction-exempt: internal clinical-context reader builds derived prompt facts and does not expose raw table rows as API responses.

import { db } from '../../../db/db';
import type { AssessmentResponsesRow } from '../../../db/types/assessment_responses';
import type { ClinicalReviewsRow } from '../../../db/types/clinical_reviews';
import type { CorrespondenceLettersRow } from '../../../db/types/correspondence_letters';
import type { EpisodesRow } from '../../../db/types/episodes';
import type { PathologyResultsRow } from '../../../db/types/pathology_results';
import type { AppointmentDb } from '../../appointments/appointmentRepository';
import type { TreatmentPathwayRow } from '../../treatment-pathways/pathwayRepository';
import {
  buildLookbackStart,
  createFact,
  noData,
  parseJsonRecord,
  toIsoString,
  type SourceReaderContext,
  type SourceReaderResult,
} from './contextReaderSupport';

export async function readRecentNotes(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  const lookbackStart = buildLookbackStart(ctx.builtAt, ctx.lookbackDays);
  const rows = await db('clinical_notes as n')
    .join('staff as s', 's.id', 'n.author_id')
    .where('n.clinic_id', ctx.clinicId)
    .andWhere('n.patient_id', ctx.patientId)
    .whereIn('n.status', ['signed', 'completed'])
    .whereNull('n.deleted_at')
    .modify((query) => {
      if (ctx.episodeId) query.andWhere('n.episode_id', ctx.episodeId);
      if (lookbackStart) query.andWhere('n.note_date_time', '>=', lookbackStart.toISOString());
    })
    .orderBy('n.note_date_time', 'desc')
    .limit(3)
    .select(
      'n.id',
      'n.note_type',
      'n.title',
      'n.note_date_time',
      'n.content',
      db.raw("COALESCE(s.given_name || ' ' || s.family_name, '') as author_name"),
    );

  if (rows.length === 0) {
    return { facts: [], excluded: [noData('recent_notes')] };
  }

  return {
    facts: rows.map((row: {
      id: string;
      note_type: string | null;
      title: string | null;
      note_date_time: string | Date | null;
      content: unknown;
      author_name: string | null;
    }) =>
      createFact({
        domain: 'recent_notes',
        tier: 'B',
        trustLevel: 'retrieved_unverified',
        sourceTable: 'clinical_notes',
        sourceId: row.id,
        sourceDate: toIsoString(row.note_date_time, ctx.builtAt),
        builtAt: ctx.builtAt,
        payload: {
          title: row.title ?? null,
          noteType: row.note_type ?? null,
          noteDateTime: row.note_date_time ?? null,
          authorName: row.author_name ?? null,
          text: String(row.content ?? '').slice(0, 1500),
        },
        citationRequired: true,
      }),
    ),
    excluded: [],
  };
}

export async function readRecentAssessments(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  const lookbackStart = buildLookbackStart(ctx.builtAt, ctx.lookbackDays);
  const rows = await db<AssessmentResponsesRow>('assessment_responses')
    .where({ clinic_id: ctx.clinicId, patient_id: ctx.patientId })
    .modify((query) => {
      if (ctx.episodeId) query.andWhere('episode_id', ctx.episodeId);
      if (lookbackStart) query.andWhere('created_at', '>=', lookbackStart.toISOString());
    })
    .orderBy('created_at', 'desc')
    .limit(5);

  if (rows.length === 0) {
    return { facts: [], excluded: [noData('recent_assessments')] };
  }

  return {
    facts: rows.map((row: AssessmentResponsesRow) =>
      createFact({
        domain: 'recent_assessments',
        tier: 'B',
        trustLevel: 'authoritative',
        sourceTable: 'assessment_responses',
        sourceId: row.id,
        sourceDate: toIsoString(row.updated_at ?? row.created_at, ctx.builtAt),
        builtAt: ctx.builtAt,
        payload: {
          assessmentType: row.assessment_type ?? null,
          totalScore: row.total_score ?? null,
          severity: row.severity ?? null,
          collectionOccasion: row.collection_occasion ?? null,
          createdAt: row.created_at,
        },
      }),
    ),
    excluded: [],
  };
}

export async function readRecentReview(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  const lookbackStart = buildLookbackStart(ctx.builtAt, ctx.lookbackDays);
  const rows = await db<ClinicalReviewsRow>('clinical_reviews')
    .where({ clinic_id: ctx.clinicId, patient_id: ctx.patientId })
    .modify((query) => {
      if (ctx.episodeId) query.andWhere('episode_id', ctx.episodeId);
      if (lookbackStart) query.andWhere('review_date', '>=', lookbackStart.toISOString().slice(0, 10));
    })
    .orderBy('review_date', 'desc')
    .orderBy('updated_at', 'desc')
    .limit(2);

  if (rows.length === 0) {
    return { facts: [], excluded: [noData('recent_review')] };
  }

  return {
    facts: rows.map((row: ClinicalReviewsRow) =>
      createFact({
        domain: 'recent_review',
        tier: 'B',
        trustLevel: 'authoritative',
        sourceTable: 'clinical_reviews',
        sourceId: row.id,
        sourceDate: toIsoString(row.updated_at, ctx.builtAt),
        builtAt: ctx.builtAt,
        payload: {
          reviewType: row.review_type ?? null,
          reviewDate: row.review_date ?? null,
          summary: row.summary ?? null,
          recommendations: row.recommendations ?? null,
          status: row.status ?? null,
        },
        citationRequired: true,
      }),
    ),
    excluded: [],
  };
}

export async function readRecentPathology(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  const lookbackStart = buildLookbackStart(ctx.builtAt, ctx.lookbackDays);
  const rows = await db<PathologyResultsRow>('pathology_results')
    .where({ clinic_id: ctx.clinicId, patient_id: ctx.patientId })
    .modify((query) => {
      if (lookbackStart) query.andWhere('result_date', '>=', lookbackStart.toISOString().slice(0, 10));
    })
    .orderBy('result_date', 'desc')
    .orderBy('updated_at', 'desc')
    .limit(5);

  if (rows.length === 0) {
    return { facts: [], excluded: [noData('recent_pathology')] };
  }

  return {
    facts: rows.map((row: PathologyResultsRow) =>
      createFact({
        domain: 'recent_pathology',
        tier: 'B',
        trustLevel: 'authoritative',
        sourceTable: 'pathology_results',
        sourceId: row.id,
        sourceDate: toIsoString(row.updated_at, ctx.builtAt),
        builtAt: ctx.builtAt,
        payload: {
          testCode: row.test_code,
          testName: row.test_name,
          resultValue: row.result_value,
          resultUnit: row.result_unit ?? null,
          referenceRange: row.reference_range ?? null,
          abnormalFlag: row.abnormal_flag,
          resultStatus: row.result_status,
          resultDate: row.result_date,
          collectionDate: row.collection_date,
          performingLab: row.performing_lab ?? null,
          isCritical: row.is_critical ?? false,
        },
      }),
    ),
    excluded: [],
  };
}

export async function readRecentAppointments(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  const nowIso = new Date(ctx.builtAt).toISOString();
  const recentRows = await db<AppointmentDb>('appointments')
    .where({ clinic_id: ctx.clinicId, patient_id: ctx.patientId })
    .whereNull('deleted_at')
    .andWhere('appointment_start', '<=', nowIso)
    .orderBy('appointment_start', 'desc')
    .limit(5);
  const upcomingRows = await db<AppointmentDb>('appointments')
    .where({ clinic_id: ctx.clinicId, patient_id: ctx.patientId })
    .whereNull('deleted_at')
    .andWhere('appointment_start', '>', nowIso)
    .orderBy('appointment_start', 'asc')
    .limit(3);

  const rows = [...upcomingRows, ...recentRows];
  if (rows.length === 0) {
    return { facts: [], excluded: [noData('recent_appointments')] };
  }

  return {
    facts: rows.map((row: AppointmentDb) =>
      createFact({
        domain: 'recent_appointments',
        tier: 'B',
        trustLevel: 'authoritative',
        sourceTable: 'appointments',
        sourceId: row.id,
        sourceDate: toIsoString(row.updated_at, ctx.builtAt),
        builtAt: ctx.builtAt,
        payload: {
          appointmentType: row.appointment_type ?? row.type,
          status: row.status,
          startTime: row.appointment_start
            ? toIsoString(row.appointment_start as string | Date | null | undefined, ctx.builtAt)
            : null,
          endTime: row.appointment_end
            ? toIsoString(row.appointment_end as string | Date | null | undefined, ctx.builtAt)
            : null,
          telehealth: row.telehealth,
          notes: row.notes,
          temporalRelation:
            row.appointment_start && row.appointment_start.toISOString() > nowIso ? 'upcoming' : 'recent',
        },
      }),
    ),
    excluded: [],
  };
}

export async function readTreatmentPathway(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  const row = await db<TreatmentPathwayRow>('treatment_pathways')
    .where({ clinic_id: ctx.clinicId, patient_id: ctx.patientId })
    .orderBy('updated_at', 'desc')
    .first();

  if (!row) {
    return { facts: [], excluded: [noData('treatment_pathway')] };
  }

  return {
    facts: [
      createFact({
        domain: 'treatment_pathway',
        tier: 'B',
        trustLevel: 'authoritative',
        sourceTable: 'treatment_pathways',
        sourceId: row.id,
        sourceDate: toIsoString(row.updated_at, ctx.builtAt),
        builtAt: ctx.builtAt,
        payload: {
          name: row.name,
          status: row.status,
          milestones: parseJsonRecord(row.milestones) ?? row.milestones,
        },
      }),
    ],
    excluded: [],
  };
}

export async function readFullEpisodeArc(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  const rows = await db<EpisodesRow>('episodes')
    .where({ clinic_id: ctx.clinicId, patient_id: ctx.patientId })
    .whereNull('deleted_at')
    .orderBy('start_date', 'asc');

  if (rows.length === 0) {
    return { facts: [], excluded: [noData('full_episode_arc')] };
  }

  return {
    facts: rows.map((row: EpisodesRow) =>
      createFact({
        domain: 'full_episode_arc',
        tier: 'C',
        trustLevel: 'authoritative',
        sourceTable: 'episodes',
        sourceId: row.id,
        sourceDate: toIsoString(row.updated_at, ctx.builtAt),
        builtAt: ctx.builtAt,
        payload: {
          title: row.title,
          episodeNumber: row.episode_number,
          episodeType: row.episode_type,
          status: row.status,
          primaryDiagnosis: row.primary_diagnosis,
          presentingProblem: row.presenting_problem,
          specialtyCode: row.specialty_code,
          startDate: row.start_date,
          endDate: row.end_date ?? null,
          closureReason: row.closure_reason ?? null,
          closureSummary: row.closure_summary ?? null,
        },
      }),
    ),
    excluded: [],
  };
}

export async function readRecentCorrespondence(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  const lookbackStart = buildLookbackStart(ctx.builtAt, ctx.lookbackDays);
  const rows = await db<CorrespondenceLettersRow>('correspondence_letters')
    .where({ clinic_id: ctx.clinicId, patient_id: ctx.patientId })
    .whereNull('deleted_at')
    .modify((query) => {
      if (lookbackStart) query.andWhere('created_at', '>=', lookbackStart.toISOString());
    })
    .orderBy('created_at', 'desc')
    .limit(2);

  if (rows.length === 0) {
    return { facts: [], excluded: [noData('recent_correspondence')] };
  }

  return {
    facts: rows.map((row: CorrespondenceLettersRow) =>
      createFact({
        domain: 'recent_correspondence',
        tier: 'B',
        trustLevel: 'retrieved_unverified',
        sourceTable: 'correspondence_letters',
        sourceId: row.id,
        sourceDate: toIsoString(row.created_at, ctx.builtAt),
        builtAt: ctx.builtAt,
        payload: {
          letterType: row.letter_type,
          subject: row.subject ?? null,
          recipientName: row.recipient_name ?? null,
          body: String(row.body ?? row.content ?? '').slice(0, 1500),
          status: row.status,
          createdAt: row.created_at,
        },
      }),
    ),
    excluded: [],
  };
}

export async function readUnavailableOverlay(
  domain: 'preferred_language' | 'reading_level',
): Promise<SourceReaderResult> {
  return {
    facts: [],
    excluded: [noData(domain, 'schema-backed overlay not yet available in the canonical patient projection')],
  };
}
