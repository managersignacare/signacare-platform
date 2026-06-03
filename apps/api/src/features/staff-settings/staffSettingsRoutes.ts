import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { authMiddleware } from '../../middleware/authMiddleware'
import { tenantMiddleware } from '../../middleware/tenantMiddleware'
import { requireRole } from '../../middleware/rbacMiddleware'
import { idempotencyMiddleware } from '../../middleware/idempotencyMiddleware'
import { requireIdempotencyKey } from '../../middleware/requireIdempotencyKey'
import { requireAccessSettingsAuthority } from '../../shared/authGuards'
import { buildAuthContext } from '../../shared/buildAuthContext'
import { appPoolRaw } from '../../db/db'
import { writeAuditLog } from '../../utils/audit'
import * as ctrl from './staffSettingsController'
import { registerAiContextRoutes } from './aiContextRegistrar'
import {
  runBulkReassign,
  listPlannedTransitions,
  getPlannedTransitionDetail,
  createPlannedTransition,
  updatePlannedTransition,
  executePlannedTransition,
} from './staffTransitionCommands'
import { ALL_MODULE_KEYS, type ModuleKey } from '../../shared/moduleKeys'
import {
  CreateAlertTypeSchema,
  UpdateAlertTypeSchema,
  CreateLegalOrderTypeSchema,
  UpdateLegalOrderTypeSchema,
  CreateAppointmentModeSchema,
  UpdateAppointmentModeSchema,
  CreateTemplateCategorySchema,
  UpdateTemplateCategorySchema,
  CreateClinicalTemplateSchema,
  CreateEpisodeTypeSchema,
  UpdateEpisodeTypeSchema,
  UpdateContactOptionsSchema,
  BulkReassignSchema,
  CreateTransitionSchema,
  UpdateTransitionSchema,
  CreateClinicalPolicySchema,
  UpdateClinicalPolicySchema,
} from '@signacare/shared'

// Access levels accepted on upsert. 'full' is the legacy label that
// moduleAccessMiddleware treats as equivalent to 'write'; preserving
// it here keeps pre-existing grants round-trippable through the UI.
const VALID_ACCESS_LEVELS = new Set(['read', 'write', 'full'])
type ValidAccessLevel = 'read' | 'write' | 'full'

// Phase 0.7.5 c24 D10b — explicit .returning() column lists per table.
// Verified 2026-04-18 against schema-snapshot.json (regenerated after
// the episode_types migration in D10a).
const ALERT_TYPE_COLUMNS = [
  'id', 'clinic_id', 'name', 'severity', 'color', 'plan_template',
  'is_active', 'sort_order', 'created_at', 'updated_at',
] as const
const LEGAL_ORDER_TYPE_CONFIG_COLUMNS = [
  'id', 'clinic_id', 'name', 'category', 'is_active', 'sort_order',
  'created_at', 'updated_at',
] as const
const APPOINTMENT_MODE_COLUMNS = [
  'id', 'clinic_id', 'name', 'is_active', 'sort_order',
  'created_at', 'updated_at',
] as const
const TEMPLATE_CATEGORY_COLUMNS = [
  'id', 'clinic_id', 'name', 'is_active', 'sort_order',
  'created_at', 'updated_at',
] as const
const CLINICAL_TEMPLATE_COLUMNS = [
  'id', 'clinic_id', 'category_id', 'name', 'type', 'description',
  'content', 'is_active', 'is_system', 'sort_order', 'created_by_id',
  'created_at', 'updated_at',
] as const
const EPISODE_TYPE_COLUMNS = [
  'id', 'clinic_id', 'name', 'is_active', 'sort_order',
  'created_at', 'updated_at',
] as const
const CLINICAL_POLICY_COLUMNS = [
  'id', 'clinic_id', 'name', 'description', 'rule_type', 'parameters',
  'llm_context', 'is_active', 'generates_alert', 'available_to_llm',
  'category', 'sort_order', 'created_at', 'updated_at',
] as const
const BulkReassignResponseSchema = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
})
const PlannedTransitionsListResponseSchema = z.object({
  transitions: z.array(z.record(z.string(), z.unknown())),
})
const PlannedTransitionDetailResponseSchema = z.object({
  transition: z.record(z.string(), z.unknown()),
  assignments: z.array(z.record(z.string(), z.unknown())),
})
const PlannedTransitionMutationResponseSchema = z.object({
  transition: z.record(z.string(), z.unknown()),
})
const PlannedTransitionExecuteResponseSchema = z.object({
  ok: z.literal(true),
  executed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
})

function isModuleKey(v: unknown): v is ModuleKey {
  return typeof v === 'string' && (ALL_MODULE_KEYS as readonly string[]).includes(v)
}

export const staffSettingsRoutes = Router()
staffSettingsRoutes.use(authMiddleware, tenantMiddleware)

const admin = requireRole('admin', 'superadmin')
const auditRead = requireRole('admin', 'superadmin', 'manager')

// Phase 0.5.B — write-gate for access-control surfaces. GET routes
// keep the `admin` middleware (any clinic admin can view); POST /
// PATCH / DELETE / PUT on module-access / role-assignments / team-
// assignments swap to `adminWrite` which additionally requires the
// caller to be the clinic's nominated/delegated admin (or superadmin).
// Composes: (1) base admin role check (rejects non-admins at HTTP layer)
// then (2) requireAccessSettingsAuthority(auth, req.clinicId) which
// reads clinics.{nominated,delegated}_admin_staff_id.
const adminWrite = [
  admin,
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      await requireAccessSettingsAuthority(auth, req.clinicId);
      next();
    } catch (err) {
      next(err);
    }
  },
];

