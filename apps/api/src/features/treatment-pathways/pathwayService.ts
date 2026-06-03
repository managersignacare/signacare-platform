import type {
  AssignPathwayInterventionDTO,
  AuthContext,
  CreatePathwaySleepHygieneCheckInDTO,
  CreatePathwayThoughtDiaryEntryDTO,
  PathwayDigitalInterventionBundle,
  PathwayInterventionPack,
  PathwaySleepHygieneCheckIn,
  PathwayThoughtDiaryEntry,
  RecordSessionDTO,
  UpdateTreatmentPathwayDTO,
  UpdatePathwayInterventionItemDTO,
} from '@signacare/shared';
import { randomUUID } from 'crypto';
import { AppError } from '../../shared/errors';
import { writeAuditLog } from '../../utils/audit';
import {
  pathwayRepository,
  type TreatmentPathwayRow,
} from './pathwayRepository';
import { assertPathwayStatusTransition } from './pathwayStatusStateMachine';

type CreatePathwayInput = {
  patientId: string;
  pathwayType: string;
  pathwayName: string;
  totalSessions: number;
  startDate: string;
  clinicianId: string;
  episodeId: string | null;
  notes: string | null;
  items: Array<{ id: number; name: string; completed: boolean }>;
};

function parseMilestones(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

function numberFromMilestones(obj: Record<string, unknown>, key: string, fallback: number): number {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function buildMilestonesPatch(dto: UpdateTreatmentPathwayDTO): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (dto.completed_sessions !== undefined) patch.completedSessions = dto.completed_sessions;
  if (dto.completedSessions !== undefined) patch.completedSessions = dto.completedSessions;
  if (dto.end_date !== undefined) patch.endDate = dto.end_date;
  if (dto.endDate !== undefined) patch.endDate = dto.endDate;
  if (dto.notes !== undefined) patch.notes = dto.notes;
  return patch;
}

type DigitalInterventionMilestones = {
  assignedPacks: PathwayInterventionPack[];
  thoughtDiaryEntries: PathwayThoughtDiaryEntry[];
  sleepJourneyCheckIns: PathwaySleepHygieneCheckIn[];
};

type InterventionTemplate = {
  title: string;
  items: Array<{ title: string; description: string }>;
};

const INTERVENTION_TEMPLATES: Record<string, InterventionTemplate> = {
  cbt_homework: {
    title: 'CBT Homework Pack',
    items: [
      {
        title: 'Trigger Mapping',
        description: 'List 3 triggering situations from this week and identify associated automatic thoughts.',
      },
      {
        title: 'Cognitive Reframing',
        description: 'Challenge one unhelpful thought per day using evidence for/against and a balanced alternative.',
      },
      {
        title: 'Behavioural Activation',
        description: 'Schedule and complete 3 restorative activities before next review.',
      },
    ],
  },
  dbt_skills: {
    title: 'DBT Skills Pack',
    items: [
      {
        title: 'Distress Tolerance Drill',
        description: 'Use one TIPP skill during high arousal and record outcome within 15 minutes.',
      },
      {
        title: 'Emotion Regulation Check',
        description: 'Track vulnerability factors (sleep, meals, substances, stress) once daily.',
      },
      {
        title: 'Interpersonal Effectiveness Practice',
        description: 'Apply DEAR MAN in one real conversation and note barriers/successes.',
      },
    ],
  },
  sleep_hygiene_journey: {
    title: 'Sleep Hygiene Journey',
    items: [
      {
        title: 'Consistent Wake Window',
        description: 'Maintain wake time within a 30-minute window for 7 consecutive days.',
      },
      {
        title: 'Screen Curfew',
        description: 'Avoid screens for 60 minutes before bedtime on at least 5 nights.',
      },
      {
        title: 'Evening Wind-Down',
        description: 'Complete a 20-minute relaxation routine prior to bed each night.',
      },
    ],
  },
  thought_diary_journey: {
    title: 'Thought Diary Journey',
    items: [
      {
        title: 'Daily Thought Capture',
        description: 'Capture one high-intensity thought event each day in the thought diary.',
      },
      {
        title: 'Evidence Review',
        description: 'For each event, record evidence supporting and challenging the thought.',
      },
      {
        title: 'Balanced Reframe',
        description: 'Write a balanced thought and one follow-up behaviour experiment.',
      },
    ],
  },
};

function asIsoString(input: string | undefined, fallback: Date): string {
  if (input && input.trim().length > 0) {
    return input;
  }
  return fallback.toISOString();
}

function toNullableString(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseDigitalMilestones(row: TreatmentPathwayRow): DigitalInterventionMilestones {
  const milestones = parseMilestones(row.milestones);
  const assignedPacks = Array.isArray(milestones.assignedPacks)
    ? (milestones.assignedPacks as PathwayInterventionPack[])
    : [];
  const thoughtDiaryEntries = Array.isArray(milestones.thoughtDiaryEntries)
    ? (milestones.thoughtDiaryEntries as PathwayThoughtDiaryEntry[])
    : [];
  const sleepJourneyCheckIns = Array.isArray(milestones.sleepJourneyCheckIns)
    ? (milestones.sleepJourneyCheckIns as PathwaySleepHygieneCheckIn[])
    : [];
  return { assignedPacks, thoughtDiaryEntries, sleepJourneyCheckIns };
}

export const pathwayService = {
  /**
   * R-FIX-BUG-568-CREATE-ACTOR-STAMP
   * R-FIX-BUG-568-CREATE-AUDIT
   */
  async create(auth: AuthContext, input: CreatePathwayInput): Promise<TreatmentPathwayRow> {
    const created = await pathwayRepository.create({
      clinic_id: auth.clinicId,
      patient_id: input.patientId,
      updated_by_staff_id: auth.staffId,
      name: input.pathwayName,
      status: 'active',
      milestones: {
        pathwayType: input.pathwayType,
        totalSessions: input.totalSessions,
        completedSessions: 0,
        startDate: input.startDate,
        clinicianId: input.clinicianId,
        episodeId: input.episodeId,
        notes: input.notes,
        items: input.items,
      },
    });

    await writeAuditLog({
      clinicId: auth.clinicId,
      userId: auth.staffId,
      action: 'CREATE',
      tableName: 'treatment_pathways',
      recordId: created.id,
      newData: {
        mutation: 'pathway_create',
        patientId: created.patient_id,
        status: created.status,
        lockVersion: created.lock_version,
      },
    });

    return created;
  },

  /**
   * R-FIX-BUG-568-UPDATE-ACTOR-STAMP
   * R-FIX-BUG-568-UPDATE-AUDIT
   */
  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateTreatmentPathwayDTO,
  ): Promise<TreatmentPathwayRow> {
    const existing = await pathwayRepository.findById(auth.clinicId, id);
    if (!existing) {
      throw new AppError('Treatment pathway not found', 404, 'NOT_FOUND');
    }

    if (dto.status !== undefined) {
      assertPathwayStatusTransition(existing.status, dto.status);
    }

    const milestonesPatch = buildMilestonesPatch(dto);
    const updated = await pathwayRepository.update(auth.clinicId, id, dto.expectedLockVersion, {
      updated_by_staff_id: auth.staffId,
      name: dto.name,
      status: dto.status,
      milestonesPatch: Object.keys(milestonesPatch).length > 0 ? milestonesPatch : undefined,
    });

    const oldMilestones = parseMilestones(existing.milestones);
    const newMilestones = parseMilestones(updated.milestones);
    await writeAuditLog({
      clinicId: auth.clinicId,
      userId: auth.staffId,
      action: 'UPDATE',
      tableName: 'treatment_pathways',
      recordId: id,
      oldData: {
        mutation: 'pathway_update',
        status: existing.status,
        lockVersion: existing.lock_version,
        completedSessions: numberFromMilestones(oldMilestones, 'completedSessions', 0),
        updatedByStaffId: existing.updated_by_staff_id,
      },
      newData: {
        mutation: 'pathway_update',
        status: updated.status,
        lockVersion: updated.lock_version,
        completedSessions: numberFromMilestones(newMilestones, 'completedSessions', 0),
        updatedByStaffId: updated.updated_by_staff_id,
      },
    });

    return updated;
  },

  /**
   * R-FIX-BUG-568-SESSION-ACTOR-STAMP
   * R-FIX-BUG-568-SESSION-AUDIT
   */
  async recordSession(
    auth: AuthContext,
    id: string,
    dto: RecordSessionDTO,
  ): Promise<TreatmentPathwayRow> {
    const existing = await pathwayRepository.findById(auth.clinicId, id);
    if (!existing) {
      throw new AppError('Treatment pathway not found', 404, 'NOT_FOUND');
    }

    if (existing.status !== 'active') {
      throw new AppError(
        `Cannot record a session for pathway in '${existing.status}' status`,
        422,
        'INVALID_STATE_TRANSITION',
        {
          fromStatus: existing.status,
          requiredStatus: 'active',
        },
      );
    }

    const existingMilestones = parseMilestones(existing.milestones);
    const completedSessions = numberFromMilestones(existingMilestones, 'completedSessions', 0) + 1;
    const totalSessions = numberFromMilestones(existingMilestones, 'totalSessions', 12);
    const isComplete = completedSessions >= totalSessions;

    const updated = await pathwayRepository.update(auth.clinicId, id, dto.expectedLockVersion, {
      updated_by_staff_id: auth.staffId,
      status: isComplete ? 'completed' : existing.status,
      milestonesPatch: { completedSessions },
    });

    const updatedMilestones = parseMilestones(updated.milestones);
    await writeAuditLog({
      clinicId: auth.clinicId,
      userId: auth.staffId,
      action: 'UPDATE',
      tableName: 'treatment_pathways',
      recordId: id,
      oldData: {
        mutation: 'pathway_record_session',
        status: existing.status,
        lockVersion: existing.lock_version,
        completedSessions: numberFromMilestones(existingMilestones, 'completedSessions', 0),
        updatedByStaffId: existing.updated_by_staff_id,
      },
      newData: {
        mutation: 'pathway_record_session',
        status: updated.status,
        lockVersion: updated.lock_version,
        completedSessions: numberFromMilestones(updatedMilestones, 'completedSessions', completedSessions),
        updatedByStaffId: updated.updated_by_staff_id,
      },
    });

    return updated;
  },

  async getDigitalInterventions(
    auth: AuthContext,
    id: string,
  ): Promise<PathwayDigitalInterventionBundle> {
    const pathway = await pathwayRepository.findById(auth.clinicId, id);
    if (!pathway) {
      throw new AppError('Treatment pathway not found', 404, 'NOT_FOUND');
    }
    const digital = parseDigitalMilestones(pathway);
    return {
      pathwayId: pathway.id,
      lockVersion: pathway.lock_version,
      packs: digital.assignedPacks,
      thoughtDiaryEntries: digital.thoughtDiaryEntries,
      sleepJourneyCheckIns: digital.sleepJourneyCheckIns,
    };
  },

  async assignInterventionPack(
    auth: AuthContext,
    id: string,
    dto: AssignPathwayInterventionDTO,
  ): Promise<PathwayDigitalInterventionBundle> {
    const existing = await pathwayRepository.findById(auth.clinicId, id);
    if (!existing) {
      throw new AppError('Treatment pathway not found', 404, 'NOT_FOUND');
    }
    const template = INTERVENTION_TEMPLATES[dto.templateKey];
    if (!template) {
      throw new AppError('Unsupported intervention template', 422, 'INVALID_INTERVENTION_TEMPLATE');
    }
    const now = new Date();
    const digital = parseDigitalMilestones(existing);
    const packId = randomUUID();
    const pack: PathwayInterventionPack = {
      id: packId,
      templateKey: dto.templateKey,
      title: dto.title?.trim() || template.title,
      status: 'active',
      dueDate: toNullableString(dto.dueDate),
      notes: toNullableString(dto.notes),
      assignedAt: now.toISOString(),
      assignedByStaffId: auth.staffId,
      items: template.items.map((item) => ({
        id: randomUUID(),
        title: item.title,
        description: item.description,
        completed: false,
        completedAt: null,
      })),
    };
    const nextPacks = [...digital.assignedPacks, pack];
    const updated = await pathwayRepository.update(auth.clinicId, id, dto.expectedLockVersion, {
      updated_by_staff_id: auth.staffId,
      milestonesPatch: { assignedPacks: nextPacks },
    });
    await writeAuditLog({
      clinicId: auth.clinicId,
      userId: auth.staffId,
      action: 'UPDATE',
      tableName: 'treatment_pathways',
      recordId: id,
      oldData: {
        mutation: 'pathway_assign_intervention',
        lockVersion: existing.lock_version,
        assignedPackCount: digital.assignedPacks.length,
      },
      newData: {
        mutation: 'pathway_assign_intervention',
        lockVersion: updated.lock_version,
        assignedPackCount: nextPacks.length,
        assignedPackId: pack.id,
        templateKey: dto.templateKey,
      },
    });
    const nextDigital = parseDigitalMilestones(updated);
    return {
      pathwayId: updated.id,
      lockVersion: updated.lock_version,
      packs: nextDigital.assignedPacks,
      thoughtDiaryEntries: nextDigital.thoughtDiaryEntries,
      sleepJourneyCheckIns: nextDigital.sleepJourneyCheckIns,
    };
  },

  async setInterventionItemCompletion(
    auth: AuthContext,
    id: string,
    packId: string,
    itemId: string,
    dto: UpdatePathwayInterventionItemDTO,
  ): Promise<PathwayDigitalInterventionBundle> {
    const existing = await pathwayRepository.findById(auth.clinicId, id);
    if (!existing) {
      throw new AppError('Treatment pathway not found', 404, 'NOT_FOUND');
    }
    const digital = parseDigitalMilestones(existing);
    let packFound = false;
    const nextPacks = digital.assignedPacks.map((pack) => {
      if (pack.id !== packId) return pack;
      packFound = true;
      const nextItems = pack.items.map((item) => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          completed: dto.completed,
          completedAt: dto.completed ? new Date().toISOString() : null,
        };
      });
      const foundItem = nextItems.some((item) => item.id === itemId);
      if (!foundItem) {
        throw new AppError('Intervention item not found', 404, 'INTERVENTION_ITEM_NOT_FOUND');
      }
      const completedCount = nextItems.filter((item) => item.completed).length;
      return {
        ...pack,
        items: nextItems,
        status: completedCount === nextItems.length ? 'completed' : 'active',
      };
    });
    if (!packFound) {
      throw new AppError('Intervention pack not found', 404, 'INTERVENTION_PACK_NOT_FOUND');
    }
    const updated = await pathwayRepository.update(auth.clinicId, id, dto.expectedLockVersion, {
      updated_by_staff_id: auth.staffId,
      milestonesPatch: { assignedPacks: nextPacks },
    });
    await writeAuditLog({
      clinicId: auth.clinicId,
      userId: auth.staffId,
      action: 'UPDATE',
      tableName: 'treatment_pathways',
      recordId: id,
      oldData: {
        mutation: 'pathway_update_intervention_item',
        lockVersion: existing.lock_version,
      },
      newData: {
        mutation: 'pathway_update_intervention_item',
        lockVersion: updated.lock_version,
        packId,
        itemId,
        completed: dto.completed,
      },
    });
    const nextDigital = parseDigitalMilestones(updated);
    return {
      pathwayId: updated.id,
      lockVersion: updated.lock_version,
      packs: nextDigital.assignedPacks,
      thoughtDiaryEntries: nextDigital.thoughtDiaryEntries,
      sleepJourneyCheckIns: nextDigital.sleepJourneyCheckIns,
    };
  },

  async addThoughtDiaryEntry(
    auth: AuthContext,
    id: string,
    dto: CreatePathwayThoughtDiaryEntryDTO,
  ): Promise<PathwayDigitalInterventionBundle> {
    const existing = await pathwayRepository.findById(auth.clinicId, id);
    if (!existing) {
      throw new AppError('Treatment pathway not found', 404, 'NOT_FOUND');
    }
    const now = new Date();
    const digital = parseDigitalMilestones(existing);
    const entry: PathwayThoughtDiaryEntry = {
      id: randomUUID(),
      occurredAt: asIsoString(dto.occurredAt, now),
      situation: dto.situation,
      automaticThought: dto.automaticThought,
      emotion: dto.emotion,
      emotionIntensity: dto.emotionIntensity,
      evidenceFor: toNullableString(dto.evidenceFor),
      evidenceAgainst: toNullableString(dto.evidenceAgainst),
      balancedThought: toNullableString(dto.balancedThought),
      behaviourPlan: toNullableString(dto.behaviourPlan),
      createdAt: now.toISOString(),
      createdByStaffId: auth.staffId,
    };
    const nextEntries = [entry, ...digital.thoughtDiaryEntries];
    const updated = await pathwayRepository.update(auth.clinicId, id, dto.expectedLockVersion, {
      updated_by_staff_id: auth.staffId,
      milestonesPatch: { thoughtDiaryEntries: nextEntries },
    });
    await writeAuditLog({
      clinicId: auth.clinicId,
      userId: auth.staffId,
      action: 'UPDATE',
      tableName: 'treatment_pathways',
      recordId: id,
      oldData: {
        mutation: 'pathway_add_thought_diary_entry',
        lockVersion: existing.lock_version,
        thoughtDiaryCount: digital.thoughtDiaryEntries.length,
      },
      newData: {
        mutation: 'pathway_add_thought_diary_entry',
        lockVersion: updated.lock_version,
        thoughtDiaryCount: nextEntries.length,
        entryId: entry.id,
      },
    });
    const nextDigital = parseDigitalMilestones(updated);
    return {
      pathwayId: updated.id,
      lockVersion: updated.lock_version,
      packs: nextDigital.assignedPacks,
      thoughtDiaryEntries: nextDigital.thoughtDiaryEntries,
      sleepJourneyCheckIns: nextDigital.sleepJourneyCheckIns,
    };
  },

  async addSleepHygieneCheckIn(
    auth: AuthContext,
    id: string,
    dto: CreatePathwaySleepHygieneCheckInDTO,
  ): Promise<PathwayDigitalInterventionBundle> {
    const existing = await pathwayRepository.findById(auth.clinicId, id);
    if (!existing) {
      throw new AppError('Treatment pathway not found', 404, 'NOT_FOUND');
    }
    const now = new Date();
    const digital = parseDigitalMilestones(existing);
    const checkIn: PathwaySleepHygieneCheckIn = {
      id: randomUUID(),
      date: dto.date ?? now.toISOString().split('T')[0],
      bedtime: toNullableString(dto.bedtime),
      wakeTime: toNullableString(dto.wakeTime),
      sleepHours: dto.sleepHours ?? null,
      sleepQuality: dto.sleepQuality,
      caffeineAfterNoon: dto.caffeineAfterNoon,
      screenAfterBed: dto.screenAfterBed,
      exerciseDone: dto.exerciseDone,
      notes: toNullableString(dto.notes),
      createdAt: now.toISOString(),
      createdByStaffId: auth.staffId,
    };
    const nextCheckIns = [checkIn, ...digital.sleepJourneyCheckIns];
    const updated = await pathwayRepository.update(auth.clinicId, id, dto.expectedLockVersion, {
      updated_by_staff_id: auth.staffId,
      milestonesPatch: { sleepJourneyCheckIns: nextCheckIns },
    });
    await writeAuditLog({
      clinicId: auth.clinicId,
      userId: auth.staffId,
      action: 'UPDATE',
      tableName: 'treatment_pathways',
      recordId: id,
      oldData: {
        mutation: 'pathway_add_sleep_hygiene_checkin',
        lockVersion: existing.lock_version,
        sleepCheckInCount: digital.sleepJourneyCheckIns.length,
      },
      newData: {
        mutation: 'pathway_add_sleep_hygiene_checkin',
        lockVersion: updated.lock_version,
        sleepCheckInCount: nextCheckIns.length,
        checkInId: checkIn.id,
      },
    });
    const nextDigital = parseDigitalMilestones(updated);
    return {
      pathwayId: updated.id,
      lockVersion: updated.lock_version,
      packs: nextDigital.assignedPacks,
      thoughtDiaryEntries: nextDigital.thoughtDiaryEntries,
      sleepJourneyCheckIns: nextDigital.sleepJourneyCheckIns,
    };
  },
};
