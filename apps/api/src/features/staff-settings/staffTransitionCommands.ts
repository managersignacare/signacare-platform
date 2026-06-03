import { db } from '../../db/db'
import { AppError } from '../../shared/errors'
import { PLANNED_TRANSITIONS_COLUMNS } from '../../db/types/planned_transitions'
import { OPEN_CASELOAD_EPISODE_STATUSES } from '../dashboard/caseloadAssignmentSql'
import {
  ensureStaffBelongsToClinic,
  ensureTeamBelongsToClinic,
  transferClinicianOwnership,
  transferTeamOwnership,
} from '../patients/allocationMutationCore'
import {
  executeAllocationInstructions,
  validateAllocationExecutionInstructions,
  type PlannedTransitionAllocationInstruction,
} from '../patients/allocationExecutionCommand'
import type {
  BulkReassignDTO,
  CreateTransitionDTO,
  UpdateTransitionDTO,
} from '@signacare/shared'

// @jsonb-extraction-exempt: command-only module; staff queries are scope checks/select('id')
// and no staff row is returned to HTTP response payloads.

export async function runBulkReassign(args: {
  clinicId: string,
  payload: BulkReassignDTO,
}): Promise<number> {
  const { clinicId, payload } = args
  const { type, fromId, toId, fromTeam, toTeam, patientIds } = payload

  return db.transaction(async (trx) => {
    const scopedPatientIds = patientIds?.length
      ? await trx('patients')
        .where({ clinic_id: clinicId })
        .whereNull('deleted_at')
        .whereIn('id', patientIds)
        .pluck<string>('id')
      : null

    if (patientIds?.length && (!scopedPatientIds || scopedPatientIds.length !== patientIds.length)) {
      throw new AppError('One or more selected patients are outside this clinic', 400, 'CLINIC_SCOPE_VIOLATION')
    }

    const clinicPatientIds = scopedPatientIds ?? await trx('patients')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .pluck<string>('id')

    const touchedPatientIds = new Set<string>()

    if (type === 'clinician' && fromId && toId) {
      if (fromId === toId) {
        throw new AppError('Source and destination clinician must be different', 400, 'INVALID_REASSIGNMENT')
      }
      await ensureStaffBelongsToClinic({ trx, clinicId, staffId: fromId, label: 'Source clinician' })
      await ensureStaffBelongsToClinic({ trx, clinicId, staffId: toId, label: 'Destination clinician' })

      const episodeCandidates = await trx('episodes')
        .where({ clinic_id: clinicId })
        .where((builder) => {
          builder
            .where('primary_clinician_id', fromId)
            .orWhere('key_worker_id', fromId)
        })
        .whereIn('status', [...OPEN_CASELOAD_EPISODE_STATUSES])
        .whereNull('deleted_at')
        .whereIn('patient_id', clinicPatientIds)
        .select('patient_id')
      for (const row of episodeCandidates) {
        if (typeof row.patient_id === 'string') touchedPatientIds.add(row.patient_id)
      }

      const assignmentCandidates = await trx('patient_team_assignments')
        .where({ primary_clinician_id: fromId, is_active: true })
        .whereIn('patient_id', clinicPatientIds)
        .select('patient_id')
      for (const row of assignmentCandidates) {
        if (typeof row.patient_id === 'string') touchedPatientIds.add(row.patient_id)
      }

      if (touchedPatientIds.size === 0) return 0
      await transferClinicianOwnership({
        trx,
        clinicId,
        fromClinicianId: fromId,
        toClinicianId: toId,
        patientIds: [...touchedPatientIds],
      })

      return touchedPatientIds.size
    }

    if (type === 'team' && fromTeam && toTeam) {
      if (fromTeam === toTeam) {
        throw new AppError('Source and destination team must be different', 400, 'INVALID_REASSIGNMENT')
      }
      await ensureTeamBelongsToClinic({ trx, clinicId, teamId: fromTeam, label: 'Source team' })
      await ensureTeamBelongsToClinic({ trx, clinicId, teamId: toTeam, label: 'Destination team' })

      const episodeCandidates = await trx('episodes')
        .where({ team_id: fromTeam, clinic_id: clinicId })
        .whereIn('status', [...OPEN_CASELOAD_EPISODE_STATUSES])
        .whereNull('deleted_at')
        .whereIn('patient_id', clinicPatientIds)
        .select('patient_id')
      for (const row of episodeCandidates) {
        if (typeof row.patient_id === 'string') touchedPatientIds.add(row.patient_id)
      }

      const assignmentCandidates = await trx('patient_team_assignments')
        .where({ org_unit_id: fromTeam, is_active: true })
        .whereIn('patient_id', clinicPatientIds)
        .select('patient_id')
      for (const row of assignmentCandidates) {
        if (typeof row.patient_id === 'string') touchedPatientIds.add(row.patient_id)
      }

      if (touchedPatientIds.size === 0) return 0
      await transferTeamOwnership({
        trx,
        clinicId,
        fromTeamId: fromTeam,
        toTeamId: toTeam,
        patientIds: [...touchedPatientIds],
      })

      return touchedPatientIds.size
    }

    throw new AppError('Invalid reassignment parameters', 400, 'INVALID_REASSIGNMENT')
  })
}