// Disciplines (lookup)
staffSettingsRoutes.get('/disciplines', ctrl.getDisciplines)
staffSettingsRoutes.post('/disciplines', admin, ctrl.createDiscipline)
staffSettingsRoutes.patch('/disciplines/:id', admin, ctrl.updateDiscipline)
staffSettingsRoutes.delete('/disciplines/:id', admin, ctrl.deleteDiscipline)

// Clinical roles (lookup)
staffSettingsRoutes.get('/clinical-roles', ctrl.getClinicalRoles)
staffSettingsRoutes.post('/clinical-roles', admin, ctrl.createClinicalRole)
staffSettingsRoutes.patch('/clinical-roles/:id', admin, ctrl.updateClinicalRole)
staffSettingsRoutes.delete('/clinical-roles/:id', admin, ctrl.deleteClinicalRole)

// Team assignments — Phase 0.5.B: writes require nominated/delegated admin
staffSettingsRoutes.get('/team-assignments', ctrl.getTeamAssignments)
staffSettingsRoutes.post('/team-assignments', adminWrite, ctrl.createTeamAssignment)
staffSettingsRoutes.patch('/team-assignments/:id', adminWrite, ctrl.updateTeamAssignment)
staffSettingsRoutes.delete('/team-assignments/:id', adminWrite, ctrl.deleteTeamAssignment)

// Role assignments — Phase 0.5.B: writes require nominated/delegated admin
staffSettingsRoutes.get('/role-assignments', ctrl.getRoleAssignments)
staffSettingsRoutes.post('/role-assignments', adminWrite, ctrl.createRoleAssignment)
staffSettingsRoutes.patch('/role-assignments/:id', adminWrite, ctrl.updateRoleAssignment)
staffSettingsRoutes.delete('/role-assignments/:id', adminWrite, ctrl.deleteRoleAssignment)

// Referral sources (lookup)
staffSettingsRoutes.get('/referral-sources', ctrl.getReferralSources)
staffSettingsRoutes.post('/referral-sources', admin, ctrl.createReferralSource)
staffSettingsRoutes.patch('/referral-sources/:id', admin, ctrl.updateReferralSource)
staffSettingsRoutes.delete('/referral-sources/:id', admin, ctrl.deleteReferralSource)

// Investigation types (lookup)
staffSettingsRoutes.get('/investigation-types', ctrl.getInvestigationTypes)
staffSettingsRoutes.post('/investigation-types', admin, ctrl.createInvestigationType)
staffSettingsRoutes.patch('/investigation-types/:id', admin, ctrl.updateInvestigationType)
staffSettingsRoutes.delete('/investigation-types/:id', admin, ctrl.deleteInvestigationType)

// Alert types (configurable with plan templates)
staffSettingsRoutes.get('/alert-types', async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const rows = await db('alert_types').where({ clinic_id: req.clinicId }).orderBy('sort_order');
    res.json({ types: rows.map((r) => ({ id: r.id, clinicId: r.clinic_id, name: r.name, severity: r.severity, color: r.color, planTemplate: r.plan_template, isActive: r.is_active, sortOrder: r.sort_order })) });
  } catch (e) { next(e); }
});
staffSettingsRoutes.post('/alert-types', admin, async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const { name, severity, color, planTemplate, sortOrder } = CreateAlertTypeSchema.parse(req.body);
    const [row] = await db('alert_types').insert({
      id: db.raw('gen_random_uuid()'), clinic_id: req.clinicId, name, severity: severity ?? 'medium',
      color: color ?? '#F0852C', plan_template: planTemplate ?? null, is_active: true,
      sort_order: sortOrder ?? 0, created_at: new Date(), updated_at: new Date(),
    }).returning(ALERT_TYPE_COLUMNS);
    res.status(201).json({ type: { id: row.id, clinicId: row.clinic_id, name: row.name, severity: row.severity, color: row.color, planTemplate: row.plan_template, isActive: row.is_active, sortOrder: row.sort_order } });
  } catch (e) { next(e); }
});
staffSettingsRoutes.patch('/alert-types/:id', admin, async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const body = UpdateAlertTypeSchema.parse(req.body);
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.severity !== undefined) patch.severity = body.severity;
    if (body.color !== undefined) patch.color = body.color;
    if (body.planTemplate !== undefined) patch.plan_template = body.planTemplate;
    if (body.isActive !== undefined) patch.is_active = body.isActive;
    const [row] = await db('alert_types').where({ id: req.params.id, clinic_id: req.clinicId }).update(patch).returning(ALERT_TYPE_COLUMNS);
    res.json({ type: row ? { id: row.id, clinicId: row.clinic_id, name: row.name, severity: row.severity, color: row.color, planTemplate: row.plan_template, isActive: row.is_active, sortOrder: row.sort_order } : null });
  } catch (e) { next(e); }
});
staffSettingsRoutes.delete('/alert-types/:id', admin, async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    await db('alert_types').where({ id: req.params.id, clinic_id: req.clinicId }).delete();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Legal order types
staffSettingsRoutes.get('/legal-order-types', async (req, res, next) => {
  try { const { db } = await import('../../db/db'); const rows = await db('legal_order_type_configs').where({ clinic_id: req.clinicId }).orderBy(['category', 'sort_order']); res.json({ types: rows.map((r) => ({ id: r.id, name: r.name, category: r.category, isActive: r.is_active, sortOrder: r.sort_order })) }); } catch (e) { next(e); }
});
staffSettingsRoutes.post('/legal-order-types', admin, async (req, res, next) => {
  try { const { db } = await import('../../db/db'); const { name, category } = CreateLegalOrderTypeSchema.parse(req.body); const [row] = await db('legal_order_type_configs').insert({ id: db.raw('gen_random_uuid()'), clinic_id: req.clinicId, name, category: category ?? 'other', is_active: true, sort_order: 0, created_at: new Date(), updated_at: new Date() }).returning(LEGAL_ORDER_TYPE_CONFIG_COLUMNS); res.status(201).json({ type: { id: row.id, name: row.name, category: row.category, isActive: row.is_active } }); } catch (e) { next(e); }
});
staffSettingsRoutes.patch('/legal-order-types/:id', admin, async (req, res, next) => {
  try { const { db } = await import('../../db/db'); const body = UpdateLegalOrderTypeSchema.parse(req.body); const patch: Record<string, unknown> = { updated_at: new Date() }; if (body.name !== undefined) patch.name = body.name; if (body.category !== undefined) patch.category = body.category; if (body.isActive !== undefined) patch.is_active = body.isActive; const [row] = await db('legal_order_type_configs').where({ id: req.params.id, clinic_id: req.clinicId }).update(patch).returning(LEGAL_ORDER_TYPE_CONFIG_COLUMNS); res.json({ type: row ? { id: row.id, name: row.name, category: row.category, isActive: row.is_active } : null }); } catch (e) { next(e); }
});
staffSettingsRoutes.delete('/legal-order-types/:id', admin, async (req, res, next) => {
  try { const { db } = await import('../../db/db'); await db('legal_order_type_configs').where({ id: req.params.id, clinic_id: req.clinicId }).delete(); res.json({ ok: true }); } catch (e) { next(e); }
});

// Appointment modes
staffSettingsRoutes.get('/appointment-modes', async (req, res, next) => {
  try { const { db } = await import('../../db/db'); const rows = await db('appointment_modes').where({ clinic_id: req.clinicId }).orderBy('sort_order'); res.json({ modes: rows.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active, sortOrder: r.sort_order })) }); } catch (e) { next(e); }
});
staffSettingsRoutes.post('/appointment-modes', admin, async (req, res, next) => {
  try { const { db } = await import('../../db/db'); const { name } = CreateAppointmentModeSchema.parse(req.body); const [row] = await db('appointment_modes').insert({ id: db.raw('gen_random_uuid()'), clinic_id: req.clinicId, name, is_active: true, sort_order: 0, created_at: new Date(), updated_at: new Date() }).returning(APPOINTMENT_MODE_COLUMNS); res.status(201).json({ mode: { id: row.id, name: row.name, isActive: row.is_active } }); } catch (e) { next(e); }
});
staffSettingsRoutes.patch('/appointment-modes/:id', admin, async (req, res, next) => {
  try { const { db } = await import('../../db/db'); const body = UpdateAppointmentModeSchema.parse(req.body); const patch: Record<string, unknown> = { updated_at: new Date() }; if (body.name !== undefined) patch.name = body.name; if (body.isActive !== undefined) patch.is_active = body.isActive; const [row] = await db('appointment_modes').where({ id: req.params.id, clinic_id: req.clinicId }).update(patch).returning(APPOINTMENT_MODE_COLUMNS); res.json({ mode: row ? { id: row.id, name: row.name, isActive: row.is_active } : null }); } catch (e) { next(e); }
});
staffSettingsRoutes.delete('/appointment-modes/:id', admin, async (req, res, next) => {
  try { const { db } = await import('../../db/db'); await db('appointment_modes').where({ id: req.params.id, clinic_id: req.clinicId }).delete(); res.json({ ok: true }); } catch (e) { next(e); }
});

