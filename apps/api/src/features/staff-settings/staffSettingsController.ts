import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { db } from '../../db/db'
import { AppError, HttpError } from '../../shared/errors'
import { buildAuthContext } from '../../shared/buildAuthContext'
import { staffSettingsService } from './staffSettingsService'
import { RoleTypeEnum } from '@signacare/shared'

const NameSchema = z.object({ name: z.string().min(1).max(200), sortOrder: z.number().int().optional() })
const UpdateLookupSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    is_active: z.boolean().optional(),
    isActive: z.boolean().optional(),
    isactive: z.boolean().optional(),
    sort_order: z.number().int().optional(),
    sortOrder: z.number().int().optional(),
    sortorder: z.number().int().optional(),
  })
  .transform((value) => ({
    name: value.name,
    is_active: value.is_active ?? value.isActive ?? value.isactive,
    sort_order: value.sort_order ?? value.sortOrder ?? value.sortorder,
  }))
  .refine(
    (value) => value.name !== undefined || value.is_active !== undefined || value.sort_order !== undefined,
    { message: 'At least one update field is required' },
  )
const LookupItemSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string().min(1),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
})
const DisciplinesResponseSchema = z.object({ disciplines: z.array(LookupItemSchema) })
const ClinicalRolesResponseSchema = z.object({ roles: z.array(LookupItemSchema) })
const TeamAssignSchema = z.object({
  staffId: z.string().uuid(),
  orgUnitId: z.string().uuid(),
  startDate: z.string().min(1),
  endDate: z.string().nullable().optional(),
})
const TeamAssignRequestSchema = TeamAssignSchema.extend({
  clinicId: z.string().uuid().optional(),
})
const TeamAssignmentResponseSchema = z.object({
  id: z.string().uuid(),
  staffId: z.string().uuid(),
  orgUnitId: z.string().uuid(),
  orgUnitName: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  isActive: z.boolean(),
  staffName: z.string().optional(),
})
const TeamAssignmentEnvelopeSchema = z.object({ assignment: TeamAssignmentResponseSchema })
const TeamAssignmentsEnvelopeSchema = z.object({ assignments: z.array(TeamAssignmentResponseSchema) })
const TeamUpdateSchema = z
  .object({
    endDate: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .transform((value) => ({
    end_date: value.end_date ?? value.endDate,
    is_active: value.is_active ?? value.isActive,
  }))
  .refine(
    (value) => value.end_date !== undefined || value.is_active !== undefined,
    { message: 'At least one update field is required' },
  )
const RoleAssignSchema = z.object({
  staffId: z.string().uuid(),
  orgUnitId: z.string().uuid(),
  clinicalRoleId: z.string().uuid(),
  roleType: RoleTypeEnum,
  startDate: z.string().min(1),
  endDate: z.string().nullable().optional(),
})
const RoleAssignRequestSchema = RoleAssignSchema.extend({
  clinicId: z.string().uuid().optional(),
})
const RoleAssignmentResponseSchema = z.object({
  id: z.string().uuid(),
  staffId: z.string().uuid(),
  orgUnitId: z.string().uuid(),
  orgUnitName: z.string(),
  clinicalRoleId: z.string().uuid(),
  clinicalRoleName: z.string(),
  roleType: z.string().min(1),
  startDate: z.string(),
  endDate: z.string().nullable(),
  isActive: z.boolean(),
  staffName: z.string().optional(),
})
const RoleAssignmentEnvelopeSchema = z.object({ assignment: RoleAssignmentResponseSchema })
const RoleAssignmentsEnvelopeSchema = z.object({ assignments: z.array(RoleAssignmentResponseSchema) })
const RoleUpdateSchema = z
  .object({
    endDate: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
    is_active: z.boolean().optional(),
    roleType: RoleTypeEnum.optional(),
    role_type: RoleTypeEnum.optional(),
    roletype: RoleTypeEnum.optional(),
  })
  .transform((value) => ({
    end_date: value.end_date ?? value.endDate,
    is_active: value.is_active ?? value.isActive,
    role_type: value.role_type ?? value.roleType ?? value.roletype,
  }))
  .refine(
    (value) => value.end_date !== undefined || value.is_active !== undefined || value.role_type !== undefined,
    { message: 'At least one update field is required' },
  )
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
    throw new HttpError(403, 'FORBIDDEN', 'Cross-clinic lookup access is superadmin-only')
  }
  return parsedClinicId.data
}

async function applyClinicScopeOverrideIfNeeded(_req: Request, clinicId: string): Promise<void> {
  await db.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId])
}

