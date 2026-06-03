import { Router } from 'express'
import { z } from 'zod'
import multer from 'multer'
import path from 'path'
import type { Knex } from 'knex'
import { authMiddleware } from '../../middleware/authMiddleware'
import { tenantMiddleware } from '../../middleware/tenantMiddleware'
import { requireRole } from '../../middleware/rbacMiddleware'
import { getMyBranding, getAllBranding, upsertBranding } from './powerSettingsController'
import { retentionSettingRoutes } from './retentionSettingRoutes'
import { retentionApprovalRoutes } from './retentionApprovalRoutes'
import { sessionIdleSettingRoutes } from './sessionIdleSettingRoutes'
import { blobStorage } from '../../shared/blobStorage'
import { logger } from '../../utils/logger'
import { AppError, ErrorCode } from '../../shared/errors'
import { withTenantContext } from '../../shared/tenantContext'
import { canonicalizeModuleKey, LEGACY_MODULE_KEY_ALIASES } from '../../shared/moduleKeys'

// Local Zod schema (Phase R3b / CLAUDE.md §12) — both endpoints toggle
// a single boolean flag on either specialties or modules.
const EnabledToggleSchema = z.object({
  enabled: z.boolean(),
})

const LevelLabelPayloadSchema = z.object({
  level: z.number().int().min(1).max(10),
  label: z.string().trim().min(1).max(100),
})

const BulkLevelLabelsSchema = z.object({
  labels: z.array(LevelLabelPayloadSchema).min(1).max(10),
})

const LevelLabelResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  level: z.number().int().min(1).max(10),
  label: z.string(),
})

const LevelLabelsEnvelopeSchema = z.object({
  labels: z.array(LevelLabelResponseSchema),
})

const SubscriptionSummarySchema = z.object({
  id: z.string().uuid(),
  planType: z.string(),
  seats: z.number().int().nonnegative(),
  pricePerMonth: z.number(),
  pricePerYear: z.number().nullable(),
  discountPercent: z.number().nullable(),
  discountAmount: z.number().nullable(),
  status: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  renewalDate: z.string().nullable(),
  reminderDays: z.number().int().nonnegative(),
  notes: z.string().nullable(),
  updatedAt: z.string(),
})

const SubscriptionOverviewItemSchema = z.object({
  clinicId: z.string().uuid(),
  clinicName: z.string(),
  clinicEmail: z.string().nullable(),
  clinicIsActive: z.boolean(),
  subscription: SubscriptionSummarySchema.nullable(),
})

const SubscriptionOverviewEnvelopeSchema = z.object({
  subscriptions: z.array(SubscriptionOverviewItemSchema),
})

export const powerSettingsRoutes = Router()

interface LevelLabelRow {
  id: string
  clinic_id: string
  level: number
  label: string
}

interface ClinicOverviewRow {
  id: string
  name: string
  email: string | null
  is_active: boolean
}

interface SubscriptionRow {
  id: string
  plan_type: string
  seats: number
  price_per_month: string | number
  price_per_year: string | number | null
  discount_percent: string | number | null
  discount_amount: string | number | null
  status: string
  start_date: string
  end_date: string | null
  renewal_date: string | null
  reminder_days: number
  notes: string | null
  updated_at: string | Date
}

function mapLevelLabelRowToResponse(row: LevelLabelRow) {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    level: row.level,
    label: row.label,
  }
}

function toNullableNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function mapSubscriptionRowToSummary(row: SubscriptionRow) {
  const pricePerMonth = toNullableNumber(row.price_per_month) ?? 0
  const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at)
  return {
    id: row.id,
    planType: row.plan_type,
    seats: row.seats,
    pricePerMonth,
    pricePerYear: toNullableNumber(row.price_per_year),
    discountPercent: toNullableNumber(row.discount_percent),
    discountAmount: toNullableNumber(row.discount_amount),
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    renewalDate: row.renewal_date,
    reminderDays: row.reminder_days,
    notes: row.notes,
    updatedAt,
  }
}