// Template categories
staffSettingsRoutes.get('/template-categories', async (req, res, next) => {
  try { const { db } = await import('../../db/db'); const rows = await db('template_categories').where({ clinic_id: req.clinicId }).orderBy('sort_order'); res.json({ categories: rows.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active })) }); } catch (e) { next(e); }
});
staffSettingsRoutes.post('/template-categories', admin, async (req, res, next) => {
  try { const { db } = await import('../../db/db'); const { name } = CreateTemplateCategorySchema.parse(req.body); const [row] = await db('template_categories').insert({ id: db.raw('gen_random_uuid()'), clinic_id: req.clinicId, name, is_active: true, sort_order: 0, created_at: new Date() }).returning(TEMPLATE_CATEGORY_COLUMNS); res.status(201).json({ category: { id: row.id, name: row.name } }); } catch (e) { next(e); }
});
staffSettingsRoutes.patch('/template-categories/:id', admin, async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const dto = UpdateTemplateCategorySchema.parse(req.body);
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;
    if (dto.sortOrder !== undefined) patch.sort_order = dto.sortOrder;
    const [row] = await db('template_categories')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .update(patch)
      .returning(TEMPLATE_CATEGORY_COLUMNS);
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ category: { id: row.id, name: row.name, isActive: row.is_active, sortOrder: row.sort_order } });
  } catch (e) { next(e); }
});
staffSettingsRoutes.delete('/template-categories/:id', admin, async (req, res, next) => {
  try { const { db } = await import('../../db/db'); await db('template_categories').where({ id: req.params.id, clinic_id: req.clinicId }).delete(); res.json({ ok: true }); } catch (e) { next(e); }
});

