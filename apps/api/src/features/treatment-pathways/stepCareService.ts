import type {
  AuthContext,
  CreateStepCareRuleDTO,
  PathwayInterventionTemplateKey,
  PathwayResearchLaneSummary,
  StepCareRule,
  StepCareRuleCondition,
  UpdateStepCareRuleDTO,
} from '@signacare/shared';
import { db, dbAdmin } from '../../db/db';
import { AppError } from '../../shared/errors';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { updateWithOptimisticLock } from '../../shared/db/optimisticLock';
import { CLINIC_STEP_CARE_RULES_COLUMNS } from '../../db/types/clinic_step_care_rules';
import { pathwayService } from './pathwayService';
import { pathwayRepository, type TreatmentPathwayRow } from './pathwayRepository';
import { createTaskInternalAdmin } from '../tasks/taskService';
import { emitClinicalSignal } from '../events/clinicalSignalEmitter';
import { withTenantContext } from '../../shared/tenantContext';
import logger from '../../utils/logger';

type StepCareRuleRow = {
  id: string;
  clinic_id: string;
  name: string;
  description: string | null;
  pathway_type: string;
  intervention_template_key: PathwayInterventionTemplateKey;
  auto_assign_enabled: boolean;
  auto_escalate_enabled: boolean;
  escalation_priority: 'medium' | 'high' | 'urgent';
  assignment_scope: 'primary_clinician' | 'team_lead' | 'clinic_admin';
  is_active: boolean;
  expected_outcome_text: string | null;
  conditions: unknown;
  created_by_staff_id: string | null;
  lock_version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type PatientSignalSnapshot = {
  moodAvg: number | null;
  anxietyAvg: number | null;
  sleepHoursAvg: number | null;
  phq9Latest: number | null;
  gad7Latest: number | null;
  riskIndexLatest: number | null;
  observationDays: number;
};

type PathwayCandidate = TreatmentPathwayRow & {
  clinicianId: string | null;
  episodeId: string | null;
};

type OutcomeMeasureSignalRow = {
  template_name: string | null;
  measure_type: string | null;
  total_score: unknown;
  items: unknown;
};

type OutcomeMeasureToResponse = {
  templateName: string;
  measureType: string;
  totalScore: number | null;
  items: Record<string, unknown>;
};

type PhenotypeSignalRow = {
  risk_index: unknown;
  contributing_signals: unknown;
};

type PhenotypeSignalToResponse = {
  riskIndex: number | null;
  contributingSignals: Record<string, unknown>;
};

export type StepCareAutomationTickResult = {
  rulesScanned: number;
  patientsMatched: number;
  assignmentsCreated: number;
  escalationsCreated: number;
};

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === 'object' && parsed ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function outcomeMeasureToResponse(row: OutcomeMeasureSignalRow): OutcomeMeasureToResponse {
  return {
    templateName: String(row.template_name ?? ''),
    measureType: String(row.measure_type ?? ''),
    totalScore: asNullableNumber(row.total_score),
    items: parseJsonObject(row.items),
  };
}

function phenotypeSignalToResponse(row: PhenotypeSignalRow | undefined): PhenotypeSignalToResponse {
  if (!row) {
    return { riskIndex: null, contributingSignals: {} };
  }
  return {
    riskIndex: asNullableNumber(row.risk_index),
    contributingSignals: parseJsonObject(row.contributing_signals),
  };
}

function normalizeConditions(value: unknown): StepCareRuleCondition {
  const raw = parseJsonObject(value);
  const minimumObservationDays = Math.max(
    1,
    Math.min(90, Math.trunc(asNullableNumber(raw['minimumObservationDays']) ?? 7)),
  );
  const cooldownDays = Math.max(1, Math.min(90, Math.trunc(asNullableNumber(raw['cooldownDays']) ?? 7)));
  return {
    moodBelowThreshold: asNullableNumber(raw['moodBelowThreshold']),
    anxietyAboveThreshold: asNullableNumber(raw['anxietyAboveThreshold']),
    sleepHoursBelow: asNullableNumber(raw['sleepHoursBelow']),
    phq9MinScore: asNullableNumber(raw['phq9MinScore']),
    gad7MinScore: asNullableNumber(raw['gad7MinScore']),
    riskIndexMin: asNullableNumber(raw['riskIndexMin']),
    minimumObservationDays,
    cooldownDays,
  };
}

function mapRuleRow(row: StepCareRuleRow): StepCareRule {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    description: row.description,
    pathwayType: row.pathway_type,
    interventionTemplateKey: row.intervention_template_key,
    autoAssignEnabled: row.auto_assign_enabled,
    autoEscalateEnabled: row.auto_escalate_enabled,
    escalationPriority: row.escalation_priority,
    assignmentScope: row.assignment_scope,
    isActive: row.is_active,
    expectedOutcomeText: row.expected_outcome_text,
    conditions: normalizeConditions(row.conditions),
    lockVersion: row.lock_version,
    createdByStaffId: row.created_by_staff_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function toSqlConditions(conditions: StepCareRuleCondition): Record<string, unknown> {
  return {
    moodBelowThreshold: conditions.moodBelowThreshold ?? null,
    anxietyAboveThreshold: conditions.anxietyAboveThreshold ?? null,
    sleepHoursBelow: conditions.sleepHoursBelow ?? null,
    phq9MinScore: conditions.phq9MinScore ?? null,
    gad7MinScore: conditions.gad7MinScore ?? null,
    riskIndexMin: conditions.riskIndexMin ?? null,
    minimumObservationDays: conditions.minimumObservationDays ?? 7,
    cooldownDays: conditions.cooldownDays ?? 7,
  };
}

function hasAnyCondition(conditions: StepCareRuleCondition): boolean {
  return [
    conditions.moodBelowThreshold,
    conditions.anxietyAboveThreshold,
    conditions.sleepHoursBelow,
    conditions.phq9MinScore,
    conditions.gad7MinScore,
    conditions.riskIndexMin,
  ].some((item) => item != null);
}

async function assertPathwaysModuleEnabled(clinicId: string): Promise<void> {
  const moduleRow = await dbAdmin('clinic_modules')
    .where({ clinic_id: clinicId, module_key: MODULE_KEYS.PATHWAYS })
    .first('is_enabled');
  if (moduleRow && moduleRow['is_enabled'] === false) {
    throw new AppError(
      `Module '${MODULE_KEYS.PATHWAYS}' is disabled for this clinic`,
      403,
      'MODULE_DISABLED',
    );
  }
}

async function resolveClinicAutomationActor(clinicId: string): Promise<string | null> {
  const clinic = await dbAdmin('clinics')
    .where({ id: clinicId })
    .whereNull('deleted_at')
    .first('nominated_admin_staff_id', 'delegated_admin_staff_id');
  const nominated = clinic?.['nominated_admin_staff_id'];
  if (typeof nominated === 'string' && nominated.length > 0) return nominated;
  const delegated = clinic?.['delegated_admin_staff_id'];
  if (typeof delegated === 'string' && delegated.length > 0) return delegated;
  const fallback = await dbAdmin('staff')
    .where({ clinic_id: clinicId, is_active: true })
    .whereIn('role', ['admin', 'manager', 'superadmin'])
    .whereNull('deleted_at')
    .orderBy('created_at', 'asc')
    .first('id');
  return typeof fallback?.['id'] === 'string' ? fallback['id'] : null;
}

async function fetchPathwayCandidates(
  clinicId: string,
  pathwayType: string,
): Promise<PathwayCandidate[]> {
  const rows = await db('treatment_pathways as tp')
    .leftJoin('episodes as e', function joinEpisode() {
      this.on('e.patient_id', '=', 'tp.patient_id')
        .andOn('e.clinic_id', '=', 'tp.clinic_id')
        .andOn('e.status', '=', db.raw('?', ['open']))
        .andOnNull('e.deleted_at');
    })
    .where({
      'tp.clinic_id': clinicId,
      'tp.status': 'active',
    })
    .whereRaw("COALESCE(tp.milestones->>'pathwayType', '') = ?", [pathwayType])
    .select(
      'tp.id',
      'tp.patient_id',
      'tp.clinic_id',
      'tp.updated_by_staff_id',
      'tp.name',
      'tp.status',
      'tp.milestones',
      'tp.created_at',
      'tp.updated_at',
      'tp.lock_version',
      'e.primary_clinician_id as clinician_id',
      'e.id as episode_id',
    );

  return rows.map((row) => ({
    id: String(row['id']),
    patient_id: String(row['patient_id']),
    clinic_id: String(row['clinic_id']),
    updated_by_staff_id: (row['updated_by_staff_id'] as string | null) ?? null,
    name: String(row['name']),
    status: String(row['status']),
    milestones: row['milestones'],
    created_at: row['created_at'] as Date,
    updated_at: row['updated_at'] as Date,
    lock_version: Number(row['lock_version']),
    clinicianId: (row['clinician_id'] as string | null) ?? null,
    episodeId: (row['episode_id'] as string | null) ?? null,
  }));
}

async function computeSignalSnapshot(
  clinicId: string,
  patientId: string,
  minimumObservationDays: number,
): Promise<PatientSignalSnapshot> {
  const since = new Date(Date.now() - minimumObservationDays * 24 * 60 * 60 * 1000);
  const trackingRows = await db('patient_tracking')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereIn('tracking_type', ['mood', 'anxiety', 'sleep_hours'])
    .where('recorded_at', '>=', since)
    .select('tracking_type', 'value', 'recorded_at')
    .orderBy('recorded_at', 'desc')
    .limit(500);

  const byType = new Map<string, number[]>();
  const observedDays = new Set<string>();
  for (const row of trackingRows) {
    const type = String(row['tracking_type']);
    const value = asNullableNumber(row['value']);
    if (value == null) continue;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)?.push(value);
    const recordedAt = row['recorded_at'] instanceof Date
      ? row['recorded_at']
      : new Date(String(row['recorded_at']));
    observedDays.add(recordedAt.toISOString().split('T')[0]);
  }

  const outcomeRows = await db('outcome_measures')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereNull('deleted_at')
    .whereNotNull('total_score')
    .whereRaw("LOWER(COALESCE(template_name, measure_type, '')) IN (?, ?, ?, ?)", [
      'phq-9',
      'phq9',
      'gad-7',
      'gad7',
    ])
    .orderBy('created_at', 'desc')
    .select('template_name', 'measure_type', 'total_score', 'items')
    .limit(50);

  let phq9Latest: number | null = null;
  let gad7Latest: number | null = null;
  for (const rawRow of outcomeRows) {
    const row = outcomeMeasureToResponse(rawRow as OutcomeMeasureSignalRow);
    const rawName = `${row.templateName || row.measureType}`.toLowerCase();
    const score = row.totalScore;
    if (score == null) continue;
    if (phq9Latest == null && (rawName.includes('phq-9') || rawName.includes('phq9'))) {
      phq9Latest = score;
      continue;
    }
    if (gad7Latest == null && (rawName.includes('gad-7') || rawName.includes('gad7'))) {
      gad7Latest = score;
    }
    if (phq9Latest != null && gad7Latest != null) break;
  }

  const phenotypeRow = await db('patient_digital_phenotypes')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .orderBy('computation_day', 'desc')
    .first('risk_index', 'contributing_signals');
  const phenotype = phenotypeSignalToResponse(phenotypeRow as PhenotypeSignalRow | undefined);

  const avg = (values: number[] | undefined): number | null => {
    if (!values || values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  return {
    moodAvg: avg(byType.get('mood')),
    anxietyAvg: avg(byType.get('anxiety')),
    sleepHoursAvg: avg(byType.get('sleep_hours')),
    phq9Latest,
    gad7Latest,
    riskIndexLatest: phenotype.riskIndex,
    observationDays: observedDays.size,
  };
}

function evaluateRuleMatch(
  conditions: StepCareRuleCondition,
  snapshot: PatientSignalSnapshot,
): { matched: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!hasAnyCondition(conditions)) {
    return { matched: false, reasons: ['Rule has no measurable conditions'] };
  }
  if (snapshot.observationDays < (conditions.minimumObservationDays ?? 7)) {
    return {
      matched: false,
      reasons: [`Insufficient observation days (${snapshot.observationDays}/${conditions.minimumObservationDays ?? 7})`],
    };
  }

  if (conditions.moodBelowThreshold != null) {
    const current = snapshot.moodAvg;
    if (current == null || current > conditions.moodBelowThreshold) {
      return { matched: false, reasons: ['Mood threshold not met'] };
    }
    reasons.push(`Mood avg ${current.toFixed(2)} <= ${conditions.moodBelowThreshold}`);
  }

  if (conditions.anxietyAboveThreshold != null) {
    const current = snapshot.anxietyAvg;
    if (current == null || current < conditions.anxietyAboveThreshold) {
      return { matched: false, reasons: ['Anxiety threshold not met'] };
    }
    reasons.push(`Anxiety avg ${current.toFixed(2)} >= ${conditions.anxietyAboveThreshold}`);
  }

  if (conditions.sleepHoursBelow != null) {
    const current = snapshot.sleepHoursAvg;
    if (current == null || current > conditions.sleepHoursBelow) {
      return { matched: false, reasons: ['Sleep-hours threshold not met'] };
    }
    reasons.push(`Sleep hours avg ${current.toFixed(2)} <= ${conditions.sleepHoursBelow}`);
  }

  if (conditions.phq9MinScore != null) {
    const current = snapshot.phq9Latest;
    if (current == null || current < conditions.phq9MinScore) {
      return { matched: false, reasons: ['PHQ-9 threshold not met'] };
    }
    reasons.push(`PHQ-9 latest ${current} >= ${conditions.phq9MinScore}`);
  }

  if (conditions.gad7MinScore != null) {
    const current = snapshot.gad7Latest;
    if (current == null || current < conditions.gad7MinScore) {
      return { matched: false, reasons: ['GAD-7 threshold not met'] };
    }
    reasons.push(`GAD-7 latest ${current} >= ${conditions.gad7MinScore}`);
  }

  if (conditions.riskIndexMin != null) {
    const current = snapshot.riskIndexLatest;
    if (current == null || current < conditions.riskIndexMin) {
      return { matched: false, reasons: ['Phenotype risk threshold not met'] };
    }
    reasons.push(`Risk index ${current.toFixed(2)} >= ${conditions.riskIndexMin}`);
  }

  return { matched: true, reasons };
}

async function tryInsertRuleEvent(event: {
  clinicId: string;
  ruleId: string;
  patientId: string;
  pathwayId: string | null;
  eventType: 'auto_assigned_pack' | 'auto_escalated_task';
  fingerprint: string;
  details: Record<string, unknown>;
}): Promise<boolean> {
  const result = await dbAdmin('step_care_rule_events')
    .insert({
      clinic_id: event.clinicId,
      rule_id: event.ruleId,
      patient_id: event.patientId,
      pathway_id: event.pathwayId,
      event_type: event.eventType,
      fingerprint: event.fingerprint,
      details: JSON.stringify(event.details),
      created_at: new Date(),
    })
    .onConflict(['clinic_id', 'fingerprint'])
    .ignore()
    .returning('id');
  return Array.isArray(result) && result.length > 0;
}

async function maybeAssignInterventionFromRule(
  actor: AuthContext,
  rule: StepCareRule,
  pathway: PathwayCandidate,
  reasons: string[],
): Promise<boolean> {
  const day = new Date().toISOString().split('T')[0];
  const fingerprint = `step-care:${rule.id}:${pathway.patient_id}:${pathway.id}:assign:${day}`;
  const inserted = await tryInsertRuleEvent({
    clinicId: actor.clinicId,
    ruleId: rule.id,
    patientId: pathway.patient_id,
    pathwayId: pathway.id,
    eventType: 'auto_assigned_pack',
    fingerprint,
    details: {
      pathwayType: rule.pathwayType,
      templateKey: rule.interventionTemplateKey,
      reasons,
    },
  });
  if (!inserted) return false;

  await pathwayService.assignInterventionPack(actor, pathway.id, {
    expectedLockVersion: pathway.lock_version,
    templateKey: rule.interventionTemplateKey,
    notes: `Auto-assigned by step-care rule: ${rule.name}`,
  });
  return true;
}

async function resolveEscalationAssignee(
  clinicId: string,
  pathway: PathwayCandidate,
  assignmentScope: StepCareRule['assignmentScope'],
): Promise<string | null> {
  if (assignmentScope === 'primary_clinician' || assignmentScope === 'team_lead') {
    if (pathway.clinicianId) return pathway.clinicianId;
  }
  const clinic = await db('clinics')
    .where({ id: clinicId })
    .whereNull('deleted_at')
    .first('nominated_admin_staff_id', 'delegated_admin_staff_id');
  const nominated = clinic?.['nominated_admin_staff_id'];
  if (typeof nominated === 'string' && nominated.length > 0) return nominated;
  const delegated = clinic?.['delegated_admin_staff_id'];
  if (typeof delegated === 'string' && delegated.length > 0) return delegated;
  return null;
}

async function maybeEscalateFromRule(
  actor: AuthContext,
  rule: StepCareRule,
  pathway: PathwayCandidate,
  reasons: string[],
): Promise<boolean> {
  const assignee = await resolveEscalationAssignee(actor.clinicId, pathway, rule.assignmentScope);
  if (!assignee) return false;

  const day = new Date().toISOString().split('T')[0];
  const fingerprint = `step-care:${rule.id}:${pathway.patient_id}:${pathway.id}:escalate:${day}:${assignee}`;
  const inserted = await tryInsertRuleEvent({
    clinicId: actor.clinicId,
    ruleId: rule.id,
    patientId: pathway.patient_id,
    pathwayId: pathway.id,
    eventType: 'auto_escalated_task',
    fingerprint,
    details: {
      pathwayType: rule.pathwayType,
      escalationPriority: rule.escalationPriority,
      assignee,
      reasons,
    },
  });
  if (!inserted) return false;

  const task = await createTaskInternalAdmin(actor.clinicId, actor.staffId, {
    assignedToId: assignee,
    patientId: pathway.patient_id,
    episodeId: pathway.episodeId ?? undefined,
    priority: rule.escalationPriority,
    title: `Step-care escalation: ${rule.name}`,
    description: [
      `Automated step-care rule triggered for ${rule.pathwayType.toUpperCase()} pathway.`,
      ...reasons.map((reason) => `- ${reason}`),
      rule.expectedOutcomeText ? `Expected outcome: ${rule.expectedOutcomeText}` : '',
    ].filter(Boolean).join('\n'),
    dueDate: new Date().toISOString(),
  });

  await emitClinicalSignal({
    clinicId: actor.clinicId,
    userId: assignee,
    source: 'scheduler',
    signalKey: 'step_care_escalation',
    severity: rule.escalationPriority === 'urgent' ? 'critical' : 'warning',
    category: 'workflow',
    title: `Step-care escalation: ${rule.name}`,
    body: `Automated escalation generated for patient ${pathway.patient_id}.`,
    actionUrl: `/tasks?taskId=${task.id}`,
    dedupeKey: `step-care-escalation:${rule.id}:${pathway.id}:${day}`,
    payload: {
      rule_id: rule.id,
      patient_id: pathway.patient_id,
      pathway_id: pathway.id,
      task_id: task.id,
      reasons,
    },
  });
  return true;
}

export const stepCareService = {
  async listRules(auth: AuthContext): Promise<StepCareRule[]> {
    const rows = (await dbAdmin('clinic_step_care_rules')
      .where({ clinic_id: auth.clinicId })
      .orderBy('created_at', 'desc')
      .select(CLINIC_STEP_CARE_RULES_COLUMNS as unknown as string[])) as unknown as StepCareRuleRow[];
    return rows.map(mapRuleRow);
  },

  async createRule(auth: AuthContext, dto: CreateStepCareRuleDTO): Promise<StepCareRule> {
    await assertPathwaysModuleEnabled(auth.clinicId);
    const row = (await dbAdmin('clinic_step_care_rules')
      .insert({
        clinic_id: auth.clinicId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        pathway_type: dto.pathwayType.trim().toLowerCase(),
        intervention_template_key: dto.interventionTemplateKey,
        auto_assign_enabled: dto.autoAssignEnabled ?? true,
        auto_escalate_enabled: dto.autoEscalateEnabled ?? true,
        escalation_priority: dto.escalationPriority ?? 'high',
        assignment_scope: dto.assignmentScope ?? 'primary_clinician',
        is_active: dto.isActive ?? true,
        expected_outcome_text: dto.expectedOutcomeText?.trim() || null,
        conditions: JSON.stringify(toSqlConditions(dto.conditions)),
        created_by_staff_id: auth.staffId,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(CLINIC_STEP_CARE_RULES_COLUMNS as unknown as string[])) as unknown as StepCareRuleRow[];
    return mapRuleRow(row[0] as StepCareRuleRow);
  },

  async updateRule(auth: AuthContext, ruleId: string, dto: UpdateStepCareRuleDTO): Promise<StepCareRule> {
    await assertPathwaysModuleEnabled(auth.clinicId);
    const existing = (await dbAdmin('clinic_step_care_rules')
      .where({ clinic_id: auth.clinicId, id: ruleId })
      .first(CLINIC_STEP_CARE_RULES_COLUMNS as unknown as string[])) as StepCareRuleRow | undefined;
    if (!existing) throw new AppError('Step-care rule not found', 404, 'NOT_FOUND');

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch['name'] = dto.name.trim();
    if (dto.description !== undefined) patch['description'] = dto.description?.trim() || null;
    if (dto.pathwayType !== undefined) patch['pathway_type'] = dto.pathwayType.trim().toLowerCase();
    if (dto.interventionTemplateKey !== undefined) patch['intervention_template_key'] = dto.interventionTemplateKey;
    if (dto.autoAssignEnabled !== undefined) patch['auto_assign_enabled'] = dto.autoAssignEnabled;
    if (dto.autoEscalateEnabled !== undefined) patch['auto_escalate_enabled'] = dto.autoEscalateEnabled;
    if (dto.escalationPriority !== undefined) patch['escalation_priority'] = dto.escalationPriority;
    if (dto.assignmentScope !== undefined) patch['assignment_scope'] = dto.assignmentScope;
    if (dto.isActive !== undefined) patch['is_active'] = dto.isActive;
    if (dto.expectedOutcomeText !== undefined) patch['expected_outcome_text'] = dto.expectedOutcomeText?.trim() || null;
    if (dto.conditions !== undefined) patch['conditions'] = JSON.stringify(toSqlConditions(dto.conditions));
    patch['updated_at'] = new Date();

    const updated = await updateWithOptimisticLock<StepCareRuleRow>({
      table: 'clinic_step_care_rules',
      where: { clinic_id: auth.clinicId, id: ruleId },
      expectedLockVersion: dto.expectedLockVersion,
      patch,
      returning: CLINIC_STEP_CARE_RULES_COLUMNS as unknown as string[],
    });

    return mapRuleRow(updated);
  },

  async runAutomationTick(auth: AuthContext, _now: Date): Promise<StepCareAutomationTickResult> {
    void auth;
    const rules = (await dbAdmin('clinic_step_care_rules')
      .where({ is_active: true })
      .orderBy('created_at', 'asc')
      .select(CLINIC_STEP_CARE_RULES_COLUMNS as unknown as string[])) as unknown as StepCareRuleRow[];

    let patientsMatched = 0;
    let assignmentsCreated = 0;
    let escalationsCreated = 0;
    const moduleEnabledCache = new Map<string, boolean>();

    for (const row of rules) {
      const rule = mapRuleRow(row);
      let moduleEnabled = moduleEnabledCache.get(rule.clinicId);
      if (moduleEnabled === undefined) {
        const moduleRow = await dbAdmin('clinic_modules')
          .where({ clinic_id: rule.clinicId, module_key: MODULE_KEYS.PATHWAYS })
          .first('is_enabled');
        moduleEnabled = !(moduleRow && moduleRow['is_enabled'] === false);
        moduleEnabledCache.set(rule.clinicId, moduleEnabled);
      }
      if (!moduleEnabled) continue;

      const actorStaffId = await resolveClinicAutomationActor(rule.clinicId);
      if (!actorStaffId) {
        logger.warn(
          { clinicId: rule.clinicId, ruleId: rule.id },
          'step-care automation skipped: no clinic automation actor available',
        );
        continue;
      }
      const actor: AuthContext = {
        clinicId: rule.clinicId,
        staffId: actorStaffId,
        role: 'admin',
        permissions: [],
      };

      await withTenantContext(rule.clinicId, async () => {
        const candidates = await fetchPathwayCandidates(rule.clinicId, rule.pathwayType);
        for (const pathway of candidates) {
          const snapshot = await computeSignalSnapshot(
            rule.clinicId,
            pathway.patient_id,
            rule.conditions.minimumObservationDays ?? 7,
          );
          const evaluation = evaluateRuleMatch(rule.conditions, snapshot);
          if (!evaluation.matched) continue;
          patientsMatched += 1;

          if (rule.autoAssignEnabled) {
            try {
              if (await maybeAssignInterventionFromRule(actor, rule, pathway, evaluation.reasons)) {
                assignmentsCreated += 1;
              }
            } catch (err) {
              logger.warn(
                {
                  err,
                  clinicId: rule.clinicId,
                  ruleId: rule.id,
                  pathwayId: pathway.id,
                  patientId: pathway.patient_id,
                },
                'step-care auto-assignment failed; continuing',
              );
            }
          }

          if (rule.autoEscalateEnabled) {
            try {
              if (await maybeEscalateFromRule(actor, rule, pathway, evaluation.reasons)) {
                escalationsCreated += 1;
              }
            } catch (err) {
              logger.warn(
                {
                  err,
                  clinicId: rule.clinicId,
                  ruleId: rule.id,
                  pathwayId: pathway.id,
                  patientId: pathway.patient_id,
                },
                'step-care escalation failed; continuing',
              );
            }
          }
        }
      }, actorStaffId);
    }

    return {
      rulesScanned: rules.length,
      patientsMatched,
      assignmentsCreated,
      escalationsCreated,
    };
  },

  async getResearchLaneSummary(auth: AuthContext, periodDays: number): Promise<PathwayResearchLaneSummary> {
    const clinicId = auth.clinicId;
    const from = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
    const pathways = await pathwayRepository.listForClinic(clinicId);
    const activePathways = pathways.filter((row) => row.status === 'active');

    let assignedInterventionPacks = 0;
    let completedInterventionPacks = 0;
    let thoughtDiaryEntries = 0;
    let sleepJourneyCheckIns = 0;
    const templateStats = new Map<string, { assigned: number; completed: number }>();

    for (const row of pathways) {
      const milestones = parseJsonObject(row.milestones);
      const packs = Array.isArray(milestones['assignedPacks']) ? milestones['assignedPacks'] as Array<Record<string, unknown>> : [];
      const thoughtEntries = Array.isArray(milestones['thoughtDiaryEntries']) ? milestones['thoughtDiaryEntries'] : [];
      const sleepEntries = Array.isArray(milestones['sleepJourneyCheckIns']) ? milestones['sleepJourneyCheckIns'] : [];

      for (const pack of packs) {
        const assignedAt = parseIsoDate(pack['assignedAt']);
        if (!assignedAt || assignedAt < from) continue;
        assignedInterventionPacks += 1;
        const templateKey = String(pack['templateKey'] ?? 'unknown');
        const status = String(pack['status'] ?? 'active');
        const current = templateStats.get(templateKey) ?? { assigned: 0, completed: 0 };
        current.assigned += 1;
        if (status === 'completed') {
          completedInterventionPacks += 1;
          current.completed += 1;
        }
        templateStats.set(templateKey, current);
      }
      thoughtDiaryEntries += thoughtEntries.filter((entry) => {
        const row = entry as Record<string, unknown>;
        const occurredAt = parseIsoDate(row['occurredAt']) ?? parseIsoDate(row['createdAt']);
        return occurredAt ? occurredAt >= from : false;
      }).length;
      sleepJourneyCheckIns += sleepEntries.filter((entry) => {
        const createdAt = parseIsoDate((entry as Record<string, unknown>)['createdAt']);
        return createdAt ? createdAt >= from : false;
      }).length;
    }

    const stepCareRulesActive = await dbAdmin('clinic_step_care_rules')
      .where({ clinic_id: clinicId, is_active: true })
      .count('* as cnt')
      .first();
    const stepCareAutoAssignments = await dbAdmin('step_care_rule_events')
      .where({ clinic_id: clinicId, event_type: 'auto_assigned_pack' })
      .where('created_at', '>=', from)
      .count('* as cnt')
      .first();
    const stepCareEscalations = await dbAdmin('step_care_rule_events')
      .where({ clinic_id: clinicId, event_type: 'auto_escalated_task' })
      .where('created_at', '>=', from)
      .count('* as cnt')
      .first();

    const phenotypedPatients = await dbAdmin('patient_digital_phenotypes')
      .where({ clinic_id: clinicId })
      .where('created_at', '>=', from)
      .countDistinct('patient_id as cnt')
      .first();
    const openEpisodePatients = await dbAdmin('episodes')
      .where({ clinic_id: clinicId, status: 'open' })
      .whereNull('deleted_at')
      .countDistinct('patient_id as cnt')
      .first();

    const outcomeRows = await dbAdmin('outcome_measures')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .whereNotNull('total_score')
      .whereRaw("LOWER(COALESCE(template_name, measure_type, '')) IN (?, ?, ?, ?)", [
        'phq-9',
        'phq9',
        'gad-7',
        'gad7',
      ])
      .where('created_at', '>=', from)
      .orderBy('created_at', 'asc')
      .select('patient_id', 'template_name', 'measure_type', 'total_score', 'created_at');

    const phq9DeltaValues: number[] = [];
    const gad7DeltaValues: number[] = [];
    const byPatientAndMeasure = new Map<string, number[]>();
    for (const row of outcomeRows) {
      const measure = String(row['template_name'] ?? row['measure_type'] ?? '').toLowerCase();
      const score = asNullableNumber(row['total_score']);
      if (score == null) continue;
      let key: string | null = null;
      if (measure.includes('phq-9') || measure.includes('phq9')) key = `phq9:${row['patient_id']}`;
      if (measure.includes('gad-7') || measure.includes('gad7')) key = `gad7:${row['patient_id']}`;
      if (!key) continue;
      const existing = byPatientAndMeasure.get(key) ?? [];
      existing.push(score);
      byPatientAndMeasure.set(key, existing);
    }
    for (const [key, values] of byPatientAndMeasure.entries()) {
      if (values.length < 2) continue;
      const delta = values[values.length - 1] - values[0];
      if (key.startsWith('phq9:')) phq9DeltaValues.push(delta);
      if (key.startsWith('gad7:')) gad7DeltaValues.push(delta);
    }

    const avg = (values: number[]): number | null =>
      values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

    const completionRate = assignedInterventionPacks > 0
      ? (completedInterventionPacks / assignedInterventionPacks) * 100
      : 0;

    const phenotypeCoverage = Number(openEpisodePatients?.['cnt'] ?? 0) > 0
      ? (Number(phenotypedPatients?.['cnt'] ?? 0) / Number(openEpisodePatients?.['cnt'] ?? 0)) * 100
      : 0;

    return {
      clinicId,
      periodDays,
      activePathways: activePathways.length,
      assignedInterventionPacks,
      interventionCompletionRatePct: Number(completionRate.toFixed(2)),
      thoughtDiaryEntries,
      sleepJourneyCheckIns,
      stepCareRulesActive: Number(stepCareRulesActive?.['cnt'] ?? 0),
      stepCareAutoAssignments: Number(stepCareAutoAssignments?.['cnt'] ?? 0),
      stepCareEscalations: Number(stepCareEscalations?.['cnt'] ?? 0),
      digitalPhenotypingCoveragePct: Number(phenotypeCoverage.toFixed(2)),
      outcomeDelta: {
        phq9AverageDelta: avg(phq9DeltaValues),
        gad7AverageDelta: avg(gad7DeltaValues),
        cohortSize: Math.max(phq9DeltaValues.length, gad7DeltaValues.length),
      },
      templateEffectiveness: Array.from(templateStats.entries())
        .map(([templateKey, stats]) => ({
          templateKey: templateKey as PathwayInterventionTemplateKey,
          assignedCount: stats.assigned,
          completedCount: stats.completed,
          completionRatePct: stats.assigned > 0 ? Number(((stats.completed / stats.assigned) * 100).toFixed(2)) : 0,
        }))
        .sort((a, b) => b.assignedCount - a.assignedCount),
    };
  },
};
