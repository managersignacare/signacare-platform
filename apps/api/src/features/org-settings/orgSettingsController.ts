import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { db } from '../../db/db'
import { HttpError } from '../../shared/errors'
import { orgSettingsService } from './orgSettingsService'

// --- Level Labels ---

const BulkLabelsSchema = z.object({
  labels: z.array(z.object({
    level: z.number().int().min(1).max(10),
    label: z.string().min(1).max(100),
  })).min(1).max(10),
})
const ClinicIdSchema = z.string().uuid()

function resolveClinicScope(req: Request, requestedClinicId: string | undefined): string {
  const sessionClinicId = req.clinicId
  if (!sessionClinicId) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Tenant context missing')
  }
  if (!requestedClinicId) {
    return sessionClinicId
  }
  const parsedClinicId = ClinicIdSchema.safeParse(requestedClinicId)
  if (!parsedClinicId.success) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'clinicId must be a valid UUID')
  }
  const isSuperadmin = req.user?.role === 'superadmin'
  if (!isSuperadmin && parsedClinicId.data !== sessionClinicId) {
    throw new HttpError(403, 'FORBIDDEN', 'Cross-clinic org settings read is superadmin-only')
  }
  return parsedClinicId.data
}

async function applyClinicScopeOverrideIfNeeded(clinicId: string): Promise<void> {
  await db.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId])
}

export async function getLevelLabels(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestedClinicId = req.query.clinicId as string | undefined
    const clinicId = resolveClinicScope(req, requestedClinicId)
    await applyClinicScopeOverrideIfNeeded(clinicId)
    const labels = await orgSettingsService.getLevelLabels(clinicId)
    res.json({ labels })
  } catch (err) { next(err) }
}

export async function bulkSetLevelLabels(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = BulkLabelsSchema.parse(req.body)
    const labels = await orgSettingsService.bulkSetLevelLabels(req.clinicId, dto.labels)
    res.json({ labels })
  } catch (err) { next(err) }
}

// --- Org Units ---

const CreateUnitSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  level: z.coerce.number().int().min(1).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (!data.parentId && data.level !== undefined && data.level > 10) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['level'],
      message: 'Number must be less than or equal to 10',
    })
  }
})

const UpdateUnitSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  teamLeaderId: z.string().uuid().nullable().optional(),
  managerId: z.string().uuid().nullable().optional(),
  managementStaff1Id: z.string().uuid().nullable().optional(),
  managementStaff2Id: z.string().uuid().nullable().optional(),
  managementStaff3Id: z.string().uuid().nullable().optional(),
})

export async function getOrgTree(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestedClinicId = req.query.clinicId as string | undefined
    const clinicId = resolveClinicScope(req, requestedClinicId)
    await applyClinicScopeOverrideIfNeeded(clinicId)
    const tree = await orgSettingsService.getOrgTree(clinicId)
    res.json({ tree })
  } catch (err) { next(err) }
}

export async function getFlatOrgUnits(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestedClinicId = req.query.clinicId as string | undefined
    const clinicId = resolveClinicScope(req, requestedClinicId)
    await applyClinicScopeOverrideIfNeeded(clinicId)
    const units = await orgSettingsService.getFlatOrgUnits(clinicId)
    res.json({ units })
  } catch (err) { next(err) }
}

export async function createOrgUnit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = CreateUnitSchema.parse(req.body)
    const unit = await orgSettingsService.createOrgUnit(req.clinicId, dto)
    res.status(201).json({ unit })
  } catch (err) { next(err) }
}

export async function updateOrgUnit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = UpdateUnitSchema.parse(req.body)
    const unit = await orgSettingsService.updateOrgUnit(req.params.id, dto)
    if (!unit) { res.status(404).json({ error: 'Not found' }); return }
    res.json({ unit })
  } catch (err) { next(err) }
}

export async function deleteOrgUnit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await orgSettingsService.deleteOrgUnit(req.params.id)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

// --- Programs ---

const CreateProgramSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
})

const UpdateProgramSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  isActive: z.boolean().optional(),
})

export async function getPrograms(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestedClinicId = req.query.clinicId as string | undefined
    const clinicId = resolveClinicScope(req, requestedClinicId)
    await applyClinicScopeOverrideIfNeeded(clinicId)
    const programs = await orgSettingsService.getPrograms(clinicId)
    res.json({ programs })
  } catch (err) { next(err) }
}

export async function createProgram(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = CreateProgramSchema.parse(req.body)
    const program = await orgSettingsService.createProgram(req.clinicId, dto)
    res.status(201).json({ program })
  } catch (err) { next(err) }
}

export async function updateProgram(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = UpdateProgramSchema.parse(req.body)
    const program = await orgSettingsService.updateProgram(req.params.id, dto)
    if (!program) { res.status(404).json({ error: 'Not found' }); return }
    res.json({ program })
  } catch (err) { next(err) }
}

export async function deleteProgram(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await orgSettingsService.deleteProgram(req.params.id)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

// --- Program Assignment ---

const AssignSchema = z.object({
  orgUnitId: z.string().uuid(),
  programId: z.string().uuid(),
})

export async function assignProgramToUnit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = AssignSchema.parse(req.body)
    await orgSettingsService.assignProgram(req.clinicId, dto.orgUnitId, dto.programId)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

export async function unassignProgramFromUnit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = AssignSchema.parse(req.body)
    await orgSettingsService.unassignProgram(req.clinicId, dto.orgUnitId, dto.programId)
    res.json({ ok: true })
  } catch (err) { next(err) }
}