// Clinical templates
staffSettingsRoutes.get('/templates', async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    let q = db('clinical_templates').leftJoin('template_categories', 'template_categories.id', 'clinical_templates.category_id').where('clinical_templates.clinic_id', req.clinicId).select('clinical_templates.*', 'template_categories.name as categoryname').orderBy('clinical_templates.name');
    if (req.query.type) q = q.where('clinical_templates.type', req.query.type as string);
    if (req.query.categoryId) q = q.where('clinical_templates.category_id', req.query.categoryId as string);
    if (req.query.category) q = q.where('template_categories.name', req.query.category as string);
    const rows = await q;
    res.json({ templates: rows.map((r) => ({ id: r.id, name: r.name, type: r.categoryname ?? r.type, categoryId: r.category_id, categoryName: r.categoryname, description: r.description, content: typeof r.content === 'string' ? JSON.parse(r.content) : r.content, isActive: r.is_active, isSystem: r.is_system })) });
  } catch (e) { next(e); }
});
staffSettingsRoutes.post('/templates', admin, async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const { name, type, categoryId, description, content } = CreateClinicalTemplateSchema.parse(req.body);
    const [row] = await db('clinical_templates').insert({ id: db.raw('gen_random_uuid()'), clinic_id: req.clinicId, category_id: categoryId ?? null, name, type: type ?? 'note', description: description ?? null, content: JSON.stringify(content ?? []), is_active: true, is_system: false, created_by_id: req.user?.id ?? null, created_at: new Date(), updated_at: new Date() }).returning(CLINICAL_TEMPLATE_COLUMNS);
    res.status(201).json({ template: { id: row.id, name: row.name, type: row.type } });
  } catch (e) { next(e); }
});
staffSettingsRoutes.delete('/templates/:id', admin, async (req, res, next) => {
  try { const { db } = await import('../../db/db'); await db('clinical_templates').where({ id: req.params.id, clinic_id: req.clinicId, is_system: false }).delete(); res.json({ ok: true }); } catch (e) { next(e); }
});

// ─── Access Control ───────────────────────────────────────────────────────
//
// Every route validates the target staff belongs to the caller's clinic
// BEFORE any read or write, and validates the module keys against the
// canonical MODULE_KEYS set so the UI cannot invent arbitrary module
// strings. Access-level values are validated against VALID_ACCESS_LEVELS.

// GET /staff-settings/module-access — matrix view. Returns every
// active staff row with their full grant list. Used by the admin
// UI to render a staff × module matrix without N+1 round trips.
// Admin-only because the matrix exposes every colleague's grant set.
staffSettingsRoutes.get('/module-access', admin, async (req, res, next) => {
  try {
    const { db } = await import('../../db/db')
    const { escapeLike } = await import('../../shared/escapeLike')
    const pageRaw = Number.parseInt(String(req.query.page ?? '1'), 10)
    const limitRaw = Number.parseInt(String(req.query.limit ?? '25'), 10)
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1
    const limit = Number.isFinite(limitRaw)
      ? Math.min(100, Math.max(10, limitRaw))
      : 25
    const search = String(req.query.q ?? '').trim()

    const baseStaffQ = db('staff')
      .where({ clinic_id: req.clinicId, is_active: true })
      .whereNull('deleted_at')

    if (search.length > 0) {
      const pattern = `%${escapeLike(search)}%`
      baseStaffQ.andWhere((qb) => {
        qb.whereILike('given_name', pattern)
          .orWhereILike('family_name', pattern)
          .orWhereILike('email', pattern)
          .orWhereILike('role', pattern)
      })
    }

    const totalRows = await baseStaffQ.clone().count<{ c: string }[]>('* as c')
    const total = Number.parseInt(totalRows[0]?.c ?? '0', 10)

    const staffRows = await baseStaffQ
      .clone()
      .orderBy(['family_name', 'given_name'])
      .limit(limit)
      .offset((page - 1) * limit)
      .select('id', 'given_name', 'family_name', 'email', 'role') as Array<{
        id: string; given_name: string; family_name: string; email: string; role: string;
      }>

    if (staffRows.length === 0) {
      res.json({ staff: [], moduleKeys: ALL_MODULE_KEYS, total, page, limit })
      return
    }

    const staffIds = staffRows.map(s => s.id)
    const grants = await db('staff_module_access')
      .whereIn('staff_id', staffIds)
      .andWhere({ clinic_id: req.clinicId })
      .select('staff_id', 'module', 'access_level', 'can_delegate_this') as Array<{
        staff_id: string; module: string; access_level: string; can_delegate_this: boolean;
      }>

    const byStaff = new Map<string, Array<{ module: string; accessLevel: string; canDelegate: boolean }>>()
    for (const g of grants) {
      const list = byStaff.get(g.staff_id) ?? []
      list.push({ module: g.module, accessLevel: g.access_level, canDelegate: g.can_delegate_this })
      byStaff.set(g.staff_id, list)
    }

    res.json({
      staff: staffRows.map(s => ({
        id: s.id,
        givenName: s.given_name,
        familyName: s.family_name,
        email: s.email,
        role: s.role,
        grants: byStaff.get(s.id) ?? [],
      })),
      moduleKeys: ALL_MODULE_KEYS,
      total,
      page,
      limit,
    })
  } catch (e) { next(e) }
})

// GET /staff-settings/module-access/:staffId — single-staff grant list.
// Admin-only AND requires the target staff to share the caller's clinic.
staffSettingsRoutes.get('/module-access/:staffId', admin, async (req, res, next) => {
  try {
    const { db } = await import('../../db/db')

    // Tenant check — staff_module_access has no clinic_id column on
    // SELECT shortcut, so the guard lives on the staff table instead.
    const staff = await db('staff')
      .where({ id: req.params.staffId, clinic_id: req.clinicId })
      .select('id')
      .first() as { id: string } | undefined
    if (!staff) { res.status(404).json({ error: 'Staff not found in this clinic' }); return }

    const rows = await db('staff_module_access')
      .where({ staff_id: req.params.staffId, clinic_id: req.clinicId })
      .select('id', 'module', 'access_level', 'can_delegate_this') as Array<{
        id: string; module: string; access_level: string; can_delegate_this: boolean;
      }>

    res.json({
      access: rows.map(r => ({
        id: r.id,
        module: r.module,
        accessLevel: r.access_level,
        canDelegate: r.can_delegate_this,
      })),
      moduleKeys: ALL_MODULE_KEYS,
    })
  } catch (e) { next(e) }
})