// --- Disciplines ---
export async function getDisciplines(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestedClinicId = req.query.clinicId as string | undefined
    const clinicId = resolveClinicScope(req, requestedClinicId)
    await applyClinicScopeOverrideIfNeeded(req, clinicId)
    const disciplines = await staffSettingsService.getDisciplines(clinicId)
    res.json(DisciplinesResponseSchema.parse({ disciplines }))
  } catch (e) { next(e) }
}
export async function createDiscipline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const d = NameSchema.parse(req.body); res.status(201).json({ discipline: await staffSettingsService.createDiscipline(req.clinicId, d.name, d.sortOrder) }) } catch (e) { next(e) }
}
export async function updateDiscipline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const d = UpdateLookupSchema.parse(req.body); const r = await staffSettingsService.updateDiscipline(req.clinicId, req.params.id, d); r ? res.json({ discipline: r }) : res.status(404).json({ error: 'Not found' }) } catch (e) { next(e) }
}
export async function deleteDiscipline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { await staffSettingsService.deleteDiscipline(req.clinicId, req.params.id); res.json({ ok: true }) } catch (e) { next(e) }
}

// --- Clinical Roles ---
export async function getClinicalRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestedClinicId = req.query.clinicId as string | undefined
    const clinicId = resolveClinicScope(req, requestedClinicId)
    await applyClinicScopeOverrideIfNeeded(req, clinicId)
    const roles = await staffSettingsService.getClinicalRoles(clinicId)
    res.json(ClinicalRolesResponseSchema.parse({ roles }))
  } catch (e) { next(e) }
}
export async function createClinicalRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const d = NameSchema.parse(req.body); res.status(201).json({ role: await staffSettingsService.createClinicalRole(req.clinicId, d.name, d.sortOrder) }) } catch (e) { next(e) }
}
export async function updateClinicalRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const d = UpdateLookupSchema.parse(req.body); const r = await staffSettingsService.updateClinicalRole(req.clinicId, req.params.id, d); r ? res.json({ role: r }) : res.status(404).json({ error: 'Not found' }) } catch (e) { next(e) }
}
export async function deleteClinicalRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { await staffSettingsService.deleteClinicalRole(req.clinicId, req.params.id); res.json({ ok: true }) } catch (e) { next(e) }
}

// --- Team Assignments ---
export async function getTeamAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const staffId = req.query.staffId as string | undefined
    const requestedClinicId = req.query.clinicId as string | undefined
    const clinicId = resolveClinicScope(req, requestedClinicId)
    const auth = { ...buildAuthContext(req), clinicId }
    await applyClinicScopeOverrideIfNeeded(req, clinicId)
    const assignments = staffId
      ? await staffSettingsService.getTeamAssignmentsByStaff(auth, staffId, clinicId)
      : await staffSettingsService.getTeamAssignmentsByClinic(clinicId)
    res.json(TeamAssignmentsEnvelopeSchema.parse({ assignments }))
  } catch (e) { next(e) }
}
export async function createTeamAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestData = TeamAssignRequestSchema.parse(req.body)
    const clinicId = resolveClinicScope(req, requestData.clinicId)
    const auth = { ...buildAuthContext(req), clinicId }
    await applyClinicScopeOverrideIfNeeded(req, clinicId)
    const { clinicId: _clinicId, ...data } = requestData
    const assignment = await staffSettingsService.createTeamAssignment(auth, clinicId, data)
    res.status(201).json(TeamAssignmentEnvelopeSchema.parse({ assignment }))
  } catch (e) { next(e) }
}
export async function updateTeamAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestedClinicId = req.query.clinicId as string | undefined
    const clinicId = resolveClinicScope(req, requestedClinicId)
    await applyClinicScopeOverrideIfNeeded(req, clinicId)
    const d = TeamUpdateSchema.parse(req.body)
    const r = await staffSettingsService.updateTeamAssignment(clinicId, req.params.id, d)
    if (!r) {
      return next(new AppError('Team assignment not found', 404, 'NOT_FOUND'))
    }
    res.json(TeamAssignmentEnvelopeSchema.parse({ assignment: r }))
  } catch (e) { next(e) }
}
export async function deleteTeamAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestedClinicId = req.query.clinicId as string | undefined
    const clinicId = resolveClinicScope(req, requestedClinicId)
    await applyClinicScopeOverrideIfNeeded(req, clinicId)
    await staffSettingsService.deleteTeamAssignment(clinicId, req.params.id)
    res.json({ ok: true })
  } catch (e) { next(e) }
}

