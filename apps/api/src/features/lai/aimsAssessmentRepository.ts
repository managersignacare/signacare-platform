import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/db';
import type { AimsAssessmentCreateDTO } from '@signacare/shared';

export interface AimsAssessmentRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  lai_schedule_id: string | null;
  assessed_by_staff_id: string;
  assessment_date: string;
  item_scores: Record<string, number>;
  total_score: number | null;
  interpretation: string | null;
  global_severity: number | null;
  incapacitation: number | null;
  patient_awareness: number | null;
  current_dental_problems: boolean;
  dentures: boolean;
  clinical_notes: string | null;
  is_baseline: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// Phase 0.7.5 c24 D12 — explicit .returning() matching AimsAssessmentRow
// + DB (19 cols verified via schema-snapshot.json).
const AIMS_ASSESSMENT_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'lai_schedule_id',
  'assessed_by_staff_id', 'assessment_date', 'item_scores', 'total_score',
  'interpretation', 'global_severity', 'incapacitation',
  'patient_awareness', 'current_dental_problems', 'dentures',
  'clinical_notes', 'is_baseline', 'created_at', 'updated_at', 'deleted_at',
] as const;

export class AimsAssessmentRepository {
  async create(
    clinicId: string,
    staffId: string,
    dto: AimsAssessmentCreateDTO,
  ): Promise<AimsAssessmentRow> {
    const totalScore =
      dto.totalScore ??
      Object.values(dto.itemScores).reduce((s, v) => s + v, 0);
    const [row] = await db('aims_assessments')
      .insert({
        id: uuidv4(),
        clinic_id: clinicId,
        patient_id: dto.patientId,
        lai_schedule_id: dto.laiScheduleId ?? null,
        assessed_by_staff_id: staffId,
        assessment_date: dto.assessmentDate,
        item_scores: JSON.stringify(dto.itemScores),
        total_score: totalScore,
        interpretation: dto.interpretation ?? null,
        global_severity: dto.globalSeverity ?? null,
        incapacitation: dto.incapacitation ?? null,
        patient_awareness: dto.patientAwareness ?? null,
        current_dental_problems: dto.currentDentalProblems ?? false,
        dentures: dto.dentures ?? false,
        clinical_notes: dto.clinicalNotes ?? null,
        is_baseline: dto.isBaseline ?? false,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(AIMS_ASSESSMENT_COLUMNS) as AimsAssessmentRow[];
    return row;
  }

  async findByPatient(
    clinicId: string,
    patientId: string,
    scheduleId?: string,
  ): Promise<AimsAssessmentRow[]> {
    const q = db('aims_assessments')
      .where({ clinic_id: clinicId, patient_id: patientId })
      .whereNull('deleted_at')
      .orderBy('assessment_date', 'desc');
    if (scheduleId) q.where('lai_schedule_id', scheduleId);
    return q as Promise<AimsAssessmentRow[]>;
  }
}

export const aimsAssessmentRepository = new AimsAssessmentRepository();