// PUT /staff-settings/module-access/:staffId — replace the full grant
// set for a staff member. Body: { modules: [{ module, accessLevel }] }.
// Module keys validated against the canonical set; invalid keys or
// invalid access_level values produce a 400. Tenant-checked.
staffSettingsRoutes.put('/module-access/:staffId', adminWrite, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { db } = await import('../../db/db')

    const staff = await db('staff')
      .where({ id: req.params.staffId, clinic_id: req.clinicId })
      .select('id')
      .first() as { id: string } | undefined
    if (!staff) { res.status(404).json({ error: 'Staff not found in this clinic' }); return }

    const body = req.body as { modules?: Array<{ module?: string; accessLevel?: string; canDelegate?: boolean }> }
    if (!Array.isArray(body.modules)) {
      res.status(400).json({ error: 'Body must be { modules: [...] }' })
      return
    }

    // Validate everything up-front so a partial batch never touches
    // the DB on a malformed payload.
    const normalised: Array<{ module: ModuleKey; accessLevel: ValidAccessLevel; canDelegate: boolean }> = []
    for (let i = 0; i < body.modules.length; i++) {
      const m = body.modules[i]
      if (!isModuleKey(m?.module)) {
        res.status(400).json({
          error: `modules[${i}].module must be one of: ${ALL_MODULE_KEYS.join(', ')}`,
          code: 'INVALID_MODULE_KEY',
        })
        return
      }
      if (!m.accessLevel || !VALID_ACCESS_LEVELS.has(m.accessLevel)) {
        res.status(400).json({
          error: `modules[${i}].accessLevel must be one of: read, write, full`,
          code: 'INVALID_ACCESS_LEVEL',
        })
        return
      }
      normalised.push({
        module: m.module,
        accessLevel: m.accessLevel as ValidAccessLevel,
        canDelegate: m.canDelegate ?? false,
      })
    }

    // Guard against self-demotion — a superadmin stripping their own
    // MODULE_KEYS rights would be recoverable but an admin shouldn't
    // be able to accidentally revoke their own module access.
    if (req.params.staffId === req.user?.id && req.user?.role !== 'superadmin') {
      res.status(403).json({
        error: 'Admins cannot edit their own module access grants — ask another admin or a superadmin',
        code: 'CANNOT_EDIT_OWN_GRANTS',
      })
      return
    }

    // L4-absorb-1: snapshot pre-write state for audit. Captures every
    // existing grant for this staff BEFORE the upsert so the audit row
    // has a meaningful old_data vs new_data diff. Access-control changes
    // are themselves clinical-governance events per OAIC APP 11 / Privacy
    // Act §12 — every mutation must leave a tamper-evident trail.
    const before = await db('staff_module_access')
      .where({ staff_id: req.params.staffId, clinic_id: req.clinicId })
      .select('module', 'access_level', 'can_delegate_this');

    await db.transaction(async (trx) => {
      for (const m of normalised) {
        await trx('staff_module_access')
          .insert({
            id: trx.raw('gen_random_uuid()'),
            staff_id: req.params.staffId,
            clinic_id: req.clinicId,
            module: m.module,
            access_level: m.accessLevel,
            can_delegate_this: m.canDelegate,
            granted_by_id: req.user?.id ?? null,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .onConflict(['staff_id', 'module'])
          .merge({
            access_level: m.accessLevel,
            can_delegate_this: m.canDelegate,
            granted_by_id: req.user?.id ?? null,
            updated_at: new Date(),
          })
      }
    })

    // L4-absorb-1: audit row for the whole upsert batch. writeAuditLog
    // is best-effort (try/catch internal); a failure here MUST NOT
    // roll back the already-committed access-grant transaction. We
    // log-and-continue; the pending BUG-283 Redis outbox eventually
    // catches dropped audit events.
    await writeAuditLog(
      {
        clinicId: req.clinicId,
        userId: req.user?.id ?? '',
        ipAddress: req.ip,
      },
      {
        tableName: 'staff_module_access',
        recordId: req.params.staffId,
        action: 'UPDATE',
        oldValues: before,
        newValues: normalised,
      },
    )

    res.json({ ok: true, updated: normalised.length })
  } catch (e) { next(e) }
})

// DELETE /staff-settings/module-access/:staffId/:module — revoke a
// single module grant. Separate endpoint from PUT because the UI
// may want an explicit "remove" action without rebuilding the full
// grant list. Tenant-checked. Module key validated.
staffSettingsRoutes.delete('/module-access/:staffId/:module', adminWrite, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isModuleKey(req.params.module)) {
      res.status(400).json({
        error: `Unknown module key '${req.params.module}'`,
        code: 'INVALID_MODULE_KEY',
      })
      return
    }

    const { db } = await import('../../db/db')
    const staff = await db('staff')
      .where({ id: req.params.staffId, clinic_id: req.clinicId })
      .select('id')
      .first() as { id: string } | undefined
    if (!staff) { res.status(404).json({ error: 'Staff not found in this clinic' }); return }

    if (req.params.staffId === req.user?.id && req.user?.role !== 'superadmin') {
      res.status(403).json({
        error: 'Admins cannot revoke their own module access grants',
        code: 'CANNOT_EDIT_OWN_GRANTS',
      })
      return
    }

    // L4-absorb-1: snapshot before delete + audit row. Same rationale
    // as the PUT path — access-grant revocation is a clinical-governance
    // event that must leave an audit trail.
    const priorRows = await db('staff_module_access')
      .where({
        staff_id: req.params.staffId,
        clinic_id: req.clinicId,
        module: req.params.module,
      })
      .select('module', 'access_level', 'can_delegate_this');

    const deleted = await db('staff_module_access')
      .where({
        staff_id: req.params.staffId,
        clinic_id: req.clinicId,
        module: req.params.module,
      })
      .delete()

    await writeAuditLog(
      {
        clinicId: req.clinicId,
        userId: req.user?.id ?? '',
        ipAddress: req.ip,
      },
      {
        tableName: 'staff_module_access',
        recordId: req.params.staffId,
        action: 'DELETE',
        oldValues: priorRows,
        newValues: { module: req.params.module, removed: deleted > 0 },
      },
    )

    res.json({ ok: true, deleted })
  } catch (e) { next(e) }
})