export async function listPlannedTransitions(clinicId: string): Promise<Record<string, unknown>[]> {
  const assignmentCountSubquery = db('planned_transition_assignments')
    .select('transition_id')
    .count('* as assignment_count')
    .groupBy('transition_id')
    .as('pta_count')

  const rows = await db('planned_transitions as pt')
    .where({ 'pt.clinic_id': clinicId })
    .whereNull('pt.deleted_at')
    .join('staff as sf', 'sf.id', 'pt.from_staff_id')
    .join('staff as cb', 'cb.id', 'pt.created_by_id')
    .leftJoin('staff as ab', 'ab.id', 'pt.approved_by_id')
    .leftJoin(assignmentCountSubquery, 'pta_count.transition_id', 'pt.id')
    .select(
      'pt.*',
      db.raw("sf.given_name || ' ' || sf.family_name as from_staff_name"),
      db.raw("cb.given_name || ' ' || cb.family_name as created_by_name"),
      db.raw("COALESCE(ab.given_name || ' ' || ab.family_name, null) as approved_by_name"),
      db.raw('COALESCE(pta_count.assignment_count, 0)::int as assignment_count'),
    )
    .orderBy('pt.effective_date', 'asc')
  return rows as Array<Record<string, unknown>>
}

export async function getPlannedTransitionDetail(args: {
  clinicId: string,
  transitionId: string,
}): Promise<{
  transition: Record<string, unknown>,
  assignments: Record<string, unknown>[],
}> {
  const { clinicId, transitionId } = args
  const transition = await db('planned_transitions')
    .where({ id: transitionId, clinic_id: clinicId })
    .whereNull('deleted_at')
    .first()
  if (!transition) {
    throw new AppError('Not found', 404, 'NOT_FOUND')
  }

  const assignments = await db('planned_transition_assignments as a')
    .where({ 'a.transition_id': transitionId })
    .join('patients as p', function joinPatients() {
      this.on('p.id', '=', 'a.patient_id')
        .andOn('p.clinic_id', '=', db.raw('?', [clinicId]))
        .andOnNull('p.deleted_at')
    })
    .join('staff as ts', function joinToStaff() {
      this.on('ts.id', '=', 'a.to_staff_id')
        .andOn('ts.clinic_id', '=', db.raw('?', [clinicId]))
        .andOnNull('ts.deleted_at')
    })
    .leftJoin('episodes as e', function joinEpisode() {
      this.on('e.id', '=', 'a.episode_id')
        .andOn('e.clinic_id', '=', db.raw('?', [clinicId]))
        .andOnNull('e.deleted_at')
    })
    .select(
      'a.*',
      'p.given_name as patient_given_name',
      'p.family_name as patient_family_name',
      'p.emr_number',
      db.raw("ts.given_name || ' ' || ts.family_name as to_staff_name"),
      'e.primary_diagnosis',
      'a.to_team as team',
    )
    .orderBy('p.family_name')

  return {
    transition: transition as Record<string, unknown>,
    assignments: assignments as Array<Record<string, unknown>>,
  }
}

