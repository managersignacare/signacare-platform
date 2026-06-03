// apps/api/src/features/surgery/surgeryServices.ts
//
// Multi-specialty Phase 7 — Surgery: services.
//
// Row→DTO mappers, audit-log entries on every mutation, and the
// "all three WHO checklist phases must exist before an op note
// can be written" repository-level safeguard the Phase 7 plan
// explicitly called out.
import { AppError } from '../../shared/errors';
import {
  CreateSurgicalCaseDTO,
  SurgicalCaseResponse,
  CreateSafetyChecklistDTO,
  SafetyChecklistResponse,
  ChecklistItem,
  CreateOpNoteDTO,
  OpNoteResponse,
  OpNoteSpecimen,
  CreatePacuRecordDTO,
  PacuRecordResponse,
  PacuVitals,
} from '@signacare/shared';
import {
  surgicalCaseRepository,
  safetyChecklistRepository,
  opNoteRepository,
  pacuRecordRepository,
  type SurgicalCaseRowWithSurgeon,
  type SafetyChecklistRowWithActor,
  type OpNoteRowWithActor,
  type PacuRecordRowWithActor,
} from './surgeryRepositories';
import auditLogService from '../../utils/audit';

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function toDateOnly(d: Date | string | null | undefined): string {
  if (!d) return '';
  const s = d instanceof Date ? d.toISOString() : String(d);
  return s.slice(0, 10);
}

function staffName(given?: string | null, family?: string | null): string | null {
  return given && family ? `${given} ${family}` : null;
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

// ── Surgical cases ─────────────────────────────────────────────────────────

function mapCase(row: SurgicalCaseRowWithSurgeon): SurgicalCaseResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    procedureCode: row.procedure_code,
    procedureDisplay: row.procedure_display,
    primarySurgeonId: row.primary_surgeon_id,
    primarySurgeonName: staffName(row.primary_surgeon_given_name, row.primary_surgeon_family_name),
    plannedDate: toDateOnly(row.planned_date),
    urgency: row.urgency as SurgicalCaseResponse['urgency'],
    asaClass: row.asa_class,
    consentStatus: row.consent_status as SurgicalCaseResponse['consentStatus'],
    status: row.status as SurgicalCaseResponse['status'],
    note: row.note,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

export class SurgicalCaseService {
  async listForPatient(clinicId: string, patientId: string): Promise<SurgicalCaseResponse[]> {
    const rows = await surgicalCaseRepository.listForPatient(clinicId, patientId);
    return rows.map(mapCase);
  }

  async create(
    clinicId: string,
    actorId: string,
    dto: CreateSurgicalCaseDTO,
  ): Promise<SurgicalCaseResponse> {
    const created = await surgicalCaseRepository.create({
      clinic_id: clinicId,
      patient_id: dto.patientId,
      episode_id: dto.episodeId ?? null,
      procedure_code: dto.procedureCode,
      procedure_display: dto.procedureDisplay,
      primary_surgeon_id: dto.primarySurgeonId ?? null,
      planned_date: dto.plannedDate,
      urgency: dto.urgency,
      asa_class: dto.asaClass,
      consent_status: dto.consentStatus ?? 'pending',
      status: 'scheduled',
      note: dto.note ?? null,
    });
    await auditLogService.logCreate({
      clinicId,
      userId: actorId,
      tableName: 'surgical_cases',
      recordId: created.id,
      newData: { procedure: created.procedure_display, urgency: created.urgency },
    });
    return mapCase(created as SurgicalCaseRowWithSurgeon);
  }
}

// ── Safety checklists ──────────────────────────────────────────────────────

function mapChecklist(row: SafetyChecklistRowWithActor): SafetyChecklistResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    caseId: row.case_id,
    phase: row.phase as SafetyChecklistResponse['phase'],
    items: parseJson<ChecklistItem[]>(row.items, []),
    completedBy: row.completed_by,
    completedByName: staffName(row.completed_by_given_name, row.completed_by_family_name),
    completedAt: toIso(row.completed_at)!,
    createdAt: toIso(row.created_at)!,
  };
}

export class SafetyChecklistService {
  async listForCase(clinicId: string, caseId: string): Promise<SafetyChecklistResponse[]> {
    const rows = await safetyChecklistRepository.listForCase(clinicId, caseId);
    return rows.map(mapChecklist);
  }

  async create(
    clinicId: string,
    actorId: string,
    dto: CreateSafetyChecklistDTO,
  ): Promise<SafetyChecklistResponse> {
    // Guard: the case must exist in this clinic so we can't write a
    // checklist against a foreign-tenant case id (defence in depth
    // on top of RLS + the FK on case_id).
    const parent = await surgicalCaseRepository.findById(clinicId, dto.caseId);
    if (!parent) {
      throw new AppError('Surgical case not found', 404, 'NOT_FOUND');
    }
    const created = await safetyChecklistRepository.create({
      clinic_id: clinicId,
      case_id: dto.caseId,
      phase: dto.phase,
      items: dto.items,
      completed_by: actorId,
    });
    await auditLogService.logCreate({
      clinicId,
      userId: actorId,
      tableName: 'safety_checklists',
      recordId: created.id,
      newData: { case_id: dto.caseId, phase: dto.phase, items: dto.items.length },
    });
    return mapChecklist(created as SafetyChecklistRowWithActor);
  }
}

