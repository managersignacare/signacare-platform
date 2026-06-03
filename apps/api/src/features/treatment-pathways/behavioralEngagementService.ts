import { randomUUID } from 'crypto';
import type {
  AuthContext,
  BehavioralSegment,
  BehaviorContract,
  CreateBehaviorContractDTO,
  CreateMicroLearningRuleDTO,
  CreateRoutinePlanDTO,
  ChoiceArchitectureDefaults,
  EscalationSlaBoardResponse,
  FrictionRadarResponse,
  MicroLearningAssignment,
  MicroLearningCard,
  MicroLearningRule,
  RecordRoutineEventDTO,
  RecoveryStreakSummary,
  RoutinePlan,
  SetBehavioralSegmentOverrideDTO,
  UpdateBehaviorContractDTO,
  UpdateChoiceArchitectureDefaultsDTO,
  UpdateMicroLearningRuleDTO,
  UpdateRoutinePlanDTO,
} from '@signacare/shared';
import { db } from '../../db/db';
import { AppError } from '../../shared/errors';
import { updateWithOptimisticLock } from '../../shared/db/optimisticLock';
import { writeAuditLog } from '../../utils/audit';
import { pathwayRepository } from './pathwayRepository';
import {
  getEscalationSlaBoard as buildEscalationSlaBoard,
  getFrictionRadar as buildFrictionRadar,
  getRecoveryStreakSummary as buildRecoveryStreakSummary,
} from './behavioralEngagementAnalytics';
import type { PatientBehaviorContractsRow } from '../../db/types/patient_behavior_contracts';
import type { PatientRoutinePlansRow } from '../../db/types/patient_routine_plans';
import type { PatientBehavioralSegmentsRow } from '../../db/types/patient_behavioral_segments';
import type { MicroLearningCardsRow } from '../../db/types/micro_learning_cards';
import type { ClinicMicroLearningRulesRow } from '../../db/types/clinic_micro_learning_rules';
import type { PatientMicroLearningAssignmentsRow } from '../../db/types/patient_micro_learning_assignments';
import type { ClinicChoiceArchitectureDefaultsRow } from '../../db/types/clinic_choice_architecture_defaults';

type ContractRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  pathway_id: string | null;
  trigger_text: string;
  commitment_behavior: string;
  fallback_plan: string;
  review_date: string;
  accountability_partner: string | null;
  adherence_status: string;
  adherence_note: string | null;
  last_adherence_check_at: Date | string | null;
  is_active: boolean;
  lock_version: number;
  created_by_staff_id: string | null;
  updated_by_staff_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type RoutineRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  pathway_id: string | null;
  name: string;
  condition_kind: string;
  condition_threshold: string | number | null;
  condition_window_minutes: number;
  then_action_kind: string;
  then_action_text: string;
  fallback_after_minutes: number | null;
  fallback_action_text: string | null;
  review_date: string;
  is_active: boolean;
  lock_version: number;
  created_by_staff_id: string | null;
  updated_by_staff_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type RuleRow = {
  id: string;
  clinic_id: string;
  name: string;
  tracking_type: 'anxiety' | 'mood' | 'sleep_hours';
  delta_threshold: string | number;
  window_days: number;
  card_id: string;
  cooldown_days: number;
  is_active: boolean;
  lock_version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type AssignmentRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  card_id: string;
  rule_id: string | null;
  status: 'assigned' | 'opened' | 'completed';
  assigned_at: Date | string;
  opened_at: Date | string | null;
  completed_at: Date | string | null;
  source_reason: string | null;
};

type SegmentRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  segment_code: string;
  confidence_score: string | number;
  rationale: unknown;
  computed_at: Date | string;
  override_by_staff_id: string | null;
  override_reason: string | null;
};

type MicroLearningCardRow = {
  id: string;
  card_key: string;
  title: string;
  body: string;
  estimated_minutes: string | number;
  tags: unknown;
  is_active: boolean;
};

const BEHAVIOR_CONTRACT_COLUMNS: readonly string[] = [
  'id',
  'clinic_id',
  'patient_id',
  'pathway_id',
  'trigger_text',
  'commitment_behavior',
  'fallback_plan',
  'review_date',
  'accountability_partner',
  'adherence_status',
  'adherence_note',
  'last_adherence_check_at',
  'is_active',
  'lock_version',
  'created_by_staff_id',
  'updated_by_staff_id',
  'created_at',
  'updated_at',
];