export async function createPlannedTransition(args: {
  clinicId: string,
  userId: string,
  payload: CreateTransitionDTO,
}): Promise<Record<string, unknown>> {
  const { clinicId, userId, payload } = args
  const { fromStaffId, reason, effectiveDate, notes, assignments } = payload

  return db.transaction(async (trx) => {
    await ensureStaffBelongsToClinic({ trx, clinicId, staffId: fromStaffId, label: 'Source clinician' })

    if (assignments?.length) {
      const staffIds = [...new Set(assignments.map((a) => a.toStaffId))]
      const teamIds = [...new Set(assignments.map((a) => a.toTeam).filter((id): id is string => !!id))]
      const patientIds = [...new Set(assignments.map((a) => a.patientId))]
      const episodeIds = [...new Set(assignments.map((a) => a.episodeId).filter((id): id is string => !!id))]

      // Run sequentially inside a single trx connection. Parallel Promise.all
      // queries on one trx can cause overlapping client.query() warnings and
      // non-deterministic test/runtime behavior.
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
      const episodeRows = episodeIds.length
        ? await trx('episodes')
          .where({ clinic_id: clinicId })
          .whereNull('deleted_at')
          .whereIn('id', episodeIds)
          .select('id', 'patient_id')
        : []

      if (staffRows.length !== staffIds.length) throw new AppError('One or more destination clinicians are outside this clinic', 400, 'CLINIC_SCOPE_VIOLATION')
      if (teamRows.length !== teamIds.length) throw new AppError('One or more destination teams are outside this clinic', 400, 'CLINIC_SCOPE_VIOLATION')
      if (patientRows.length !== patientIds.length) throw new AppError('One or more transition patients are outside this clinic', 400, 'CLINIC_SCOPE_VIOLATION')
      if (episodeRows.length !== episodeIds.length) throw new AppError('One or more transition episodes are outside this clinic', 400, 'CLINIC_SCOPE_VIOLATION')

      const episodeById = new Map(episodeRows.map((row) => [row.id, row]))
      for (const assignment of assignments) {
        if (!assignment.episodeId) continue
        const episode = episodeById.get(assignment.episodeId)
        if (!episode || episode.patient_id !== assignment.patientId) {
          throw new AppError('Transition assignment episode must belong to the same patient', 400, 'TRANSITION_EPISODE_PATIENT_MISMATCH')
        }
      }
    }

    const [createdPlan] = await trx('planned_transitions').insert({
      clinic_id: clinicId,
      from_staff_id: fromStaffId,
      reason,
      effective_date: effectiveDate,
      status: 'draft',
      created_by_id: userId,
      notes,
    }).returning(PLANNED_TRANSITIONS_COLUMNS)

    if (assignments?.length) {
      await trx('planned_transition_assignments').insert(
        assignments.map((a) => ({
          transition_id: createdPlan.id,
          patient_id: a.patientId,
          episode_id: a.episodeId || null,
          to_staff_id: a.toStaffId,
          to_team: a.toTeam || null,
          handover_notes: a.handoverNotes || null,
        })),
      )
    }
    return createdPlan as Record<string, unknown>
  })
}