type ClinicModuleRow = {
  module_key: string
  is_enabled: boolean
}

function collapseClinicModules(rows: ClinicModuleRow[]): Record<string, boolean> {
  const byCanonical: Record<string, boolean> = {}
  for (const row of rows) {
    const canonical = canonicalizeModuleKey(row.module_key)
    const existing = byCanonical[canonical]
    // Prefer explicit canonical rows over alias rows when both exist.
    if (row.module_key === canonical || existing === undefined) {
      byCanonical[canonical] = row.is_enabled
    }
  }
  return byCanonical
}

async function assertClinicExists(dbAdmin: Knex, clinicId: string): Promise<void> {
  const clinic = await dbAdmin('clinics')
    .where({ id: clinicId })
    .whereNull('deleted_at')
    .first('id')
  if (!clinic) {
    throw new AppError('Clinic not found', 404, ErrorCode.NOT_FOUND)
  }
}

async function loadLevelLabelsByClinic(dbAdmin: Knex, clinicId: string): Promise<LevelLabelRow[]> {
  await assertClinicExists(dbAdmin, clinicId)
  return dbAdmin('org_level_labels')
    .where({ clinic_id: clinicId })
    .orderBy('level', 'asc')
    .select('id', 'clinic_id', 'level', 'label') as Promise<LevelLabelRow[]>
}

async function writeLevelLabelsByClinic(
  dbAdmin: Knex,
  clinicId: string,
  labels: Array<{ level: number; label: string }>,
): Promise<LevelLabelRow[]> {
  await assertClinicExists(dbAdmin, clinicId)

  await dbAdmin.transaction(async (trx) => {
    for (const item of labels) {
      await trx('org_level_labels')
        .insert({
          id: trx.raw('gen_random_uuid()'),
          clinic_id: clinicId,
          level: item.level,
          label: item.label,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict(['clinic_id', 'level'])
        .merge({
          label: item.label,
          updated_at: new Date(),
        })
    }
  })

  return loadLevelLabelsByClinic(dbAdmin, clinicId)
}

// S1.1-DEFERRED-A: Logo upload now goes through the BlobStorage facade
// using memory storage. The returned URL is the same shape the frontend
// has always used (`/uploads/logos/...` for local backend), produced by
// blobStorage.getDownloadUrl, which falls through to S3 presigned URLs
// when BLOB_STORAGE_BACKEND=s3.
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.svg', '.webp']
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowed.includes(ext)) cb(null, true)
    else cb(new Error('Only PNG, JPG, SVG, or WebP images are allowed'))
  },
})

// NOTE: GET /branding/public is registered as a top-level app.get in
// server.ts (next to the FHIR metadata public endpoint). It cannot live
// inside this router because roleFeatureRoutes mounts at /api/v1 with a
// global authMiddleware that short-circuits sub-router public routes.

powerSettingsRoutes.use(authMiddleware, tenantMiddleware)

// BUG-374a — retention configuration sub-router. GET admin-readable;
// PUT superadmin-only (Q3b policy). Mounted at /retention.
powerSettingsRoutes.use('/retention', retentionSettingRoutes)

// BUG-374b Part 2 — manager-approval workflow (Q-F triple-lock 3rd gate).
// POST /retention/manager-approval — approve; DELETE — revoke. Both
// require admin or superadmin; service enforces segregation of duties
// (approver != enabler).
powerSettingsRoutes.use('/retention/manager-approval', retentionApprovalRoutes)

// BUG-P2 — per-clinic session-idle-timeout (PRES-6 DH-3869).
// GET admin-readable; PUT superadmin-only.
powerSettingsRoutes.use('/session-idle', sessionIdleSettingRoutes)

// Any authenticated user can fetch their own clinic's branding
powerSettingsRoutes.get('/branding/me', getMyBranding)

// Superadmin-only: list all subscriber branding
powerSettingsRoutes.get(
  '/branding',
  requireRole('superadmin'),
  getAllBranding,
)