// --- Role Assignments ---
export async function getRoleAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const staffId = req.query.staffId as string | undefined
    const requestedClinicId = req.query.clinicId as string | undefined
    const clinicId = resolveClinicScope(req, requestedClinicId)
    const auth = { ...buildAuthContext(req), clinicId }
    await applyClinicScopeOverrideIfNeeded(req, clinicId)
    const assignments = staffId
      ? await staffSettingsService.getRoleAssignmentsByStaff(auth, staffId, clinicId)
      : await staffSettingsService.getRoleAssignmentsByClinic(clinicId)
    res.json(RoleAssignmentsEnvelopeSchema.parse({ assignments }))
  } catch (e) { next(e) }
}
export async function createRoleAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestData = RoleAssignRequestSchema.parse(req.body)
    const clinicId = resolveClinicScope(req, requestData.clinicId)
    const auth = { ...buildAuthContext(req), clinicId }
    await applyClinicScopeOverrideIfNeeded(req, clinicId)
    const { clinicId: _clinicId, ...data } = requestData
    const assignment = await staffSettingsService.createRoleAssignment(auth, clinicId, data)
    res.status(201).json(RoleAssignmentEnvelopeSchema.parse({ assignment }))
  } catch (e) { next(e) }
}
export async function updateRoleAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestedClinicId = req.query.clinicId as string | undefined
    const clinicId = resolveClinicScope(req, requestedClinicId)
    await applyClinicScopeOverrideIfNeeded(req, clinicId)
    const d = RoleUpdateSchema.parse(req.body)
    const r = await staffSettingsService.updateRoleAssignment(clinicId, req.params.id, d)
    if (!r) {
      return next(new AppError('Role assignment not found', 404, 'NOT_FOUND'))
    }
    res.json(RoleAssignmentEnvelopeSchema.parse({ assignment: r }))
  } catch (e) { next(e) }
}
export async function deleteRoleAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestedClinicId = req.query.clinicId as string | undefined
    const clinicId = resolveClinicScope(req, requestedClinicId)
    await applyClinicScopeOverrideIfNeeded(req, clinicId)
    await staffSettingsService.deleteRoleAssignment(clinicId, req.params.id)
    res.json({ ok: true })
  } catch (e) { next(e) }
}

// --- Referral Sources ---
const RefSourceSchema = z.object({ name: z.string().min(1).max(200), category: z.enum(['internal', 'external']), sortOrder: z.number().int().optional() })
const RefSourceUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    category: z.enum(['internal', 'external']).optional(),
    is_active: z.boolean().optional(),
    isActive: z.boolean().optional(),
    isactive: z.boolean().optional(),
    sort_order: z.number().int().optional(),
    sortOrder: z.number().int().optional(),
    sortorder: z.number().int().optional(),
  })
  .transform((value) => ({
    name: value.name,
    category: value.category,
    is_active: value.is_active ?? value.isActive ?? value.isactive,
    sort_order: value.sort_order ?? value.sortOrder ?? value.sortorder,
  }))
  .refine(
    (value) =>
      value.name !== undefined ||
      value.category !== undefined ||
      value.is_active !== undefined ||
      value.sort_order !== undefined,
    { message: 'At least one update field is required' },
  )

export async function getReferralSources(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ sources: await staffSettingsService.getReferralSources(req.clinicId) }) } catch (e) { next(e) }
}
export async function createReferralSource(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const d = RefSourceSchema.parse(req.body); res.status(201).json({ source: await staffSettingsService.createReferralSource(req.clinicId, d.category, d.name, d.sortOrder) }) } catch (e) { next(e) }
}
export async function updateReferralSource(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const d = RefSourceUpdateSchema.parse(req.body); const r = await staffSettingsService.updateReferralSource(req.clinicId, req.params.id, d); r ? res.json({ source: r }) : res.status(404).json({ error: 'Not found' }) } catch (e) { next(e) }
}
export async function deleteReferralSource(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { await staffSettingsService.deleteReferralSource(req.clinicId, req.params.id); res.json({ ok: true }) } catch (e) { next(e) }
}

// --- Investigation Types ---
export async function getInvestigationTypes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ types: await staffSettingsService.getInvestigationTypes(req.clinicId) }) } catch (e) { next(e) }
}
export async function createInvestigationType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const d = NameSchema.parse(req.body); res.status(201).json({ type: await staffSettingsService.createInvestigationType(req.clinicId, d.name, d.sortOrder) }) } catch (e) { next(e) }
}
export async function updateInvestigationType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const d = UpdateLookupSchema.parse(req.body); const r = await staffSettingsService.updateInvestigationType(req.clinicId, req.params.id, d); r ? res.json({ type: r }) : res.status(404).json({ error: 'Not found' }) } catch (e) { next(e) }
}
export async function deleteInvestigationType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { await staffSettingsService.deleteInvestigationType(req.clinicId, req.params.id); res.json({ ok: true }) } catch (e) { next(e) }
}