export async function updatePlannedTransition(args: {
  clinicId: string,
  userId: string,
  transitionId: string,
  payload: UpdateTransitionDTO,
}): Promise<void> {
  const { clinicId, userId, transitionId, payload } = args
  const { status, notes, assignments } = payload
  const now = new Date()

  await db.transaction(async (trx) => {
    const existingPlan = await trx('planned_transitions')
      .where({ id: transitionId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .first('id', 'status')
    if (!existingPlan) throw new AppError('Transition not found', 404, 'NOT_FOUND')
    if (existingPlan.status === 'executed') throw new AppError('Executed transitions cannot be modified', 409, 'TRANSITION_ALREADY_EXECUTED')
    if (existingPlan.status === 'cancelled') throw new AppError('Cancelled transitions cannot be modified', 409, 'TRANSITION_CANCELLED')

    const updates: Record<string, unknown> = { updated_at: now }
    if (status) updates.status = status
    if (notes !== undefined) updates.notes = notes
    if (status === 'approved') {
      updates.approved_by_id = userId
      updates.approved_at = now
    }
    await trx('planned_transitions').where({ id: transitionId, clinic_id: clinicId }).update(updates)

    if (!assignments) return
    const staffIds = [...new Set(assignments.map((a) => a.toStaffId))]
    const teamIds = [...new Set(assignments.map((a) => a.toTeam).filter((id): id is string => !!id))]
    const patientIds = [...new Set(assignments.map((a) => a.patientId))]
    const episodeIds = [...new Set(assignments.map((a) => a.episodeId).filter((id): id is string => !!id))]

    // Run sequentially inside trx for deterministic behavior and to avoid
    // overlapping query calls on a single transaction client.
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
    const episodeRows = episodeIds.length
      ? await trx('episodes')
        .where({ clinic_id: clinicId })
        .whereNull('deleted_at')
        .whereIn('id', episodeIds)
        .select('id', 'patient_id')
      : []

    if (staffRows.length !== staffIds.length) throw new AppError('One or more destination clinicians are outside this clinic', 400, 'CLINIC_SCOPE_VIOLATION')
    if (teamRows.length !== teamIds.length) throw new AppError('One or more destination teams are outside this clinic', 400, 'CLINIC_SCOPE_VIOLATION')
    if (patientRows.length !== patientIds.length) throw new AppError('One or more transition patients are outside this clinic', 400, 'CLINIC_SCOPE_VIOLATION')
    if (episodeRows.length !== episodeIds.length) throw new AppError('One or more transition episodes are outside this clinic', 400, 'CLINIC_SCOPE_VIOLATION')

    const episodeById = new Map(episodeRows.map((row) => [row.id, row]))
    for (const assignment of assignments) {
      if (!assignment.episodeId) continue
      const episode = episodeById.get(assignment.episodeId)
      if (!episode || episode.patient_id !== assignment.patientId) {
        throw new AppError('Transition assignment episode must belong to the same patient', 400, 'TRANSITION_EPISODE_PATIENT_MISMATCH')
      }
    }

    await trx('planned_transition_assignments').where({ transition_id: transitionId }).del()
    if (assignments.length) {
      await trx('planned_transition_assignments').insert(
        assignments.map((a) => ({
          transition_id: transitionId,
          patient_id: a.patientId,
          episode_id: a.episodeId || null,
          to_staff_id: a.toStaffId,
          to_team: a.toTeam || null,
          handover_notes: a.handoverNotes || null,
        })),
      )
    }
  })
}

export async function executePlannedTransition(args: {
  clinicId: string,
  transitionId: string,
}): Promise<{ executed: number, total: number }> {
  const { clinicId, transitionId } = args
  return db.transaction(async (trx) => {
    const plan = await trx('planned_transitions')
      .where({ id: transitionId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .first()
    if (!plan) throw new AppError('Transition not found', 404, 'NOT_FOUND')
    if (plan.status === 'executed') throw new AppError('Already executed', 409, 'TRANSITION_ALREADY_EXECUTED')
    if (plan.status === 'cancelled') throw new AppError('Cancelled transitions cannot be executed', 409, 'TRANSITION_CANCELLED')
    await ensureStaffBelongsToClinic({ trx, clinicId, staffId: plan.from_staff_id, label: 'Source clinician' })

    const assignments = await trx('planned_transition_assignments')
      .where({ transition_id: plan.id, status: 'pending' })
    let executed = 0
    const now = new Date()
    const assignmentsByPatient = new Map<string, typeof assignments>()
    for (const assignment of assignments) {
      const bucket = assignmentsByPatient.get(assignment.patient_id)
      if (bucket) bucket.push(assignment)
      else assignmentsByPatient.set(assignment.patient_id, [assignment])
    }

    const instructions: PlannedTransitionAllocationInstruction[] = []
    for (const [patientId, patientAssignments] of assignmentsByPatient.entries()) {
      const first = patientAssignments[0]
      const canonicalStaffId = first.to_staff_id
      const canonicalTeamId = typeof first.to_team === 'string' && first.to_team.length > 0 ? first.to_team : null
      const scopedEpisodeIds = patientAssignments
        .map((assignment) => assignment.episode_id)
        .filter((episodeId): episodeId is string => typeof episodeId === 'string' && episodeId.length > 0)

      for (const assignment of patientAssignments) {
        const teamId = typeof assignment.to_team === 'string' && assignment.to_team.length > 0 ? assignment.to_team : null
        if (assignment.to_staff_id !== canonicalStaffId || teamId !== canonicalTeamId) {
          throw new AppError(
            'Transition contains conflicting targets for the same patient',
            400,
            'TRANSITION_CONFLICTING_TARGETS',
          )
        }
      }
      instructions.push({
        mode: 'planned_transition',
        patientId,
        sourceStaffId: plan.from_staff_id,
        toStaffId: canonicalStaffId,
        toTeamId: canonicalTeamId,
        scopedEpisodeIds,
      })
    }

    await validateAllocationExecutionInstructions({
      trx,
      clinicId,
      instructions,
    })

    const outcomeByPatient = await executeAllocationInstructions({
      trx,
      clinicId,
      now,
      instructions,
    })
    for (const instruction of instructions) {
      const patientId = instruction.patientId
      const outcome = outcomeByPatient.get(patientId)
      const updatedEpisodes = outcome?.updatedEpisodes ?? 0
      const updatedAssignments = outcome?.updatedAssignments ?? 0

      if (updatedEpisodes > 0 || updatedAssignments > 0) {
        const updatedRows = await trx('planned_transition_assignments')
          .where({ transition_id: plan.id, patient_id: patientId, status: 'pending' })
          .update({ status: 'executed', executed_at: now, updated_at: now })
        executed += updatedRows
      }
    }

    await trx('planned_transitions')
      .where({ id: plan.id })
      .update({ status: 'executed', executed_at: now, updated_at: now })
    return { executed, total: assignments.length }
  })
}