// Superadmin-only: upsert branding for a specific clinic
powerSettingsRoutes.put(
  '/branding/:clinicId',
  requireRole('superadmin'),
  upsertBranding,
)

// Superadmin-only: clinic-scoped org level labels live in Power Settings.
// This replaces the old Org Settings UI ownership to keep governance
// controls in one place while preserving per-clinic storage.
//
// Compatibility:
// - `/level-labels/:clinicId` is the canonical superadmin path.
// - `/clinics/:clinicId/level-labels` is preserved for backward compatibility.
// - `/level-labels` keeps admin/superadmin write for the caller's own clinic
//   (legacy org-settings parity for same-clinic edits).
powerSettingsRoutes.get(
  '/level-labels',
  requireRole('admin', 'superadmin'),
  async (req, res, next) => {
    try {
      const { dbAdmin } = await import('../../db/db')
      const rows = await loadLevelLabelsByClinic(dbAdmin, req.clinicId)
      res.json(LevelLabelsEnvelopeSchema.parse({
        labels: rows.map(mapLevelLabelRowToResponse),
      }))
    } catch (err) { next(err) }
  },
)

powerSettingsRoutes.put(
  '/level-labels',
  requireRole('admin', 'superadmin'),
  async (req, res, next) => {
    try {
      const { dbAdmin } = await import('../../db/db')
      const parsed = BulkLevelLabelsSchema.parse(req.body)
      const rows = await writeLevelLabelsByClinic(dbAdmin, req.clinicId, parsed.labels)
      res.json(LevelLabelsEnvelopeSchema.parse({
        labels: rows.map(mapLevelLabelRowToResponse),
      }))
    } catch (err) { next(err) }
  },
)

powerSettingsRoutes.get(
  '/level-labels/:clinicId',
  requireRole('superadmin'),
  async (req, res, next) => {
    try {
      const { dbAdmin } = await import('../../db/db')
      const rows = await withTenantContext(
        req.params.clinicId,
        () => loadLevelLabelsByClinic(dbAdmin, req.params.clinicId),
        req.user?.id,
      )
      res.json(LevelLabelsEnvelopeSchema.parse({
        labels: rows.map(mapLevelLabelRowToResponse),
      }))
    } catch (err) { next(err) }
  },
)

powerSettingsRoutes.put(
  '/level-labels/:clinicId',
  requireRole('superadmin'),
  async (req, res, next) => {
    try {
      const { dbAdmin } = await import('../../db/db')
      const parsed = BulkLevelLabelsSchema.parse(req.body)
      const rows = await withTenantContext(
        req.params.clinicId,
        () => writeLevelLabelsByClinic(dbAdmin, req.params.clinicId, parsed.labels),
        req.user?.id,
      )
      res.json(LevelLabelsEnvelopeSchema.parse({
        labels: rows.map(mapLevelLabelRowToResponse),
      }))
    } catch (err) { next(err) }
  },
)

powerSettingsRoutes.get(
  '/clinics/:clinicId/level-labels',
  requireRole('superadmin'),
  async (req, res, next) => {
    try {
      const { dbAdmin } = await import('../../db/db')
      const rows = await withTenantContext(
        req.params.clinicId,
        () => loadLevelLabelsByClinic(dbAdmin, req.params.clinicId),
        req.user?.id,
      )
      res.json(LevelLabelsEnvelopeSchema.parse({
        labels: rows.map(mapLevelLabelRowToResponse),
      }))
    } catch (err) { next(err) }
  },
)

powerSettingsRoutes.put(
  '/clinics/:clinicId/level-labels',
  requireRole('superadmin'),
  async (req, res, next) => {
    try {
      const { dbAdmin } = await import('../../db/db')
      const parsed = BulkLevelLabelsSchema.parse(req.body)
      const rows = await withTenantContext(
        req.params.clinicId,
        () => writeLevelLabelsByClinic(dbAdmin, req.params.clinicId, parsed.labels),
        req.user?.id,
      )
      res.json(LevelLabelsEnvelopeSchema.parse({
        labels: rows.map(mapLevelLabelRowToResponse),
      }))
    } catch (err) { next(err) }
  },
)

