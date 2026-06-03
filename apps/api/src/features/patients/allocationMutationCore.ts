import type { Knex } from 'knex'
import { AppError } from '../../shared/errors'
import { OPEN_CASELOAD_EPISODE_STATUSES } from '../dashboard/caseloadAssignmentSql'
// @jsonb-extraction-exempt: this module performs internal clinic-scope existence checks only.
// It does not map staff rows to API responses and never returns JSONB payload fields.

function scopeAssignmentsToClinic(
  trx: Knex.Transaction,
  clinicId: string,
  query: Knex.QueryBuilder,
): void {
  query.whereExists(function scopedToClinic() {
    this.select(trx.raw('1'))
      .from('patients as p')
      .whereRaw('p.id = patient_team_assignments.patient_id')
      .andWhere('p.clinic_id', clinicId)
      .whereNull('p.deleted_at')
  })
}

function applyPatientFilter(
  query: Knex.QueryBuilder,
  patientIdColumn: string,
  patientIds: readonly string[] | undefined,
): void {
  if (patientIds && patientIds.length > 0) {
    query.whereIn(patientIdColumn, patientIds as string[])
  }
}

export async function ensureStaffBelongsToClinic(args: {
  trx: Knex.Transaction
  clinicId: string
  staffId: string
  label: string
}): Promise<void> {
  const row = await args.trx('staff')
    .where({ id: args.staffId, clinic_id: args.clinicId })
    .whereNull('deleted_at')
    .first('id')
  if (!row) {
    throw new AppError(`${args.label} does not belong to this clinic`, 400, 'CLINIC_SCOPE_VIOLATION')
  }
}

export async function ensureTeamBelongsToClinic(args: {
  trx: Knex.Transaction
  clinicId: string
  teamId: string
  label: string
}): Promise<void> {
  const row = await args.trx('org_units')
    .where({ id: args.teamId, clinic_id: args.clinicId })
    .first('id')
  if (!row) {
    throw new AppError(`${args.label} does not belong to this clinic`, 400, 'CLINIC_SCOPE_VIOLATION')
  }
}

export async function transferClinicianOwnership(args: {
  trx: Knex.Transaction
  clinicId: string
  fromClinicianId: string
  toClinicianId: string
  patientIds?: readonly string[]
  toTeamId?: string | null
  now?: Date
}): Promise<{ updatedEpisodes: number; updatedAssignments: number }> {
  const now = args.now ?? new Date()
  const primaryEpisodePatch: Record<string, unknown> = {
    primary_clinician_id: args.toClinicianId,
    updated_at: now,
  }
  if (typeof args.toTeamId === 'string' && args.toTeamId.length > 0) {
    primaryEpisodePatch.team_id = args.toTeamId
  }

  const primaryEpisodeQuery = args.trx('episodes')
    .where({
      primary_clinician_id: args.fromClinicianId,
      clinic_id: args.clinicId,
    })
    .whereNull('deleted_at')
    .whereIn('status', [...OPEN_CASELOAD_EPISODE_STATUSES])
  applyPatientFilter(primaryEpisodeQuery, 'episodes.patient_id', args.patientIds)
  const updatedPrimaryEpisodes = await primaryEpisodeQuery.update(primaryEpisodePatch)

  const keyWorkerEpisodePatch: Record<string, unknown> = {
    key_worker_id: args.toClinicianId,
    updated_at: now,
  }
  if (typeof args.toTeamId === 'string' && args.toTeamId.length > 0) {
    keyWorkerEpisodePatch.team_id = args.toTeamId
  }

  const keyWorkerEpisodeQuery = args.trx('episodes')
    .where({
      key_worker_id: args.fromClinicianId,
      clinic_id: args.clinicId,
    })
    .whereNull('deleted_at')
    .whereIn('status', [...OPEN_CASELOAD_EPISODE_STATUSES])
  applyPatientFilter(keyWorkerEpisodeQuery, 'episodes.patient_id', args.patientIds)
  const updatedKeyWorkerEpisodes = await keyWorkerEpisodeQuery.update(keyWorkerEpisodePatch)

  const assignmentPatch: Record<string, unknown> = {
    primary_clinician_id: args.toClinicianId,
    updated_at: now,
  }
  if (typeof args.toTeamId === 'string' && args.toTeamId.length > 0) {
    assignmentPatch.org_unit_id = args.toTeamId
  }

  const assignmentQuery = args.trx('patient_team_assignments')
    .where({
      primary_clinician_id: args.fromClinicianId,
      is_active: true,
    })
  scopeAssignmentsToClinic(args.trx, args.clinicId, assignmentQuery)
  applyPatientFilter(
    assignmentQuery,
    'patient_team_assignments.patient_id',
    args.patientIds,
  )
  const updatedAssignments = await assignmentQuery.update(assignmentPatch)

  return {
    updatedEpisodes: updatedPrimaryEpisodes + updatedKeyWorkerEpisodes,
    updatedAssignments,
  }
}