// ─── Audit Log ───
staffSettingsRoutes.get('/audit-log', auditRead, async (req, res, next) => {
  try {
    const responseClosed = (): boolean =>
      req.aborted || req.destroyed || res.writableEnded || res.headersSent;

    const page = parseInt(req.query.page as string ?? '1', 10);
    const limit = parseInt(req.query.limit as string ?? '50', 10);
    const { escapeLike } = await import('../../shared/escapeLike');
    const { extractCount } = await import('../../shared/extractCount');

    // audit_log baseline (R2) has dual-write pairs for the v1→v2 transition:
    // operation/action, table_name/module, record_id/entity_id, new_data/details,
    // staff_id/user_id. Both halves of each pair are real columns per the
    // schema-snapshot. Ghost columns (createdat, entityid, ipaddress, user_name
    // with an underscore) never existed — those were pre-R2 drafts. username
    // (no underscore) IS the real column.
    const { rows, total } = await appPoolRaw.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [req.clinicId]);
      if (req.user?.id) {
        await trx.raw("SELECT set_config('app.user_id', ?, true)", [req.user.id]);
      }

      const q = trx('audit_events_canonical as audit_log')
        .leftJoin('staff', trx.raw('staff.id = COALESCE(audit_log.staff_id, audit_log.user_id)'))
        .where('audit_log.clinic_id', req.clinicId)
        .orderBy('audit_log.created_at', 'desc')
        .select(
          'audit_log.id',
          'audit_log.created_at',
          trx.raw("COALESCE(audit_log.operation, audit_log.action) as action"),
          trx.raw("COALESCE(audit_log.table_name, audit_log.module) as module"),
          trx.raw("COALESCE(audit_log.record_id::text, audit_log.entity_id) as entity_id"),
          'audit_log.ip_address',
          trx.raw("COALESCE(audit_log.new_data::text, audit_log.details::text) as details"),
          trx.raw("COALESCE(audit_log.staff_id, audit_log.user_id) as staff_id"),
          trx.raw("COALESCE(staff.given_name || ' ' || staff.family_name, audit_log.username, 'System') as user_name"),
        );

      if (req.query.action) {
        const a = (req.query.action as string).toUpperCase();
        q.whereRaw('UPPER(COALESCE(audit_log.operation, audit_log.action)) = ?', [a]);
      }
      if (req.query.userId) {
        q.whereRaw('COALESCE(audit_log.staff_id, audit_log.user_id) = ?', [req.query.userId as string]);
      }
      if (req.query.module) {
        const m = `%${escapeLike(req.query.module as string)}%`;
        q.whereRaw('COALESCE(audit_log.table_name, audit_log.module) ILIKE ?', [m]);
      }

      const countQ = trx('audit_events_canonical as audit_log').where('audit_log.clinic_id', req.clinicId);
      if (req.query.action) {
        const a = (req.query.action as string).toUpperCase();
        countQ.whereRaw('UPPER(COALESCE(audit_log.operation, audit_log.action)) = ?', [a]);
      }
      if (req.query.userId) {
        countQ.whereRaw('COALESCE(audit_log.staff_id, audit_log.user_id) = ?', [req.query.userId as string]);
      }
      if (req.query.module) {
        const m = `%${escapeLike(req.query.module as string)}%`;
        countQ.whereRaw('COALESCE(audit_log.table_name, audit_log.module) ILIKE ?', [m]);
      }

      const totalRows = await countQ.count('* as c');
      const rows = await q.limit(limit).offset((page - 1) * limit);
      const total = extractCount(totalRows as unknown as Array<Record<string, unknown>>);
      return { rows, total };
    });

    if (responseClosed()) return;
    res.json({ entries: rows, total, page, limit });
  } catch (e) { next(e); }
});

// Episode types
staffSettingsRoutes.get('/episode-types', async (req, res, next) => {
  try { const { db } = await import('../../db/db'); const rows = await db('episode_types').where({ clinic_id: req.clinicId }).orderBy('sort_order'); res.json({ types: rows.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active, sortOrder: r.sort_order })) }); } catch (e) { next(e); }
});
staffSettingsRoutes.post('/episode-types', admin, async (req, res, next) => {
  try { const { db } = await import('../../db/db'); const { name } = CreateEpisodeTypeSchema.parse(req.body); const [row] = await db('episode_types').insert({ id: db.raw('gen_random_uuid()'), clinic_id: req.clinicId, name, is_active: true, sort_order: 0, created_at: new Date() }).returning(EPISODE_TYPE_COLUMNS); res.status(201).json({ type: { id: row.id, name: row.name } }); } catch (e) { next(e); }
});
staffSettingsRoutes.patch('/episode-types/:id', admin, async (req, res, next) => {
  try { const { db } = await import('../../db/db'); const body = UpdateEpisodeTypeSchema.parse(req.body); const patch: Record<string, unknown> = { updated_at: new Date() }; if (body.name !== undefined) patch.name = body.name; if (body.isActive !== undefined) patch.is_active = body.isActive; const [row] = await db('episode_types').where({ id: req.params.id, clinic_id: req.clinicId }).update(patch).returning(EPISODE_TYPE_COLUMNS); res.json({ type: row ? { id: row.id, name: row.name, isActive: row.is_active } : null }); } catch (e) { next(e); }
});
staffSettingsRoutes.delete('/episode-types/:id', admin, async (req, res, next) => {
  try { const { db } = await import('../../db/db'); await db('episode_types').where({ id: req.params.id, clinic_id: req.clinicId }).delete(); res.json({ ok: true }); } catch (e) { next(e); }
});