// Upload logo image (admin or superadmin)
// S1.1-DEFERRED-A: writes via BlobStorage facade. Key is stable
// (logos/<clinic_id-or-global>-<timestamp>.<ext>) so the same upload
// over-writes the previous logo cleanly when needed.
powerSettingsRoutes.post(
  '/branding/logo',
  requireRole('admin', 'superadmin'),
  logoUpload.single('logo'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' })
        return
      }
      const ext = path.extname(req.file.originalname).toLowerCase()
      const scope = req.clinicId ?? 'global'
      const storageKey = `logos/${scope}-${Date.now()}${ext}`
      const put = await blobStorage.put(storageKey, req.file.buffer, req.file.mimetype)
      const url = await blobStorage.getDownloadUrl(put.key, { filename: req.file.originalname })
      res.json({ url, filename: storageKey })
    } catch (err) { next(err) }
  },
)

// ── Subscription Module Management ───────────────────────────────────────────

// GET /power-settings/subscriptions/overview
// Superadmin-only platform view: onboarded clinics + latest subscription
// details per clinic.
powerSettingsRoutes.get('/subscriptions/overview', requireRole('superadmin'), async (req, res, next) => {
  try {
    const { dbAdmin } = await import('../../db/db')
    const clinics = await dbAdmin('clinics')
      .whereNull('deleted_at')
      .select('id', 'name', 'email', 'is_active')
      .orderBy('name', 'asc') as ClinicOverviewRow[]

    const subscriptions: Array<z.infer<typeof SubscriptionOverviewItemSchema>> = []
    for (const clinic of clinics) {
      // Execute clinic-by-clinic to avoid opening N tenant transactions at
      // once when platform has many onboarded clinics.
      const rows = await withTenantContext(
        clinic.id,
        () => dbAdmin('subscriptions')
          .where({ clinic_id: clinic.id })
          .select(
            'id',
            'plan_type',
            'seats',
            'price_per_month',
            'price_per_year',
            'discount_percent',
            'discount_amount',
            'status',
            'start_date',
            'end_date',
            'renewal_date',
            'reminder_days',
            'notes',
            'updated_at',
          )
          .orderBy('created_at', 'desc') as Promise<SubscriptionRow[]>,
        req.user?.id,
      )
      const latest = rows[0] ?? null
      subscriptions.push({
        clinicId: clinic.id,
        clinicName: clinic.name,
        clinicEmail: clinic.email,
        clinicIsActive: clinic.is_active,
        subscription: latest ? mapSubscriptionRowToSummary(latest) : null,
      })
    }

    res.json(SubscriptionOverviewEnvelopeSchema.parse({ subscriptions }))
  } catch (err) { next(err) }
})

// GET /power-settings/subscriptions/me/modules — current user's clinic modules
powerSettingsRoutes.get('/subscriptions/me/modules', async (req, res, next) => {
  try {
    const clinicId = req.clinicId
    if (!clinicId) { res.json({ modules: {} }); return }
    const { dbAdmin } = await import('../../db/db')
    const rows = await dbAdmin('clinic_modules')
      .where({ clinic_id: clinicId })
      .select('module_key', 'is_enabled') as ClinicModuleRow[]
    res.json({ modules: collapseClinicModules(rows) })
  } catch (err) { next(err) }
})

// GET /power-settings/subscriptions/:clinicId/modules
// Superadmin-only cross-clinic read. Must run in target-clinic tenant context
// so FORCE RLS policies resolve against the selected subscriber.
powerSettingsRoutes.get('/subscriptions/:clinicId/modules', requireRole('superadmin'), async (req, res, next) => {
  try {
    const { dbAdmin } = await import('../../db/db')
    const rows = await withTenantContext(
      req.params.clinicId,
      () => dbAdmin('clinic_modules')
        .where({ clinic_id: req.params.clinicId })
        .select('module_key', 'is_enabled'),
      req.user?.id,
    ) as ClinicModuleRow[]
    res.json({ modules: collapseClinicModules(rows) })
  } catch (err) { next(err) }
})

