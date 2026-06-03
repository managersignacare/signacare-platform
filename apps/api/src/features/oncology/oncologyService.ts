import type {
  AuthContext,
  CreateChemoCycleDto,
  CreateEcogDto,
  CreatePrimaryCancerConditionDto,
  CreateTreatmentPlanDto,
  CreateTnmStageGroupDto,
  CreateTumourBoardDecisionDto,
} from '@signacare/shared';
import { AppError } from '../../shared/errors';
import { requirePatientRelationship, requirePermission } from '../../shared/authGuards';
import { db } from '../../db/db';
import {
  chemoCycleRepo,
  ecogRepo,
  primaryCancerConditionRepo,
  treatmentPlanRepo,
  tnmStageGroupRepo,
  tumourBoardRepo,
} from './oncologyRepository';

async function assertPatientIsAccessible(
  auth: AuthContext,
  patientId: string,
): Promise<void> {
  requirePermission(auth, 'patient:read');
  await requirePatientRelationship(auth, patientId);
}

async function assertPatientIsWritable(
  auth: AuthContext,
  patientId: string,
): Promise<void> {
  requirePermission(auth, 'patient:update');
  await requirePatientRelationship(auth, patientId);
}

async function getConditionForClinicOrThrow(
  clinicId: string,
  conditionId: string,
) {
  const condition = await primaryCancerConditionRepo.findById(clinicId, conditionId);
  if (!condition) throw new AppError('Cancer condition not found', 404, 'NOT_FOUND');
  return condition;
}

async function getTreatmentPlanForClinicOrThrow(
  clinicId: string,
  planId: string,
) {
  const plan = await treatmentPlanRepo.findById(clinicId, planId);
  if (!plan) throw new AppError('Treatment plan not found', 404, 'NOT_FOUND');
  return plan;
}

async function assertEpisodeBelongsToPatient(
  auth: AuthContext,
  episodeId: string,
  patientId: string,
): Promise<void> {
  const episode = await db('episodes')
    .where({
      id: episodeId,
      clinic_id: auth.clinicId,
      patient_id: patientId,
    })
    .whereNull('deleted_at')
    .first();
  if (!episode) throw new AppError('Episode not found', 404, 'NOT_FOUND');
}

export const oncologyService = {
  async listConditionsForPatient(auth: AuthContext, patientId: string) {
    await assertPatientIsAccessible(auth, patientId);
    return primaryCancerConditionRepo.listForPatient(auth.clinicId, patientId);
  },

  async createCondition(auth: AuthContext, dto: CreatePrimaryCancerConditionDto) {
    await assertPatientIsWritable(auth, dto.patientId);
    if (dto.episodeId) {
      await assertEpisodeBelongsToPatient(auth, dto.episodeId, dto.patientId);
    }
    return primaryCancerConditionRepo.create(auth.clinicId, auth.staffId, dto);
  },

  async listTnmStageGroups(auth: AuthContext, conditionId: string) {
    const condition = await getConditionForClinicOrThrow(auth.clinicId, conditionId);
    await assertPatientIsAccessible(auth, condition.patient_id);
    return tnmStageGroupRepo.listForCondition(auth.clinicId, conditionId);
  },

  async createTnmStageGroup(auth: AuthContext, dto: CreateTnmStageGroupDto) {
    const condition = await getConditionForClinicOrThrow(auth.clinicId, dto.conditionId);
    await assertPatientIsWritable(auth, condition.patient_id);
    return tnmStageGroupRepo.create(auth.clinicId, auth.staffId, dto);
  },

  async listEcog(auth: AuthContext, patientId: string) {
    await assertPatientIsAccessible(auth, patientId);
    return ecogRepo.listForPatient(auth.clinicId, patientId);
  },

  async createEcog(auth: AuthContext, dto: CreateEcogDto) {
    await assertPatientIsWritable(auth, dto.patientId);
    return ecogRepo.create(auth.clinicId, auth.staffId, dto);
  },

  async listTreatmentPlans(auth: AuthContext, conditionId: string) {
    const condition = await getConditionForClinicOrThrow(auth.clinicId, conditionId);
    await assertPatientIsAccessible(auth, condition.patient_id);
    return treatmentPlanRepo.listForCondition(auth.clinicId, conditionId);
  },

  async createTreatmentPlan(auth: AuthContext, dto: CreateTreatmentPlanDto) {
    const condition = await getConditionForClinicOrThrow(auth.clinicId, dto.conditionId);
    await assertPatientIsWritable(auth, condition.patient_id);
    return treatmentPlanRepo.create(auth.clinicId, auth.staffId, dto);
  },

  async listChemoCycles(auth: AuthContext, planId: string) {
    const plan = await getTreatmentPlanForClinicOrThrow(auth.clinicId, planId);
    const condition = await getConditionForClinicOrThrow(auth.clinicId, plan.condition_id);
    await assertPatientIsAccessible(auth, condition.patient_id);
    return chemoCycleRepo.listForPlan(auth.clinicId, planId);
  },

  async createChemoCycle(auth: AuthContext, dto: CreateChemoCycleDto) {
    const plan = await getTreatmentPlanForClinicOrThrow(auth.clinicId, dto.planId);
    const condition = await getConditionForClinicOrThrow(auth.clinicId, plan.condition_id);
    await assertPatientIsWritable(auth, condition.patient_id);
    return chemoCycleRepo.create(auth.clinicId, auth.staffId, dto);
  },

  async listTumourBoardDecisions(auth: AuthContext, conditionId: string) {
    const condition = await getConditionForClinicOrThrow(auth.clinicId, conditionId);
    await assertPatientIsAccessible(auth, condition.patient_id);
    return tumourBoardRepo.listForCondition(auth.clinicId, conditionId);
  },

  async createTumourBoardDecision(auth: AuthContext, dto: CreateTumourBoardDecisionDto) {
    const condition = await getConditionForClinicOrThrow(auth.clinicId, dto.conditionId);
    await assertPatientIsWritable(auth, condition.patient_id);
    return tumourBoardRepo.create(auth.clinicId, auth.staffId, dto);
  },
};