// ── Contact Options (ABF form dropdowns) — codes from Victoria PR6M contact sheet ──
const DEFAULT_LOCATIONS = [
  '1 — Centre based',
  '2 — Community based mental health service',
  '3 — Mental health inpatient service',
  '4 — Client\'s own environment',
  '5 — Non-psychiatric health or welfare service',
  '6 — Private psychiatric service or PDSS',
  '7 — Emergency department',
  '8 — Public hospital – excl MH ward',
  '9 — Private psychiatric hospital',
  '10 — Private practitioner\'s rooms',
  '11 — Psychiatric disability rehabilitation support service (PDRSS/MHCSS)',
  '12 — Community care unit (CCU)',
  '13 — Aged persons mental health residential service',
  '14 — Generic aged care residential service',
  '15 — Alcohol and drug treatment service',
  '16 — Prevention and recovery centre (PARC)',
  '17 — Early years setting',
  '18 — Educational institutions',
  '19 — Child first/family services',
  '20 — Out of home care',
  '21 — Youth specific services',
  '22 — Housing and/or support agency',
  '23 — Police facilities',
  '24 — Courts',
  '25 — Prison',
  '26 — Mental health & AOD hub',
  '27 — Prior/during transport to AMHS',
  '28 — Prior/during transport to other place',
  '30 — Urgent Care Centre (UCC)',
  '35 — Mental Health & Wellbeing Local',
  '0 — Other',
  '99 — Other (not listed)',
];
// Programs are managed in Org Settings — this default is kept only as fallback
const DEFAULT_PROGRAMS: string[] = [];
const DEFAULT_SERVICE_RECIPIENT_TYPES = [
  '1 — Client only',
  '2 — Client group',
  '3 — Client & Family',
  '4 — Client & Others',
  '5 — Client & Family & Others',
  '6 — Family Only',
  '7 — Other',
  '8 — Family & Others',
  '9 — Parent/Family/Carer Group',
  '10 — Interagency Case Planning',
  '11 — General Practitioner',
  '12 — Private Psychiatrist',
  '13 — Other Health Practitioners (Private)',
  '14 — PDSS',
  '15 — Ambulance',
  '16 — Police',
  '17 — Youth Justice',
  '18 — Child Protection',
  '19 — Community Health Services',
  '20 — Acute Health',
  '21 — Child & Family Support',
  '22 — Counselling',
  '23 — Crisis Services',
  '24 — Domestic Violence',
  '25 — Drug Alcohol',
  '26 — Educational',
  '27 — Employment',
  '28 — Financial',
  '29 — Accommodation',
  '30 — Home Support Services',
  '31 — Aged Care Assessment Services',
  '32 — Indigenous Persons Support Services',
  '33 — Intellectual Disability Services',
  '34 — Migrant Resource Services',
  '35 — Sexual Assault Services',
  '36 — Youth Services',
  '37 — Legal Services',
  '38 — Pathology Services',
  '40 — Client & Family Group',
  '50 — Urgent Care Centre',
  '55 — Mental Health & Wellbeing Local',
  '99 — InterAMHS planning',
  '100 — DMHS Service Development',
  '101 — Client & Compulsory Notification List',
  '102 — Client, Family & Compulsory Notification List',
  '103 — Compulsory Notification',
  '104 — Family & Compulsory Notification List',
  '105 — Magistrate',
  '106 — Area Mental Health Service',
  '107 — CCS/Court Assessment & Prosecution Services (CAPS)',
  '108 — Koorie Court Officer',
  '109 — Youth Justice Court Adviser Service (YJCAS)',
  '110 — National Disability Insurance Agency (NDIA)',
  '111 — National Disability Insurance Scheme Provider (NDIS)',
  '112 — eMental Health Service Provider',
  '113 — Pharmacy Services',
  '114 — Custodial Health Service',
  '115 — Carer',
  '116 — Primary Mental Health Service',
  '120 — Victorian Aboriginal Child Care Agency',
  '121 — Ngwala Willumbong Aboriginal Corporation',
];
const DEFAULT_CONTACT_MEDIA_TYPES = [
  '1 — Direct',
  '2 — Telephone',
  '3 — Teleconferencing/videoconference',
  '5 — Other Synchronous',
  '6 — Other asynchronous',
];

staffSettingsRoutes.get('/contact-options', async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const row = await db('clinic_contact_options').where({ clinic_id: req.clinicId }).first();
    res.json({
      locations: row?.locations ?? DEFAULT_LOCATIONS,
      programs: row?.programs ?? DEFAULT_PROGRAMS,
      serviceRecipientTypes: row?.service_recipient_types ?? DEFAULT_SERVICE_RECIPIENT_TYPES,
      contactMediaTypes: row?.contact_media_types ?? DEFAULT_CONTACT_MEDIA_TYPES,
    });
  } catch (e) { next(e); }
});

staffSettingsRoutes.put('/contact-options', requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const { locations, programs, serviceRecipientTypes, contactMediaTypes } = UpdateContactOptionsSchema.parse(req.body);
    await db('clinic_contact_options')
      .insert({
        id: db.raw('gen_random_uuid()'),
        clinic_id: req.clinicId,
        locations: JSON.stringify(locations ?? DEFAULT_LOCATIONS),
        programs: JSON.stringify(programs ?? DEFAULT_PROGRAMS),
        service_recipient_types: JSON.stringify(serviceRecipientTypes ?? DEFAULT_SERVICE_RECIPIENT_TYPES),
        contact_media_types: JSON.stringify(contactMediaTypes ?? DEFAULT_CONTACT_MEDIA_TYPES),
        created_at: new Date(), updated_at: new Date(),
      })
      .onConflict(['clinic_id'])
      .merge({
        locations: JSON.stringify(locations ?? DEFAULT_LOCATIONS),
        programs: JSON.stringify(programs ?? DEFAULT_PROGRAMS),
        service_recipient_types: JSON.stringify(serviceRecipientTypes ?? DEFAULT_SERVICE_RECIPIENT_TYPES),
        contact_media_types: JSON.stringify(contactMediaTypes ?? DEFAULT_CONTACT_MEDIA_TYPES),
        updated_at: new Date(),
      });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── Bulk Reassign ──
staffSettingsRoutes.post('/bulk-reassign', requireIdempotencyKey, idempotencyMiddleware(), adminWrite, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = BulkReassignSchema.parse(req.body);
    const count = await runBulkReassign({
      clinicId: req.clinicId,
      payload,
    });
    res.json(BulkReassignResponseSchema.parse({ ok: true, count }));
  } catch (e) {
    next(e);
  }
});