// ── Clinical Specialty Toggles ────────────────────────────────────────────
//
// Each clinic has a `enabled_specialties text[]` column (added in Phase 0
// of the multi-specialty expansion). The frontend ModuleContext reads
// this set via /staff/me and uses it as one of three inputs to the
// visibility intersection (clinic ∩ staff ∩ patient episodes).
//
// These endpoints let a superadmin toggle each specialty for a target
// clinic from the PowerSettings UI. Self-service: a clinic admin can
// also manage their own clinic's specialties via the /me endpoint.

const ALL_SPECIALTY_CODES = [
  'mental_health',
  'general_medicine',
  'endocrinology',
  'paediatrics',
  'obstetrics_gynaecology',
  'surgery',
  'oncology',
] as const

// ── Clinic specialty enablement ──────────────────────────────────────────
//
// The canonical store for per-clinic enabled specialties is the
// `clinic_enabled_specialties` junction table created in
// 20260420000000_specialties_core.ts. It has:
//   - RLS policy on clinic_id
//   - UNIQUE(clinic_id, specialty_code) for idempotent upserts
//   - FK to specialties(code) so invalid codes fail fast
//   - enabled_by FK to staff(id) for attribution
//
// Earlier revisions of this route wrote to a planned `clinics.enabled_
// specialties` text array column that was never actually created in
// any migration. The READ path (staff/me → ModuleContext) always used
// the junction table, so the toggle silently did nothing and every
// PUT/GET 500'd with "column does not exist". Routed through the
// junction table end-to-end fixes both.

async function listEnabledSpecialties(clinicId: string): Promise<Array<{ code: string; display: string }>> {
  const { dbAdmin } = await import('../../db/db')
  const rows = await dbAdmin('clinic_enabled_specialties as ces')
    .join('specialties as sp', 'sp.code', 'ces.specialty_code')
    .where({ 'ces.clinic_id': clinicId })
    .select('ces.specialty_code', 'sp.display')
    .orderBy('sp.sort_order', 'asc')
  return rows.map((r) => ({ code: r.specialty_code as string, display: r.display as string }))
}

powerSettingsRoutes.get('/specialties/me', async (req, res, next) => {
  try {
    const clinicId = req.clinicId
    if (!clinicId) { res.json({ enabledSpecialties: [] }); return }
    const items = await listEnabledSpecialties(clinicId)
    res.json({ enabledSpecialties: items.map((i) => i.code) })
  } catch (err) { next(err) }
})

powerSettingsRoutes.get('/specialties/:clinicId', async (req, res, next) => {
  try {
    const items = await listEnabledSpecialties(req.params.clinicId)
    res.json({ enabledSpecialties: items.map((i) => i.code) })
  } catch (err) { next(err) }
})

