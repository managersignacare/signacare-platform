import type { Knex } from 'knex'
import { AppError } from '../../shared/errors'
import { OPEN_CASELOAD_EPISODE_STATUSES } from '../dashboard/caseloadAssignmentSql'
import {
  applyPatientAllocationMutation,
  ensureStaffBelongsToClinic,
  ensureTeamBelongsToClinic,
} from './allocationMutationCore'

// @jsonb-extraction-exempt: execution-command module performs clinic-scope
// checks/select('id') on staff/org_units/patients and never maps table rows to
// API payloads.

type BaseInstruction = {
  patientId: string
  toTeamId?: string | null
}

export type PlannedTransitionAllocationInstruction = BaseInstruction & {
  mode: 'planned_transition'
  sourceStaffId: string
  toStaffId: string
  scopedEpisodeIds?: string[]
}

export type ReallocationAllocationInstruction = BaseInstruction & {
  mode: 'reallocation'
  toStaffId?: string | null
}

export type AllocationExecutionInstruction =
  | PlannedTransitionAllocationInstruction
  | ReallocationAllocationInstruction

export async function validateAllocationExecutionInstructions(args: {
  trx: Knex.Transaction
  clinicId: string
  instructions: AllocationExecutionInstruction[]
}): Promise<void> {
  const { trx, clinicId, instructions } = args
  if (instructions.length === 0) return

  const staffIds = [
    ...new Set(
      instructions
        .map((item) => item.toStaffId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ]
  const teamIds = [
    ...new Set(instructions.map((item) => item.toTeamId).filter((id): id is string => typeof id === 'string' && id.length > 0)),
  ]
  const patientIds = [...new Set(instructions.map((item) => item.patientId))]
  const scopedEpisodeIds = [
    ...new Set(
      instructions
        .filter((item): item is PlannedTransitionAllocationInstruction => item.mode === 'planned_transition')
        .flatMap((item) => item.scopedEpisodeIds ?? []),
    ),
  ]

  const staffRows = staffIds.length
    ? await trx('staff')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .whereIn('id', staffIds)
      .select('id')
    : []
  const teamRows = teamIds.length
    ? await trx('org_units')
      .where({ clinic_id: clinicId })
      .whereIn('id', teamIds)
      .select('id')
    : []
  const patientRows = patientIds.length
    ? await trx('patients')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .whereIn('id', patientIds)
      .select('id')
    : []
  const scopedEpisodeRows = scopedEpisodeIds.length
    ? await trx('episodes')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .whereIn('id', scopedEpisodeIds)
      .select('id', 'patient_id')
    : []

  if (staffRows.length !== staffIds.length) {
    throw new AppError(
      'One or more destination clinicians are outside this clinic',
      400,
      'CLINIC_SCOPE_VIOLATION',
    )
  }
  if (teamRows.length !== teamIds.length) {
    throw new AppError(
      'One or more destination teams are outside this clinic',
      400,
      'CLINIC_SCOPE_VIOLATION',
    )
  }
  if (patientRows.length !== patientIds.length) {
    throw new AppError(
      'One or more allocation patients are outside this clinic',
      400,
      'CLINIC_SCOPE_VIOLATION',
    )
  }
  if (scopedEpisodeRows.length !== scopedEpisodeIds.length) {
    throw new AppError(
      'One or more scoped episodes are outside this clinic',
      400,
      'CLINIC_SCOPE_VIOLATION',
    )
  }

  const episodeById = new Map(scopedEpisodeRows.map((row) => [row.id, row]))
  for (const instruction of instructions) {
    if (instruction.mode === 'planned_transition' && instruction.toStaffId.length === 0) {
      throw new AppError(
        'Destination clinician is required for planned transitions',
        400,
        'INVALID_REASSIGNMENT',
      )
    }
    if (instruction.mode !== 'planned_transition' || !instruction.scopedEpisodeIds?.length) continue
    for (const episodeId of instruction.scopedEpisodeIds) {
      const episode = episodeById.get(episodeId)
      if (!episode || episode.patient_id !== instruction.patientId) {
        throw new AppError(
          'Transition assignment episode must belong to the same patient',
          400,
          'TRANSITION_EPISODE_PATIENT_MISMATCH',
        )
      }
    }
  }
}

export async function executeAllocationInstructions(args: {
  trx: Knex.Transaction
  clinicId: string
  now: Date
  instructions: AllocationExecutionInstruction[]
}): Promise<Map<string, { updatedEpisodes: number; updatedAssignments: number }>> {
  const { trx, clinicId, now, instructions } = args
  const outcomeByPatient = new Map<string, { updatedEpisodes: number; updatedAssignments: number }>()

  for (const instruction of instructions) {
    const destinationClinicianId: string | null =
      typeof instruction.toStaffId === 'string' && instruction.toStaffId.length > 0
        ? instruction.toStaffId
        : null

    if (instruction.mode === 'planned_transition') {
      await ensureStaffBelongsToClinic({
        trx,
        clinicId,
        staffId: instruction.sourceStaffId,
        label: 'Source clinician',
      })
    }
    if (instruction.toTeamId) {
      await ensureTeamBelongsToClinic({
        trx,
        clinicId,
        teamId: instruction.toTeamId,
        label: 'Destination team',
      })
    }
    if (destinationClinicianId) {
      await ensureStaffBelongsToClinic({
        trx,
        clinicId,
        staffId: destinationClinicianId,
        label: 'Destination clinician',
      })
    }

    const { updatedEpisodes, updatedAssignments } = await applyPatientAllocationMutation({
      trx,
      clinicId,
      patientId: instruction.patientId,
      fromClinicianId: instruction.mode === 'planned_transition' ? instruction.sourceStaffId : undefined,
      toClinicianId: destinationClinicianId,
      toTeamId: instruction.toTeamId ?? null,
      setPrimaryClinician: destinationClinicianId !== null,
      now,
    })

    if (instruction.mode === 'planned_transition' && destinationClinicianId && instruction.scopedEpisodeIds?.length) {
      const scopedEpisodePatch: Record<string, unknown> = { updated_at: now }
      scopedEpisodePatch.key_worker_id = destinationClinicianId
      if (instruction.toTeamId && instruction.toTeamId.length > 0) {
        scopedEpisodePatch.team_id = instruction.toTeamId
      }
      await trx('episodes')
        .where({ clinic_id: clinicId, key_worker_id: instruction.sourceStaffId })
        .whereIn('status', [...OPEN_CASELOAD_EPISODE_STATUSES])
        .whereNull('deleted_at')
        .whereIn('id', instruction.scopedEpisodeIds)
        .update(scopedEpisodePatch)
    }

    outcomeByPatient.set(instruction.patientId, {
      updatedEpisodes,
      updatedAssignments,
    })
  }

  return outcomeByPatient
}