// ── Planned Transitions (future reallocation) ──

// GET /staff-settings/transitions — list all planned transitions
staffSettingsRoutes.get('/transitions', adminWrite, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transitions = await listPlannedTransitions(req.clinicId);
    res.json(PlannedTransitionsListResponseSchema.parse({ transitions }));
  } catch (e) { next(e); }
});

// GET /staff-settings/transitions/:id — get transition with assignments
staffSettingsRoutes.get('/transitions/:id', adminWrite, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const detail = await getPlannedTransitionDetail({
      clinicId: req.clinicId,
      transitionId: req.params.id,
    });
    res.json(PlannedTransitionDetailResponseSchema.parse(detail));
  } catch (e) { next(e); }
});

// POST /staff-settings/transitions — create a new transition plan
staffSettingsRoutes.post('/transitions', requireIdempotencyKey, idempotencyMiddleware(), adminWrite, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = CreateTransitionSchema.parse(req.body);
    const transition = await createPlannedTransition({
      clinicId: req.clinicId,
      userId: req.user!.id,
      payload,
    });
    res.status(201).json(PlannedTransitionMutationResponseSchema.parse({ transition }));
  } catch (e) { next(e); }
});

// PATCH /staff-settings/transitions/:id — update plan (add/remove assignments, change status)
staffSettingsRoutes.patch('/transitions/:id', requireIdempotencyKey, idempotencyMiddleware(), adminWrite, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = UpdateTransitionSchema.parse(req.body);
    await updatePlannedTransition({
      clinicId: req.clinicId,
      userId: req.user!.id,
      transitionId: req.params.id,
      payload,
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /staff-settings/transitions/:id/execute — execute the plan (move patients)
staffSettingsRoutes.post('/transitions/:id/execute', requireIdempotencyKey, idempotencyMiddleware(), adminWrite, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await executePlannedTransition({
      clinicId: req.clinicId,
      transitionId: req.params.id,
    });
    res.json(PlannedTransitionExecuteResponseSchema.parse({ ok: true, ...result }));
  } catch (e) { next(e); }
});

// DELETE /staff-settings/transitions/:id — cancel/delete a plan
staffSettingsRoutes.delete('/transitions/:id', requireIdempotencyKey, idempotencyMiddleware(), adminWrite, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { db } = await import('../../db/db');
    await db('planned_transitions').where({ id: req.params.id, clinic_id: req.clinicId }).update({ status: 'cancelled', deleted_at: new Date(), updated_at: new Date() });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── Clinical Policies ────────────────────────────────────────────────────────
staffSettingsRoutes.get('/clinical-policies', requireRole('admin', 'superadmin', 'clinician'), async (req, res, next) => {
  try { const { db } = await import('../../db/db'); const rows = await db('clinical_policies').where({ clinic_id: req.clinicId }).orderBy('name'); res.json({ policies: rows }); } catch (e) { next(e); }
});
staffSettingsRoutes.post('/clinical-policies', requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const { v4: uuidv4 } = await import('uuid');
    const { name, description, ruleType, parameters, llmContext, category } = CreateClinicalPolicySchema.parse(req.body);
    const [row] = await db('clinical_policies').insert({
      id: uuidv4(),
      clinic_id: req.clinicId, name, description: description ?? null,
      rule_type: ruleType ?? 'review_interval', parameters: JSON.stringify(parameters ?? {}),
      llm_context: llmContext ?? null, category: category ?? null,
      is_active: true, generates_alert: true, available_to_llm: true,
      created_at: new Date(), updated_at: new Date(),
    }).returning(CLINICAL_POLICY_COLUMNS);
    res.status(201).json({ policy: row });
  } catch (e) { next(e); }
});
staffSettingsRoutes.patch('/clinical-policies/:id', requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const body = UpdateClinicalPolicySchema.parse(req.body);
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.parameters !== undefined) patch.parameters = JSON.stringify(body.parameters);
    if (body.isActive !== undefined) patch.is_active = body.isActive;
    if (body.llmContext !== undefined) patch.llm_context = body.llmContext;
    if (body.category !== undefined) patch.category = body.category;
    if (body.generatesAlert !== undefined) patch.generates_alert = body.generatesAlert;
    if (body.availableToLlm !== undefined) patch.available_to_llm = body.availableToLlm;
    const [row] = await db('clinical_policies').where({ id: req.params.id, clinic_id: req.clinicId }).update(patch).returning(CLINICAL_POLICY_COLUMNS);
    res.json({ policy: row });
  } catch (e) { next(e); }
});
staffSettingsRoutes.delete('/clinical-policies/:id', requireRole('admin', 'superadmin'), async (req, res, next) => {
  try { const { db } = await import('../../db/db'); await db('clinical_policies').where({ id: req.params.id, clinic_id: req.clinicId }).delete(); res.json({ ok: true }); } catch (e) { next(e); }
});

registerAiContextRoutes(staffSettingsRoutes)

export default staffSettingsRoutes