powerSettingsRoutes.put('/specialties/:clinicId/:specialtyCode',
  requireRole('admin', 'superadmin'),
  async (req, res, next) => {
    try {
      const { dbAdmin } = await import('../../db/db')
      const { enabled } = EnabledToggleSchema.parse(req.body)
      const code = req.params.specialtyCode
      const clinicId = req.params.clinicId
      if (!ALL_SPECIALTY_CODES.includes(code as (typeof ALL_SPECIALTY_CODES)[number])) {
        res.status(400).json({ error: `Unknown specialty code: ${code}` })
        return
      }

      if (enabled) {
        // Idempotent upsert — the unique constraint on
        // (clinic_id, specialty_code) makes ON CONFLICT DO NOTHING safe
        // for concurrent toggles.
        await dbAdmin('clinic_enabled_specialties')
          .insert({
            clinic_id: clinicId,
            specialty_code: code,
            enabled_by: req.user?.id ?? null,
            enabled_at: new Date(),
          })
          .onConflict(['clinic_id', 'specialty_code'])
          .ignore()
      } else {
        await dbAdmin('clinic_enabled_specialties')
          .where({ clinic_id: clinicId, specialty_code: code })
          .delete()
      }

      // Audit log attribution so "who turned surgery off for clinic X"
      // is answerable later.
      try {
        const auditLogService = (await import('../../utils/audit')).default
        await auditLogService.logUpdate({
          clinicId,
          userId: req.user?.id ?? clinicId,
          tableName: 'clinic_enabled_specialties',
          recordId: `${clinicId}:${code}`,
          oldData: {},
          newData: { specialty_code: code, enabled },
        })
      } catch (err) {
        // BUG-517 (cascade-discovered) — audit-write swallow on
        // clinic specialty enable/disable. Per BUG-443 precedent:
        // mutation already committed; log but do not block. The
        // attribution row is forensic-evidence for "who turned
        // surgery off for clinic X" investigations.
        logger.warn(
          {
            err,
            kind: 'audit_write_failure',
            action: 'specialty_toggle',
            clinicId,
            specialtyCode: code,
            enabled,
            actorStaffId: req.user?.id,
          },
          'BUG-517: audit write failed for clinic_enabled_specialties toggle; mutation succeeded but audit row missing',
        )
      }

      const items = await listEnabledSpecialties(clinicId)
      res.json({ enabledSpecialties: items.map((i) => i.code) })
    } catch (err) { next(err) }
  },
)

// ──────────────────────────────────────────────────────────────────────
// Phase 0.5.C — Access Administrators (nominated + delegated per clinic)
// ──────────────────────────────────────────────────────────────────────
//
// Two endpoints:
//   GET  /clinics/:clinicId/access-admins  — any admin/superadmin can view
//   PUT  /clinics/:clinicId/access-admins  — superadmin ONLY
//
// The PUT body is validated by PowerAccessAdminsSchema: optional staff
// ids (either may be null to clear), distinct when both set, and each
// must be an ACTIVE staff member of the target clinic whose role is
// NOT operational-only. The DB-layer trigger from 0.5.A
// (clinics_access_admin_same_clinic_check) provides Layer-B defence.

const PowerAccessAdminsSchema = z.object({
  nominatedAdminStaffId: z.string().uuid().nullable(),
  delegatedAdminStaffId: z.string().uuid().nullable(),
});

// L5-absorb-1: dedicated endpoint for the Access Administrators panel
// staff picker. Returns active, non-operational staff of a specific
// clinic. Superadmin-only (this is cross-clinic visibility; regular
// admins use staff/lookup which is clinic-scoped). Filters server-side
// so the client never handles role strings.
powerSettingsRoutes.get(
  '/clinics/:clinicId/staff',
  requireRole('superadmin'),
  async (req, res, next) => {
    try {
      const { dbAdmin } = await import('../../db/db');
      const { OPERATIONAL_ONLY } = await import('@signacare/shared');
      const rows = await dbAdmin('staff')
        .where({ clinic_id: req.params.clinicId, is_active: true })
        .whereNotIn('role', Array.from(OPERATIONAL_ONLY))
        .select('id', 'given_name', 'family_name', 'email', 'role')
        .orderBy(['family_name', 'given_name']);
      res.json(
        rows.map((r: { id: string; given_name: string; family_name: string; email: string; role: string }) => ({
          id: r.id,
          givenName: r.given_name,
          familyName: r.family_name,
          email: r.email,
          role: r.role,
        })),
      );
    } catch (err) { next(err); }
  },
);