const ROUTINE_PLAN_COLUMNS: readonly string[] = [
  'id',
  'clinic_id',
  'patient_id',
  'pathway_id',
  'name',
  'condition_kind',
  'condition_threshold',
  'condition_window_minutes',
  'then_action_kind',
  'then_action_text',
  'fallback_after_minutes',
  'fallback_action_text',
  'review_date',
  'is_active',
  'lock_version',
  'created_by_staff_id',
  'updated_by_staff_id',
  'created_at',
  'updated_at',
];

const MICRO_RULE_COLUMNS: readonly string[] = [
  'id',
  'clinic_id',
  'name',
  'tracking_type',
  'delta_threshold',
  'window_days',
  'card_id',
  'cooldown_days',
  'is_active',
  'lock_version',
  'created_at',
  'updated_at',
];

function toIso(input: Date | string | null | undefined): string | null {
  if (!input) return null;
  if (input instanceof Date) return input.toISOString();
  return new Date(input).toISOString();
}

function asNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapContract(row: ContractRow): BehaviorContract {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    pathwayId: row.pathway_id,
    triggerText: row.trigger_text,
    commitmentBehavior: row.commitment_behavior,
    fallbackPlan: row.fallback_plan,
    reviewDate: row.review_date,
    accountabilityPartner: row.accountability_partner,
    adherenceStatus: row.adherence_status as BehaviorContract['adherenceStatus'],
    adherenceNote: row.adherence_note,
    lastAdherenceCheckAt: toIso(row.last_adherence_check_at),
    isActive: row.is_active,
    lockVersion: row.lock_version,
    createdByStaffId: row.created_by_staff_id,
    updatedByStaffId: row.updated_by_staff_id,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function mapRoutine(row: RoutineRow): RoutinePlan {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    pathwayId: row.pathway_id,
    name: row.name,
    conditionKind: row.condition_kind as RoutinePlan['conditionKind'],
    conditionThreshold: asNumber(row.condition_threshold),
    conditionWindowMinutes: row.condition_window_minutes,
    thenActionKind: row.then_action_kind as RoutinePlan['thenActionKind'],
    thenActionText: row.then_action_text,
    fallbackAfterMinutes: row.fallback_after_minutes,
    fallbackActionText: row.fallback_action_text,
    reviewDate: row.review_date,
    isActive: row.is_active,
    lockVersion: row.lock_version,
    createdByStaffId: row.created_by_staff_id,
    updatedByStaffId: row.updated_by_staff_id,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function mapRule(row: RuleRow): MicroLearningRule {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    trackingType: row.tracking_type,
    deltaThreshold: asNumber(row.delta_threshold) ?? 0,
    windowDays: row.window_days,
    cardId: row.card_id,
    cooldownDays: row.cooldown_days,
    isActive: row.is_active,
    lockVersion: row.lock_version,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function behavioralSegmentRowToResponse(row: SegmentRow): BehavioralSegment {
  const rationale = Array.isArray(row.rationale)
    ? row.rationale.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    patientId: row.patient_id,
    segment: row.segment_code as BehavioralSegment['segment'],
    confidence: asNumber(row.confidence_score) ?? 0.95,
    rationale,
    computedAt: toIso(row.computed_at) ?? new Date(0).toISOString(),
    overrideByStaffId: row.override_by_staff_id,
    overrideReason: row.override_reason,
  };
}

function microLearningCardRowToResponse(row: MicroLearningCardRow): MicroLearningCard {
  const tagsValue = row.tags;
  const tags = Array.isArray(tagsValue)
    ? tagsValue.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    id: String(row.id),
    key: String(row.card_key),
    title: String(row.title),
    body: String(row.body),
    estimatedMinutes: Number(row.estimated_minutes),
    tags,
    isActive: Boolean(row.is_active),
  };
}

const DEFAULT_MICRO_LEARNING_CARDS: Array<{
  key: string;
  title: string;
  body: string;
  estimatedMinutes: number;
  tags: string[];
}> = [
  {
    key: 'grounding-5-4-3-2-1',
    title: 'Grounding 5-4-3-2-1',
    body: 'Name 5 things you can see, 4 touch, 3 hear, 2 smell, and 1 taste. Repeat twice and rate anxiety again.',
    estimatedMinutes: 4,
    tags: ['anxiety', 'grounding', 'distress'],
  },
  {
    key: 'sleep-reset-evening',
    title: 'Sleep Reset: 30-minute wind-down',
    body: 'Set a no-screen boundary for 30 minutes before bed. Use dim light, slow breathing, and a short reflection note.',
    estimatedMinutes: 8,
    tags: ['sleep', 'hygiene', 'routine'],
  },
  {
    key: 'thought-check-fast',
    title: 'Fast Thought Check',
    body: 'Write the thought, evidence for, evidence against, then one balanced alternative thought.',
    estimatedMinutes: 6,
    tags: ['cbt', 'thought-diary', 'reframe'],
  },
];

async function assertPathwayIfProvided(clinicId: string, pathwayId: string | undefined): Promise<void> {
  if (!pathwayId) return;
  const row = await pathwayRepository.findById(clinicId, pathwayId);
  if (!row) {
    throw new AppError('Treatment pathway not found', 404, 'PATHWAY_NOT_FOUND');
  }
}

async function ensureMicroLearningCatalog(): Promise<void> {
  const rows = DEFAULT_MICRO_LEARNING_CARDS.map((card) => ({
    id: randomUUID(),
    card_key: card.key,
    title: card.title,
    body: card.body,
    estimated_minutes: card.estimatedMinutes,
    tags: JSON.stringify(card.tags),
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  }));
  await db('micro_learning_cards')
    .insert(rows)
    .onConflict('card_key')
    .ignore();
}

async function computeAndPersistBehavioralSegment(
  auth: AuthContext,
  patientId: string,
): Promise<BehavioralSegment> {
  const existing = await db<PatientBehavioralSegmentsRow>('patient_behavioral_segments')
    .where({ clinic_id: auth.clinicId, patient_id: patientId })
    .first();

  if (existing?.override_by_staff_id) {
    return behavioralSegmentRowToResponse(existing as unknown as SegmentRow);
  }

  const lookbackSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const routineCounts = await db('patient_routine_events')
    .where({ clinic_id: auth.clinicId, patient_id: patientId })
    .where('occurred_at', '>=', lookbackSince)
    .whereIn('event_type', ['routine_triggered', 'routine_completed'])
    .select('event_type')
    .count<{ event_type: string; count: string }[]>('* as count')
    .groupBy('event_type');
  const byType = new Map(routineCounts.map((row) => [String(row.event_type), Number(row.count)]));
  const triggered = byType.get('routine_triggered') ?? 0;
  const completed = byType.get('routine_completed') ?? 0;
  const completionRatio = triggered > 0 ? completed / triggered : 0;

  const anxietyRows = await db('patient_tracking')
    .where({ clinic_id: auth.clinicId, patient_id: patientId, tracking_type: 'anxiety' })
    .where('recorded_at', '>=', lookbackSince)
    .select('value');
  const anxietyAvg = anxietyRows.length > 0
    ? anxietyRows.reduce((sum, row) => sum + (asNumber(row['value'] as number | string) ?? 0), 0) / anxietyRows.length
    : null;

  const overdueContractsCountRow = await db('patient_behavior_contracts')
    .where({ clinic_id: auth.clinicId, patient_id: patientId, is_active: true })
    .whereNotIn('adherence_status', ['completed'])
    .where('review_date', '<', new Date().toISOString().slice(0, 10))
    .count<{ count: string }[]>('* as count')
    .first();
  const overdueContracts = Number(overdueContractsCountRow?.count ?? 0);

  let segment: BehavioralSegment['segment'] = 'ambivalent';
  const rationale: string[] = [];
  let confidence = 0.65;

  if (completionRatio >= 0.75 && overdueContracts === 0) {
    segment = 'motivated';
    confidence = 0.82;
    rationale.push('High routine completion with no overdue contracts');
  } else if ((anxietyAvg != null && anxietyAvg >= 7) && completionRatio < 0.4) {
    segment = 'overwhelmed';
    confidence = 0.8;
    rationale.push('High recent anxiety with low routine completion');
  } else if (completionRatio < 0.25 && overdueContracts >= 2) {
    segment = 'avoidant';
    confidence = 0.77;
    rationale.push('Low routine engagement and repeated overdue contracts');
  } else if (triggered > 0 && completed === 0) {
    segment = 'resistant';
    confidence = 0.72;
    rationale.push('Routines are triggered but not completed');
  } else if (completionRatio >= 0.45 && completionRatio <= 0.7) {
    segment = 'externally_supported';
    confidence = 0.68;
    rationale.push('Moderate adherence pattern suggests support-dependent engagement');
  } else {
    segment = 'ambivalent';
    confidence = 0.64;
    rationale.push('Mixed engagement and adherence signals');
  }

  const now = new Date();
  if (existing) {
    await db('patient_behavioral_segments')
      .where({ id: existing.id, clinic_id: auth.clinicId })
      .update({
        segment_code: segment,
        confidence_score: confidence,
        rationale: JSON.stringify(rationale),
        computed_at: now,
        updated_at: now,
      });
  } else {
    await db('patient_behavioral_segments').insert({
      id: randomUUID(),
      clinic_id: auth.clinicId,
      patient_id: patientId,
      segment_code: segment,
      confidence_score: confidence,
      rationale: JSON.stringify(rationale),
      computed_at: now,
      created_at: now,
      updated_at: now,
    });
  }

  return {
    patientId,
    segment,
    confidence,
    rationale,
    computedAt: now.toISOString(),
    overrideByStaffId: null,
    overrideReason: null,
  };
}

async function maybeAssignTriggeredMicroLearningCards(
  auth: AuthContext,
  patientId: string,
): Promise<void> {
  const rules = await db<ClinicMicroLearningRulesRow>('clinic_micro_learning_rules')
    .where({ clinic_id: auth.clinicId, is_active: true })
    .select(...MICRO_RULE_COLUMNS);
  if (rules.length === 0) return;

  const maxWindow = Math.max(...rules.map((rule) => rule.window_days), 3);
  const since = new Date(Date.now() - (maxWindow + 3) * 24 * 60 * 60 * 1000);

  const trackingRows = await db('patient_tracking')
    .where({ clinic_id: auth.clinicId, patient_id: patientId })
    .whereIn('tracking_type', ['anxiety', 'mood', 'sleep_hours'])
    .where('recorded_at', '>=', since)
    .orderBy('recorded_at', 'asc')
    .select('tracking_type', 'value', 'recorded_at');

  for (const row of rules as unknown as RuleRow[]) {
    const threshold = asNumber(row.delta_threshold) ?? 0;
    const samples = trackingRows
      .filter((sample) => String(sample['tracking_type']) === row.tracking_type)
      .map((sample) => ({
        value: asNumber(sample['value'] as string | number),
        at: sample['recorded_at'] instanceof Date
          ? sample['recorded_at']
          : new Date(String(sample['recorded_at'])),
      }))
      .filter((sample) => sample.value != null) as Array<{ value: number; at: Date }>;
    if (samples.length < row.window_days + 1) continue;

    const recent = samples.slice(-row.window_days);
    const previous = samples.slice(-(row.window_days * 2), -row.window_days);
    if (recent.length === 0 || previous.length === 0) continue;
    const recentAvg = recent.reduce((sum, item) => sum + item.value, 0) / recent.length;
    const previousAvg = previous.reduce((sum, item) => sum + item.value, 0) / previous.length;
    const delta = recentAvg - previousAvg;

    const triggered = delta >= threshold;
    if (!triggered) continue;

    const lastAssignment = await db<PatientMicroLearningAssignmentsRow>('patient_micro_learning_assignments')
      .where({
        clinic_id: auth.clinicId,
        patient_id: patientId,
        rule_id: row.id,
      })
      .orderBy('assigned_at', 'desc')
      .first();
    if (lastAssignment?.assigned_at) {
      const assignedAtMs = new Date(String(lastAssignment.assigned_at)).getTime();
      const cooldownUntil = new Date(assignedAtMs + row.cooldown_days * 24 * 60 * 60 * 1000);
      if (cooldownUntil > new Date()) continue;
    }

    await db('patient_micro_learning_assignments').insert({
      id: randomUUID(),
      clinic_id: auth.clinicId,
      patient_id: patientId,
      card_id: row.card_id,
      rule_id: row.id,
      status: 'assigned',
      assigned_at: new Date(),
      source_reason: `Rule '${row.name}' triggered: ${row.tracking_type} delta ${delta.toFixed(2)} over ${row.window_days} day window`,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }
}

export const behavioralEngagementService = {
  async listBehaviorContracts(auth: AuthContext, patientId: string): Promise<BehaviorContract[]> {
    const rows = await db<PatientBehaviorContractsRow>('patient_behavior_contracts')
      .where({ clinic_id: auth.clinicId, patient_id: patientId })
      .orderBy('review_date', 'asc')
      .orderBy('created_at', 'desc')
      .select(...BEHAVIOR_CONTRACT_COLUMNS);
    return rows.map((row) => mapContract(row as unknown as ContractRow));
  },

  async createBehaviorContract(auth: AuthContext, dto: CreateBehaviorContractDTO): Promise<BehaviorContract> {
    await assertPathwayIfProvided(auth.clinicId, dto.pathwayId);
    const now = new Date();
    const [created] = (await db<ContractRow>('patient_behavior_contracts')
      .insert({
        id: randomUUID(),
        clinic_id: auth.clinicId,
        patient_id: dto.patientId,
        pathway_id: dto.pathwayId ?? null,
        trigger_text: dto.triggerText,
        commitment_behavior: dto.commitmentBehavior,
        fallback_plan: dto.fallbackPlan,
        review_date: dto.reviewDate,
        accountability_partner: dto.accountabilityPartner ?? null,
        adherence_status: 'on_track',
        is_active: true,
        created_by_staff_id: auth.staffId,
        updated_by_staff_id: auth.staffId,
        created_at: now,
        updated_at: now,
      })
      .returning([...BEHAVIOR_CONTRACT_COLUMNS])) as ContractRow[];

    await writeAuditLog({
      clinicId: auth.clinicId,
      userId: auth.staffId,
      action: 'CREATE',
      tableName: 'patient_behavior_contracts',
      recordId: created.id,
      newData: {
        patientId: dto.patientId,
        reviewDate: dto.reviewDate,
      },
    });

    return mapContract(created);
  },

  async updateBehaviorContract(
    auth: AuthContext,
    contractId: string,
    dto: UpdateBehaviorContractDTO,
  ): Promise<BehaviorContract> {
    const patch: Record<string, unknown> = {
      updated_by_staff_id: auth.staffId,
    };
    if (dto.triggerText !== undefined) patch.trigger_text = dto.triggerText;
    if (dto.commitmentBehavior !== undefined) patch.commitment_behavior = dto.commitmentBehavior;
    if (dto.fallbackPlan !== undefined) patch.fallback_plan = dto.fallbackPlan;
    if (dto.reviewDate !== undefined) patch.review_date = dto.reviewDate;
    if (dto.accountabilityPartner !== undefined) patch.accountability_partner = dto.accountabilityPartner;
    if (dto.adherenceStatus !== undefined) patch.adherence_status = dto.adherenceStatus;
    if (dto.adherenceNote !== undefined) patch.adherence_note = dto.adherenceNote;
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;
    if (dto.adherenceStatus !== undefined || dto.adherenceNote !== undefined) {
      patch.last_adherence_check_at = new Date();
    }
    const updated = await updateWithOptimisticLock<ContractRow>({
      table: 'patient_behavior_contracts',
      where: { id: contractId, clinic_id: auth.clinicId },
      expectedLockVersion: dto.expectedLockVersion,
      patch,
      returning: BEHAVIOR_CONTRACT_COLUMNS,
    });
    return mapContract(updated);
  },

  async listRoutinePlans(auth: AuthContext, patientId: string): Promise<RoutinePlan[]> {
    const rows = await db<PatientRoutinePlansRow>('patient_routine_plans')
      .where({ clinic_id: auth.clinicId, patient_id: patientId })
      .orderBy('is_active', 'desc')
      .orderBy('review_date', 'asc')
      .select(...ROUTINE_PLAN_COLUMNS);
    return rows.map((row) => mapRoutine(row as unknown as RoutineRow));
  },

  async createRoutinePlan(auth: AuthContext, dto: CreateRoutinePlanDTO): Promise<RoutinePlan> {
    await assertPathwayIfProvided(auth.clinicId, dto.pathwayId);
    const now = new Date();
    const [created] = (await db<RoutineRow>('patient_routine_plans')
      .insert({
        id: randomUUID(),
        clinic_id: auth.clinicId,
        patient_id: dto.patientId,
        pathway_id: dto.pathwayId ?? null,
        name: dto.name,
        condition_kind: dto.conditionKind,
        condition_threshold: dto.conditionThreshold ?? null,
        condition_window_minutes: dto.conditionWindowMinutes,
        then_action_kind: dto.thenActionKind,
        then_action_text: dto.thenActionText,
        fallback_after_minutes: dto.fallbackAfterMinutes ?? null,
        fallback_action_text: dto.fallbackActionText ?? null,
        review_date: dto.reviewDate,
        is_active: dto.isActive,
        created_by_staff_id: auth.staffId,
        updated_by_staff_id: auth.staffId,
        created_at: now,
        updated_at: now,
      })
      .returning([...ROUTINE_PLAN_COLUMNS])) as RoutineRow[];
    return mapRoutine(created);
  },

  async updateRoutinePlan(auth: AuthContext, routineId: string, dto: UpdateRoutinePlanDTO): Promise<RoutinePlan> {
    const patch: Record<string, unknown> = {
      updated_by_staff_id: auth.staffId,
    };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.conditionKind !== undefined) patch.condition_kind = dto.conditionKind;
    if (dto.conditionThreshold !== undefined) patch.condition_threshold = dto.conditionThreshold;
    if (dto.conditionWindowMinutes !== undefined) patch.condition_window_minutes = dto.conditionWindowMinutes;
    if (dto.thenActionKind !== undefined) patch.then_action_kind = dto.thenActionKind;
    if (dto.thenActionText !== undefined) patch.then_action_text = dto.thenActionText;
    if (dto.fallbackAfterMinutes !== undefined) patch.fallback_after_minutes = dto.fallbackAfterMinutes;
    if (dto.fallbackActionText !== undefined) patch.fallback_action_text = dto.fallbackActionText;
    if (dto.reviewDate !== undefined) patch.review_date = dto.reviewDate;
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;

    const updated = await updateWithOptimisticLock<RoutineRow>({
      table: 'patient_routine_plans',
      where: { id: routineId, clinic_id: auth.clinicId },
      expectedLockVersion: dto.expectedLockVersion,
      patch,
      returning: ROUTINE_PLAN_COLUMNS,
    });
    return mapRoutine(updated);
  },

  async recordRoutineEvent(auth: AuthContext, dto: RecordRoutineEventDTO): Promise<void> {
    await db('patient_routine_events').insert({
      id: randomUUID(),
      clinic_id: auth.clinicId,
      patient_id: dto.patientId,
      routine_id: dto.routineId ?? null,
      event_type: dto.eventType,
      value_numeric: dto.valueNumeric ?? null,
      value_text: dto.valueText ?? null,
      occurred_at: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      created_at: new Date(),
    });
    await maybeAssignTriggeredMicroLearningCards(auth, dto.patientId);
  },

  async getRecoveryStreakSummary(auth: AuthContext, patientId: string): Promise<RecoveryStreakSummary> {
    return buildRecoveryStreakSummary(auth, patientId);
  },

  async getFrictionRadar(auth: AuthContext, patientId: string): Promise<FrictionRadarResponse> {
    return buildFrictionRadar(auth, patientId);
  },

  async getEscalationSlaBoard(auth: AuthContext): Promise<EscalationSlaBoardResponse> {
    return buildEscalationSlaBoard(auth);
  },

  async getBehavioralSegment(auth: AuthContext, patientId: string): Promise<BehavioralSegment> {
    return computeAndPersistBehavioralSegment(auth, patientId);
  },

  async setBehavioralSegmentOverride(
    auth: AuthContext,
    patientId: string,
    dto: SetBehavioralSegmentOverrideDTO,
  ): Promise<BehavioralSegment> {
    const now = new Date();
    const existing = await db<PatientBehavioralSegmentsRow>('patient_behavioral_segments')
      .where({ clinic_id: auth.clinicId, patient_id: patientId })
      .first();
    if (existing) {
      await db('patient_behavioral_segments')
        .where({ id: existing.id, clinic_id: auth.clinicId })
        .update({
          segment_code: dto.segment,
          confidence_score: dto.confidence,
          rationale: JSON.stringify(['Clinician override']),
          computed_at: now,
          override_by_staff_id: auth.staffId,
          override_reason: dto.overrideReason,
          updated_at: now,
        });
    } else {
      await db('patient_behavioral_segments').insert({
        id: randomUUID(),
        clinic_id: auth.clinicId,
        patient_id: patientId,
        segment_code: dto.segment,
        confidence_score: dto.confidence,
        rationale: JSON.stringify(['Clinician override']),
        computed_at: now,
        override_by_staff_id: auth.staffId,
        override_reason: dto.overrideReason,
        created_at: now,
        updated_at: now,
      });
    }
    return {
      patientId,
      segment: dto.segment,
      confidence: dto.confidence ?? 0.95,
      rationale: ['Clinician override'],
      computedAt: now.toISOString(),
      overrideByStaffId: auth.staffId,
      overrideReason: dto.overrideReason,
    };
  },

  async listMicroLearningCards(auth: AuthContext): Promise<MicroLearningCard[]> {
    void auth;
    await ensureMicroLearningCatalog();
    const rows = await db<MicroLearningCardsRow>('micro_learning_cards')
      .where({ is_active: true })
      .orderBy('title', 'asc')
      .select('id', 'card_key', 'title', 'body', 'estimated_minutes', 'tags', 'is_active');
    return rows.map((row) => microLearningCardRowToResponse(row as unknown as MicroLearningCardRow));
  },

  async listMicroLearningRules(auth: AuthContext): Promise<MicroLearningRule[]> {
    await ensureMicroLearningCatalog();
    const rows = await db<ClinicMicroLearningRulesRow>('clinic_micro_learning_rules')
      .where({ clinic_id: auth.clinicId })
      .orderBy('created_at', 'desc')
      .select(...MICRO_RULE_COLUMNS);
    return rows.map((row) => mapRule(row as unknown as RuleRow));
  },

  async createMicroLearningRule(auth: AuthContext, dto: CreateMicroLearningRuleDTO): Promise<MicroLearningRule> {
    await ensureMicroLearningCatalog();
    const [created] = (await db<RuleRow>('clinic_micro_learning_rules')
      .insert({
        id: randomUUID(),
        clinic_id: auth.clinicId,
        name: dto.name,
        tracking_type: dto.trackingType,
        delta_threshold: dto.deltaThreshold,
        window_days: dto.windowDays,
        card_id: dto.cardId,
        cooldown_days: dto.cooldownDays,
        is_active: dto.isActive,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning([...MICRO_RULE_COLUMNS])) as RuleRow[];
    return mapRule(created);
  },

  async updateMicroLearningRule(auth: AuthContext, ruleId: string, dto: UpdateMicroLearningRuleDTO): Promise<MicroLearningRule> {
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.trackingType !== undefined) patch.tracking_type = dto.trackingType;
    if (dto.deltaThreshold !== undefined) patch.delta_threshold = dto.deltaThreshold;
    if (dto.windowDays !== undefined) patch.window_days = dto.windowDays;
    if (dto.cardId !== undefined) patch.card_id = dto.cardId;
    if (dto.cooldownDays !== undefined) patch.cooldown_days = dto.cooldownDays;
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;

    const updated = await updateWithOptimisticLock<RuleRow>({
      table: 'clinic_micro_learning_rules',
      where: { id: ruleId, clinic_id: auth.clinicId },
      expectedLockVersion: dto.expectedLockVersion,
      patch,
      returning: MICRO_RULE_COLUMNS,
    });
    return mapRule(updated);
  },

  async listPatientMicroLearningAssignments(
    auth: AuthContext,
    patientId: string,
  ): Promise<MicroLearningAssignment[]> {
    await ensureMicroLearningCatalog();
    await maybeAssignTriggeredMicroLearningCards(auth, patientId);
    const rows = await db<PatientMicroLearningAssignmentsRow>('patient_micro_learning_assignments')
      .where({ clinic_id: auth.clinicId, patient_id: patientId })
      .orderBy('assigned_at', 'desc')
      .select(
        'id',
        'clinic_id',
        'patient_id',
        'card_id',
        'rule_id',
        'status',
        'assigned_at',
        'opened_at',
        'completed_at',
        'source_reason',
      );
    return rows.map((row) => {
      const typed = row as unknown as AssignmentRow;
      return {
        id: typed.id,
        clinicId: typed.clinic_id,
        patientId: typed.patient_id,
        cardId: typed.card_id,
        ruleId: typed.rule_id,
        status: typed.status,
        assignedAt: toIso(typed.assigned_at) ?? new Date(0).toISOString(),
        openedAt: toIso(typed.opened_at),
        completedAt: toIso(typed.completed_at),
        sourceReason: typed.source_reason,
      };
    });
  },

  async setMicroLearningAssignmentStatus(
    auth: AuthContext,
    assignmentId: string,
    status: 'assigned' | 'opened' | 'completed',
  ): Promise<void> {
    const patch: Record<string, unknown> = {
      status,
      updated_at: new Date(),
    };
    if (status === 'opened') patch.opened_at = new Date();
    if (status === 'completed') patch.completed_at = new Date();
    const updated = await db('patient_micro_learning_assignments')
      .where({ id: assignmentId, clinic_id: auth.clinicId })
      .update(patch);
    if (updated === 0) {
      throw new AppError('Micro-learning assignment not found', 404, 'NOT_FOUND');
    }
  },

  async getChoiceArchitectureDefaults(auth: AuthContext): Promise<ChoiceArchitectureDefaults> {
    const existing = await db<ClinicChoiceArchitectureDefaultsRow>('clinic_choice_architecture_defaults')
      .where({ clinic_id: auth.clinicId })
      .first();
    if (!existing) {
      const now = new Date();
      const [created] = await db('clinic_choice_architecture_defaults')
        .insert({
          id: randomUUID(),
          clinic_id: auth.clinicId,
          next_review_due_days_default: 28,
          safety_plan_refresh_days_default: 30,
          medication_reminder_window_minutes: 90,
          created_at: now,
          updated_at: now,
        })
        .returning('*');
      return {
        clinicId: String(created['clinic_id']),
        nextReviewDueDaysDefault: Number(created['next_review_due_days_default']),
        safetyPlanRefreshDaysDefault: Number(created['safety_plan_refresh_days_default']),
        medicationReminderWindowMinutes: Number(created['medication_reminder_window_minutes']),
        createdAt: new Date(String(created['created_at'])).toISOString(),
        updatedAt: new Date(String(created['updated_at'])).toISOString(),
      };
    }
    return {
      clinicId: String(existing['clinic_id']),
      nextReviewDueDaysDefault: Number(existing['next_review_due_days_default']),
      safetyPlanRefreshDaysDefault: Number(existing['safety_plan_refresh_days_default']),
      medicationReminderWindowMinutes: Number(existing['medication_reminder_window_minutes']),
      createdAt: new Date(String(existing['created_at'])).toISOString(),
      updatedAt: new Date(String(existing['updated_at'])).toISOString(),
    };
  },

  async updateChoiceArchitectureDefaults(
    auth: AuthContext,
    dto: UpdateChoiceArchitectureDefaultsDTO,
  ): Promise<ChoiceArchitectureDefaults> {
    await behavioralEngagementService.getChoiceArchitectureDefaults(auth);
    const patch: Record<string, unknown> = {
      updated_at: new Date(),
    };
    if (dto.nextReviewDueDaysDefault !== undefined) {
      patch.next_review_due_days_default = dto.nextReviewDueDaysDefault;
    }
    if (dto.safetyPlanRefreshDaysDefault !== undefined) {
      patch.safety_plan_refresh_days_default = dto.safetyPlanRefreshDaysDefault;
    }
    if (dto.medicationReminderWindowMinutes !== undefined) {
      patch.medication_reminder_window_minutes = dto.medicationReminderWindowMinutes;
    }
    await db('clinic_choice_architecture_defaults')
      .where({ clinic_id: auth.clinicId })
      .update(patch);
    return behavioralEngagementService.getChoiceArchitectureDefaults(auth);
  },
};