export async function transferTeamOwnership(args: {
  trx: Knex.Transaction
  clinicId: string
  fromTeamId: string
  toTeamId: string
  patientIds?: readonly string[]
  now?: Date
}): Promise<{ updatedEpisodes: number; updatedAssignments: number }> {
  const now = args.now ?? new Date()
  const episodeQuery = args.trx('episodes')
    .where({
      team_id: args.fromTeamId,
      clinic_id: args.clinicId,
    })
    .whereNull('deleted_at')
    .whereIn('status', [...OPEN_CASELOAD_EPISODE_STATUSES])
  applyPatientFilter(episodeQuery, 'episodes.patient_id', args.patientIds)
  const updatedEpisodes = await episodeQuery.update({
    team_id: args.toTeamId,
    updated_at: now,
  })

  const assignmentQuery = args.trx('patient_team_assignments')
    .where({
      org_unit_id: args.fromTeamId,
      is_active: true,
    })
  scopeAssignmentsToClinic(args.trx, args.clinicId, assignmentQuery)
  applyPatientFilter(
    assignmentQuery,
    'patient_team_assignments.patient_id',
    args.patientIds,
  )
  const updatedAssignments = await assignmentQuery.update({
    org_unit_id: args.toTeamId,
    updated_at: now,
  })

  return { updatedEpisodes, updatedAssignments }
}

async function resolveTargetTeamForPatient(args: {
  trx: Knex.Transaction
  clinicId: string
  patientId: string
  explicitTeamId?: string | null
}): Promise<string> {
  if (typeof args.explicitTeamId === 'string' && args.explicitTeamId.length > 0) {
    await ensureTeamBelongsToClinic({
      trx: args.trx,
      clinicId: args.clinicId,
      teamId: args.explicitTeamId,
      label: 'Destination team',
    })
    return args.explicitTeamId
  }

  const activeAssignment = await args.trx('patient_team_assignments')
    .where({ patient_id: args.patientId, is_active: true })
    .whereExists(function scopedToClinic() {
      this.select(args.trx.raw('1'))
        .from('patients as p')
        .whereRaw('p.id = patient_team_assignments.patient_id')
        .andWhere('p.clinic_id', args.clinicId)
        .whereNull('p.deleted_at')
    })
    .orderBy('updated_at', 'desc')
    .first<{ org_unit_id: string | null }>('org_unit_id')

  if (typeof activeAssignment?.org_unit_id === 'string' && activeAssignment.org_unit_id.length > 0) {
    return activeAssignment.org_unit_id
  }

  const openEpisode = await args.trx('episodes')
    .where({ clinic_id: args.clinicId, patient_id: args.patientId })
    .whereNull('deleted_at')
    .whereIn('status', [...OPEN_CASELOAD_EPISODE_STATUSES])
    .orderBy('updated_at', 'desc')
    .first<{ team_id: string | null }>('team_id')

  if (typeof openEpisode?.team_id === 'string' && openEpisode.team_id.length > 0) {
    return openEpisode.team_id
  }

  throw new AppError(
    'Destination team is required when the patient has no active team context',
    400,
    'ALLOCATION_TARGET_TEAM_REQUIRED',
  )
}