powerSettingsRoutes.get(
  '/clinics/:clinicId/access-admins',
  requireRole('admin', 'superadmin'),
  async (req, res, next) => {
    try {
      const { dbAdmin } = await import('../../db/db');
      const clinic = await dbAdmin('clinics')
        .where({ id: req.params.clinicId })
        .select('id', 'nominated_admin_staff_id', 'delegated_admin_staff_id')
        .first();
      if (!clinic) { res.status(404).json({ error: 'Clinic not found' }); return; }

      const ids = [
        clinic.nominated_admin_staff_id,
        clinic.delegated_admin_staff_id,
      ].filter((x): x is string => typeof x === 'string');

      const staff = ids.length > 0
        ? await dbAdmin('staff')
            .whereIn('id', ids)
            .select('id', 'given_name', 'family_name', 'role', 'email')
        : [];

      const byId = new Map<string, { id: string; givenName: string; familyName: string; role: string; email: string }>();
      for (const s of staff) {
        byId.set(s.id, {
          id: s.id,
          givenName: s.given_name,
          familyName: s.family_name,
          role: s.role,
          email: s.email,
        });
      }

      res.json({
        nominatedAdmin: clinic.nominated_admin_staff_id ? byId.get(clinic.nominated_admin_staff_id) ?? null : null,
        delegatedAdmin: clinic.delegated_admin_staff_id ? byId.get(clinic.delegated_admin_staff_id) ?? null : null,
      });
    } catch (err) { next(err); }
  },
);

powerSettingsRoutes.put(
  '/clinics/:clinicId/access-admins',
  requireRole('superadmin'),
  async (req, res, next) => {
    try {
      // L4-absorb-1: actor identity must be resolvable. Empty-string
      // userId would produce an unattributable audit row.
      if (!req.user?.id) {
        res.status(401).json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' });
        return;
      }

      const parsed = PowerAccessAdminsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid body',
          code: 'VALIDATION_ERROR',
          details: { issues: parsed.error.issues },
        });
        return;
      }
      const { nominatedAdminStaffId, delegatedAdminStaffId } = parsed.data;

      // Distinct-slot rule — surface as 400 rather than letting the
      // DB CHECK constraint return a 500-adjacent error shape.
      if (
        nominatedAdminStaffId !== null
        && delegatedAdminStaffId !== null
        && nominatedAdminStaffId === delegatedAdminStaffId
      ) {
        res.status(400).json({
          error: 'Nominated and delegated admin must be different staff',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      const { dbAdmin } = await import('../../db/db');
      const clinicId = req.params.clinicId;

      // Clinic must exist
      const clinicExists = await dbAdmin('clinics').where({ id: clinicId }).first('id');
      if (!clinicExists) { res.status(404).json({ error: 'Clinic not found' }); return; }

      // Both candidates must be (a) active staff, (b) of THIS clinic,
      // (c) NOT operational-only (receptionist/readonly). The same-
      // clinic check is also enforced by the DB trigger from 0.5.A;
      // this pre-check gives a clean 400 rather than a 500 for the
      // wrong-clinic foot-gun.
      const candidateIds = [nominatedAdminStaffId, delegatedAdminStaffId]
        .filter((x): x is string => typeof x === 'string');
      if (candidateIds.length > 0) {
        const { OPERATIONAL_ONLY } = await import('@signacare/shared');
        const rows = await dbAdmin('staff')
          .whereIn('id', candidateIds)
          .select('id', 'clinic_id', 'role', 'is_active');
        for (const id of candidateIds) {
          const r = rows.find((row: { id: string }) => row.id === id);
          if (!r) {
            res.status(400).json({
              error: `Staff ${id} not found`,
              code: 'VALIDATION_ERROR',
            });
            return;
          }
          if (r.clinic_id !== clinicId) {
            res.status(400).json({
              error: `Staff ${id} is not a member of clinic ${clinicId}`,
              code: 'VALIDATION_ERROR',
            });
            return;
          }
          if (!r.is_active) {
            res.status(400).json({
              error: `Staff ${id} is inactive`,
              code: 'VALIDATION_ERROR',
            });
            return;
          }
          if (OPERATIONAL_ONLY.has(r.role)) {
            res.status(400).json({
              error: `Staff ${id} is operational-only (role=${r.role}) and cannot be nominated`,
              code: 'VALIDATION_ERROR',
            });
            return;
          }
        }
      }

      // Snapshot before for audit diff
      const before = await dbAdmin('clinics')
        .where({ id: clinicId })
        .select('nominated_admin_staff_id', 'delegated_admin_staff_id')
        .first();

      await dbAdmin('clinics')
        .where({ id: clinicId })
        .update({
          nominated_admin_staff_id: nominatedAdminStaffId,
          delegated_admin_staff_id: delegatedAdminStaffId,
          updated_at: new Date(),
        });

      // L4 clinical-safety requirement: access-admin change is a
      // clinical-governance event. Write audit row with full diff.
      try {
        const { writeAuditLog } = await import('../../utils/audit');
        await writeAuditLog(
          {
            clinicId,
            userId: req.user.id,
            ipAddress: req.ip,
          },
          {
            tableName: 'clinics',
            recordId: clinicId,
            action: 'UPDATE',
            oldValues: before,
            newValues: {
              nominated_admin_staff_id: nominatedAdminStaffId,
              delegated_admin_staff_id: delegatedAdminStaffId,
            },
          },
        );
      } catch (err) {
        // BUG-517 — audit-write swallow on access-admin change.
        // L4 clinical-safety requirement (clinical-governance event).
        // BUG-283 outbox is the eventual-consistency safety net, but
        // the synchronous-write failure must be observable in case
        // outbox itself is degraded. Mutation already committed;
        // do not block the request.
        logger.warn(
          {
            err,
            kind: 'audit_write_failure',
            action: 'admin_override',
            clinicId,
            nominatedAdminStaffId,
            delegatedAdminStaffId,
            actorStaffId: req.user.id,
          },
          'BUG-517: audit write failed for clinics access-admin update; BUG-283 outbox is the safety net but synchronous write failed',
        );
      }

      res.json({ ok: true });
    } catch (err) { next(err); }
  },
);

