import type { Knex } from 'knex'
import { db, dbAdmin } from '../../db/db'
import { AppError } from '../../shared/errors'
import type { TaskCreateDTO, TaskUpdateDTO } from '@signacare/shared'
import * as taskRepo from './taskRepository'

type TaskWriteConnectionMode = 'app_user' | 'db_admin'

export type InternalTaskCreateInput = TaskCreateDTO & {
  taskType?: string
  status?: string
}

function resolveConn(mode: TaskWriteConnectionMode): Knex {
  return mode === 'db_admin' ? dbAdmin : db
}

async function ensureStaffInClinic(args: {
  conn: Knex
  clinicId: string
  staffId: string
  label: string
}): Promise<void> {
  const row = await args.conn('staff')
    .where({ id: args.staffId, clinic_id: args.clinicId })
    .whereNull('deleted_at')
    .first('id')
  if (!row) {
    throw new AppError(`${args.label} does not belong to this clinic`, 400, 'CLINIC_SCOPE_VIOLATION')
  }
}

async function ensurePatientInClinic(args: {
  conn: Knex
  clinicId: string
  patientId: string
}): Promise<void> {
  const row = await args.conn('patients')
    .where({ id: args.patientId, clinic_id: args.clinicId })
    .whereNull('deleted_at')
    .first('id')
  if (!row) {
    throw new AppError('Task patient does not belong to this clinic', 400, 'CLINIC_SCOPE_VIOLATION')
  }
}

async function ensureEpisodeInClinic(args: {
  conn: Knex
  clinicId: string
  episodeId: string
  patientId?: string
}): Promise<void> {
  const row = await args.conn('episodes')
    .where({ id: args.episodeId, clinic_id: args.clinicId })
    .whereNull('deleted_at')
    .first<{ patient_id: string }>('patient_id')
  if (!row) {
    throw new AppError('Task episode does not belong to this clinic', 400, 'CLINIC_SCOPE_VIOLATION')
  }
  if (args.patientId && row.patient_id !== args.patientId) {
    throw new AppError(
      'Task episode and patient must belong to the same clinical context',
      400,
      'TASK_PATIENT_EPISODE_MISMATCH',
    )
  }
}

export async function executeTaskCreateMutation(args: {
  clinicId: string
  createdById: string
  dto: InternalTaskCreateInput
  mode: TaskWriteConnectionMode
}): Promise<Record<string, unknown>> {
  const conn = resolveConn(args.mode)

  await ensureStaffInClinic({
    conn,
    clinicId: args.clinicId,
    staffId: args.createdById,
    label: 'Task creator',
  })
  if (args.dto.assignedToId) {
    await ensureStaffInClinic({
      conn,
      clinicId: args.clinicId,
      staffId: args.dto.assignedToId,
      label: 'Task assignee',
    })
  }
  if (args.dto.patientId) {
    await ensurePatientInClinic({
      conn,
      clinicId: args.clinicId,
      patientId: args.dto.patientId,
    })
  }
  if (args.dto.episodeId) {
    await ensureEpisodeInClinic({
      conn,
      clinicId: args.clinicId,
      episodeId: args.dto.episodeId,
      patientId: args.dto.patientId,
    })
  }

  return args.mode === 'db_admin'
    ? taskRepo.createAdmin(args.clinicId, args.createdById, args.dto)
    : taskRepo.create(args.clinicId, args.createdById, args.dto)
}

export async function executeTaskUpdateMutation(args: {
  clinicId: string
  actorStaffId: string
  taskId: string
  dto: TaskUpdateDTO
  expectedLockVersion: number
}): Promise<Record<string, unknown> | undefined> {
  const conn = db
  await ensureStaffInClinic({
    conn,
    clinicId: args.clinicId,
    staffId: args.actorStaffId,
    label: 'Task actor',
  })
  if (args.dto.assignedToId) {
    await ensureStaffInClinic({
      conn,
      clinicId: args.clinicId,
      staffId: args.dto.assignedToId,
      label: 'Task assignee',
    })
  }
  return taskRepo.update(
    args.clinicId,
    args.taskId,
    args.dto,
    args.expectedLockVersion,
    args.actorStaffId,
  )
}

export async function executeTaskDeleteMutation(args: {
  clinicId: string
  taskId: string
}): Promise<void> {
  await taskRepo.hardDelete(args.clinicId, args.taskId)
}