// ── Op notes ───────────────────────────────────────────────────────────────

function mapOpNote(row: OpNoteRowWithActor): OpNoteResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    caseId: row.case_id,
    indication: row.indication,
    findings: row.findings,
    procedureText: row.procedure_text,
    complications: row.complications,
    estimatedBloodLossMl: row.estimated_blood_loss_ml,
    specimens: parseJson<OpNoteSpecimen[]>(row.specimens, []),
    closedBy: row.closed_by,
    closedByName: staffName(row.closed_by_given_name, row.closed_by_family_name),
    closedAt: toIso(row.closed_at)!,
  };
}

export class OpNoteService {
  async findForCase(clinicId: string, caseId: string): Promise<OpNoteResponse | null> {
    const row = await opNoteRepository.findForCase(clinicId, caseId);
    return row ? mapOpNote(row) : null;
  }

  async create(
    clinicId: string,
    actorId: string,
    dto: CreateOpNoteDTO,
  ): Promise<OpNoteResponse> {
    const parent = await surgicalCaseRepository.findById(clinicId, dto.caseId);
    if (!parent) {
      throw new AppError('Surgical case not found', 404, 'NOT_FOUND');
    }
    // Enforce "WHO three-phase checklist complete before sign-off"
    // at the repository layer, not just the UI. Phase 7 plan
    // explicitly calls this out as a business-correctness guard.
    const phaseCount = await safetyChecklistRepository.countPhasesForCase(clinicId, dto.caseId);
    if (phaseCount < 3) {
      throw Object.assign(
        new Error('All three WHO checklist phases (sign_in, time_out, sign_out) must be completed before an op note can be written'),
        { status: 409, code: 'CHECKLIST_INCOMPLETE' },
      );
    }
    const created = await opNoteRepository.create({
      clinic_id: clinicId,
      case_id: dto.caseId,
      indication: dto.indication,
      findings: dto.findings,
      procedure_text: dto.procedureText,
      complications: dto.complications ?? null,
      estimated_blood_loss_ml: dto.estimatedBloodLossMl ?? null,
      specimens: dto.specimens ?? [],
      closed_by: actorId,
    });
    await auditLogService.logCreate({
      clinicId,
      userId: actorId,
      tableName: 'op_notes',
      recordId: created.id,
      newData: { case_id: dto.caseId, ebl: dto.estimatedBloodLossMl ?? null },
    });
    return mapOpNote(created as OpNoteRowWithActor);
  }
}

// ── PACU records ───────────────────────────────────────────────────────────

function mapPacu(row: PacuRecordRowWithActor): PacuRecordResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    caseId: row.case_id,
    vitals: parseJson<PacuVitals>(row.vitals, {}),
    aldreteScore: row.aldrete_score,
    dischargeCriteriaMet: row.discharge_criteria_met,
    recoveryEndAt: toIso(row.recovery_end_at),
    note: row.note,
    recordedBy: row.recorded_by,
    recordedByName: staffName(row.recorded_by_given_name, row.recorded_by_family_name),
    createdAt: toIso(row.created_at)!,
  };
}

export class PacuRecordService {
  async listForCase(clinicId: string, caseId: string): Promise<PacuRecordResponse[]> {
    const rows = await pacuRecordRepository.listForCase(clinicId, caseId);
    return rows.map(mapPacu);
  }

  async create(
    clinicId: string,
    actorId: string,
    dto: CreatePacuRecordDTO,
  ): Promise<PacuRecordResponse> {
    const parent = await surgicalCaseRepository.findById(clinicId, dto.caseId);
    if (!parent) {
      throw new AppError('Surgical case not found', 404, 'NOT_FOUND');
    }
    const created = await pacuRecordRepository.create({
      clinic_id: clinicId,
      case_id: dto.caseId,
      vitals: dto.vitals,
      aldrete_score: dto.aldreteScore,
      discharge_criteria_met: dto.dischargeCriteriaMet,
      recovery_end_at: dto.recoveryEndAt ? new Date(dto.recoveryEndAt) : null,
      note: dto.note ?? null,
      recorded_by: actorId,
    });
    await auditLogService.logCreate({
      clinicId,
      userId: actorId,
      tableName: 'pacu_records',
      recordId: created.id,
      newData: { case_id: dto.caseId, aldrete: created.aldrete_score },
    });
    return mapPacu(created as PacuRecordRowWithActor);
  }
}

export const surgicalCaseService = new SurgicalCaseService();
export const safetyChecklistService = new SafetyChecklistService();
export const opNoteService = new OpNoteService();
export const pacuRecordService = new PacuRecordService();