// PUT /power-settings/subscriptions/:clinicId/modules/:moduleKey
// Superadmin-only cross-clinic write. Runs in target-clinic tenant context
// to satisfy FORCE RLS checks when mutating another subscriber's module set.
powerSettingsRoutes.put('/subscriptions/:clinicId/modules/:moduleKey', requireRole('superadmin'), async (req, res, next) => {
  try {
    const { dbAdmin } = await import('../../db/db')
    const { randomUUID } = await import('crypto')
    const { enabled } = EnabledToggleSchema.parse(req.body)
    const moduleKey = canonicalizeModuleKey(req.params.moduleKey)
    const clinicId = req.params.clinicId

    await withTenantContext(clinicId, async () => {
      // Mutual exclusivity for referral modules:
      // When enabling referral-solo, auto-disable referral-team and vice versa
      const REFERRAL_MODULES = ['referral-solo', 'referral-team']
      if (enabled && REFERRAL_MODULES.includes(moduleKey)) {
        const otherModule = moduleKey === 'referral-solo' ? 'referral-team' : 'referral-solo'
        await dbAdmin('clinic_modules')
          .where({ clinic_id: clinicId, module_key: otherModule })
          .update({ is_enabled: false, updated_at: new Date() })
      }

      await dbAdmin('clinic_modules')
        .insert({ id: randomUUID(), clinic_id: clinicId, module_key: moduleKey, is_enabled: enabled, updated_at: new Date() })
        .onConflict(['clinic_id', 'module_key'])
        .merge({ is_enabled: enabled, updated_at: new Date() })

      // Keep legacy alias rows in sync-free state (deleted) so read paths
      // cannot drift between old and canonical keys.
      const aliasKeys = Object.entries(LEGACY_MODULE_KEY_ALIASES)
        .filter(([, canonical]) => canonical === moduleKey)
        .map(([alias]) => alias)
      if (aliasKeys.length > 0) {
        await dbAdmin('clinic_modules')
          .where({ clinic_id: clinicId })
          .whereIn('module_key', aliasKeys)
          .del()
      }
    }, req.user?.id)

    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default powerSettingsRoutes