export async function applyPatientAllocationMutation(args: {
  trx: Knex.Transaction
  clinicId: string
  patientId: string
  toClinicianId?: string | null
  toTeamId?: string | null
  fromClinicianId?: string | null
  setPrimaryClinician: boolean
  now?: Date
}): Promise<{
  updatedEpisodes: number
  updatedAssignments: number
  targetTeamId: string | null
}> {
  const now = args.now ?? new Date()

  const patientRow = await args.trx('patients')
    .where({ id: args.patientId, clinic_id: args.clinicId })
    .whereNull('deleted_at')
    .first('id')
  if (!patientRow) {
    throw new AppError('Patient not found in clinic', 404, 'NOT_FOUND')
  }

  if (args.setPrimaryClinician) {
    if (typeof args.toClinicianId !== 'string' || args.toClinicianId.length === 0) {
      throw new AppError(
        'Destination clinician is required for this allocation',
        400,
        'INVALID_REASSIGNMENT',
      )
    }
    await ensureStaffBelongsToClinic({
      trx: args.trx,
      clinicId: args.clinicId,
      staffId: args.toClinicianId,
      label: 'Destination clinician',
    })
  }

  if (typeof args.fromClinicianId === 'string' && args.fromClinicianId.length > 0) {
    if (typeof args.toClinicianId !== 'string' || args.toClinicianId.length === 0) {
      throw new AppError(
        'Destination clinician is required for source-based transfer',
        400,
        'INVALID_REASSIGNMENT',
      )
    }
    await ensureStaffBelongsToClinic({
      trx: args.trx,
      clinicId: args.clinicId,
      staffId: args.fromClinicianId,
      label: 'Source clinician',
    })
    if (typeof args.toTeamId === 'string' && args.toTeamId.length > 0) {
      await ensureTeamBelongsToClinic({
        trx: args.trx,
        clinicId: args.clinicId,
        teamId: args.toTeamId,
        label: 'Destination team',
      })
    }
    const { updatedEpisodes, updatedAssignments } = await transferClinicianOwnership({
      trx: args.trx,
      clinicId: args.clinicId,
      fromClinicianId: args.fromClinicianId,
      toClinicianId: args.toClinicianId,
      toTeamId: args.toTeamId ?? undefined,
      patientIds: [args.patientId],
      now,
    })
    return {
      updatedEpisodes,
      updatedAssignments,
      targetTeamId: args.toTeamId ?? null,
    }
  }

  const targetTeamId = await resolveTargetTeamForPatient({
    trx: args.trx,
    clinicId: args.clinicId,
    patientId: args.patientId,
    explicitTeamId: args.toTeamId,
  })

  const episodePatch: Record<string, unknown> = {
    team_id: targetTeamId,
    updated_at: now,
  }
  if (args.setPrimaryClinician) {
    episodePatch.primary_clinician_id = args.toClinicianId ?? null
  }

  const openEpisodeQuery = args.trx('episodes')
    .where({
      clinic_id: args.clinicId,
      patient_id: args.patientId,
    })
    .whereNull('deleted_at')
    .whereIn('status', [...OPEN_CASELOAD_EPISODE_STATUSES])
  const updatedEpisodes = await openEpisodeQuery.update(episodePatch)

  const deactivateQuery = args.trx('patient_team_assignments')
    .where({
      patient_id: args.patientId,
      is_active: true,
    })
  scopeAssignmentsToClinic(args.trx, args.clinicId, deactivateQuery)
  const deactivatedAssignments = await deactivateQuery.update({
    is_active: false,
    updated_at: now,
  })

  await args.trx('patient_team_assignments')
    .insert({
      patient_id: args.patientId,
      org_unit_id: targetTeamId,
      primary_clinician_id: args.setPrimaryClinician ? (args.toClinicianId ?? null) : null,
      is_active: true,
      created_at: now,
      updated_at: now,
    })
    .onConflict(['patient_id', 'org_unit_id'])
    .merge({
      primary_clinician_id: args.setPrimaryClinician ? (args.toClinicianId ?? null) : null,
      is_active: true,
      updated_at: now,
    })

  return {
    updatedEpisodes,
    updatedAssignments: deactivatedAssignments + 1,
    targetTeamId,
  }
}
