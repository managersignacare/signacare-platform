// apps/api/src/routes/staffRoutes.ts
import { Router, NextFunction, Request, Response } from "express";
import { z } from "zod";
import {
  listStaffController,
  getStaffController,
  createStaffController,
  updateStaffController,
} from "./staffController";
import { AppError, ErrorCode } from "../../shared/errors";
import { authMiddleware } from "../../middleware/authMiddleware";
import { tenantMiddleware } from "../../middleware/tenantMiddleware";
import { requirePermission } from "../../middleware/rbacMiddleware";

export const staffRouter = Router();

staffRouter.use(authMiddleware, tenantMiddleware);

interface StaffLookupRow {
  id: string;
  given_name: string;
  family_name: string;
  email: string;
  role: string;
  discipline: string | null;
}

interface StaffSpecialtyRow {
  code: string;
  display: string;
  is_primary: boolean | number | null;
}

interface EnabledSpecialtyRow {
  code: string;
  display: string;
}

const SETTINGS_PROFILE_TAB_VISIBLE_KEY = 'settings_profile_tab_visible';

function parseProfileTabVisibilitySetting(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  if (value && typeof value === 'object') {
    const candidate = (value as { visible?: unknown }).visible;
    if (typeof candidate === 'boolean') return candidate;
  }
  return false;
}

const StaffLookupResponseSchema = z.object({
  id: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  email: z.string(),
  role: z.string(),
  discipline: z.string().nullable(),
});

function mapStaffLookupRowToResponse(row: StaffLookupRow): z.infer<typeof StaffLookupResponseSchema> {
  return {
    id: row.id,
    givenName: row.given_name,
    familyName: row.family_name,
    email: row.email,
    role: row.role,
    discipline: row.discipline ?? null,
  };
}

// Lightweight list for dropdowns (any authenticated user, names only)
staffRouter.get("/lookup", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { db } = await import("../../db/db");
    const { cachedQuery } = await import("../../utils/queryCache");
    let clinicId = req.clinicId;
    const requestedClinicId = typeof req.query.clinicId === 'string' ? req.query.clinicId : undefined;
    if (requestedClinicId) {
      const parsedClinicId = z.string().uuid().safeParse(requestedClinicId);
      if (!parsedClinicId.success) {
        return next(new AppError('clinicId must be a valid UUID', 422, ErrorCode.VALIDATION_ERROR));
      }
      const isSuperadmin = req.user?.role === 'superadmin';
      if (!isSuperadmin && parsedClinicId.data !== req.clinicId) {
        return next(new AppError('Forbidden', 403, ErrorCode.FORBIDDEN));
      }
      clinicId = parsedClinicId.data;
    }
    if (!clinicId) { res.status(400).json({ error: "No clinic" }); return; }
    await db.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
    const rows = await cachedQuery(`staff:lookup:${clinicId}`, 60, () =>
      db("staff as s")
        .where("s.clinic_id", clinicId)
        .whereNull("s.deleted_at")
        .andWhere("s.is_active", true)
        .select("s.id", "s.given_name", "s.family_name", "s.email", "s.role")
        .select(
          db.raw(
            `COALESCE(
              (
                SELECT pd.name
                FROM professional_disciplines pd
                WHERE pd.clinic_id = s.clinic_id
                  AND pd.id::text = s.discipline_id::text
                LIMIT 1
              ),
              (
                SELECT pd_any.name
                FROM professional_disciplines pd_any
                WHERE pd_any.id::text = s.discipline_id::text
                LIMIT 1
              ),
              s.discipline
            ) AS discipline`,
          ),
        )
        .orderBy("s.family_name", "asc")
    ) as StaffLookupRow[];
    res.json(z.array(StaffLookupResponseSchema).parse(rows.map(mapStaffLookupRowToResponse)));
  } catch (err) {
    next(err);
  }
});

// Current user's own staff profile (prescriber/AHPRA details)
//
// Response includes the caller's specialty enrollment and the clinic's
// enabled specialties. The frontend ModuleContext intersects these with
// the current patient's active specialties to decide which module tabs
// to render. Never fails if the specialty tables are empty — returns
// empty arrays so the existing mental-health product keeps working.
staffRouter.get("/me", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { db } = await import("../../db/db");
    const userId = req.user?.id;
    const clinicId = req.clinicId;
    if (!userId || !clinicId) { res.status(400).json({ error: "Not authenticated" }); return; }
    const row = await db("staff").where({ id: userId, clinic_id: clinicId }).whereNull('staff.deleted_at').first();
    if (!row) { res.status(404).json({ error: "Staff not found" }); return; }

    let disciplineName: string | null = null;
    if (typeof row.discipline_id === 'string' && row.discipline_id.trim().length > 0) {
      const scopedDiscipline = await db('professional_disciplines')
        .where({ id: row.discipline_id, clinic_id: clinicId })
        .first<{ name: string }>('name');
      if (scopedDiscipline?.name) {
        disciplineName = scopedDiscipline.name;
      } else {
        const globalDiscipline = await db('professional_disciplines')
          .where({ id: row.discipline_id })
          .first<{ name: string }>('name');
        disciplineName = globalDiscipline?.name ?? null;
      }
    }
    if (!disciplineName) {
      disciplineName = (row.discipline as string | null | undefined) ?? null;
    }
    let isPrescribingDisciplineEligible = false;
    if (disciplineName) {
      const eligibility = await db.raw<{ rows: Array<{ eligible: boolean }> }>(
        'SELECT is_prescribing_eligible_discipline(?) AS eligible',
        [disciplineName],
      );
      isPrescribingDisciplineEligible = eligibility.rows?.[0]?.eligible === true;
    }

    const specialties = await db<StaffSpecialtyRow>('staff_specialties as ss')
      .join('specialties as sp', 'sp.code', 'ss.specialty_code')
      .where({ 'ss.staff_id': userId, 'ss.clinic_id': clinicId })
      .whereNull('ss.deleted_at')
      .select('sp.code', 'sp.display', 'ss.is_primary')
      .orderBy('sp.sort_order');
    const enabledSpecialties = await db<EnabledSpecialtyRow>('clinic_enabled_specialties as ces')
      .join('specialties as sp', 'sp.code', 'ces.specialty_code')
      .where({ 'ces.clinic_id': clinicId })
      .select('sp.code', 'sp.display')
      .orderBy('sp.sort_order');
    const profileTabSettingRow = await db<{ setting_value: unknown }>('staff_settings')
      .where('staff_settings.staff_id', userId)
      .andWhere('staff_settings.setting_key', SETTINGS_PROFILE_TAB_VISIBLE_KEY)
      .first('setting_value');
    const settingsProfileTabVisible = parseProfileTabVisibilitySetting(profileTabSettingRow?.setting_value);

    res.json({
      id: row.id,
      givenName: row.given_name,
      familyName: row.family_name,
      email: row.email,
      role: row.role,
      discipline: row.discipline_id ?? null,
      phoneMobile: row.phone_mobile ?? null,
      phoneWork: row.phone_work ?? null,
      ahpraNumber: row.ahpra_number ?? null,
      prescriberNumber: row.prescriber_number ?? null,
      providerNumber: row.provider_number ?? null,
      hpii: row.hpii ?? null,
      qualifications: row.qualifications ?? null,
      specialisation: row.specialisation ?? null,
      settingsProfileTabVisible,
      isPrescribingDisciplineEligible,
      specialties: specialties.map((s) => ({ code: s.code, display: s.display, isPrimary: !!s.is_primary })),
      enabledSpecialties: enabledSpecialties.map((s) => ({ code: s.code, display: s.display })),
    });
  } catch (err) {
    next(err);
  }
});

// Update own profile — no staff:update permission required (self-service)
staffRouter.put("/me", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { db } = await import("../../db/db");
    const userId = req.user?.id;
    const clinicId = req.clinicId;
    if (!userId || !clinicId) { res.status(400).json({ error: "Not authenticated" }); return; }

    // Self-service: only credential fields, not role/isActive
    const { StaffSelfUpdateSchema } = await import('@signacare/shared');
    const selfBody = StaffSelfUpdateSchema.parse(req.body);
    const allowed = ['givenName', 'familyName', 'email', 'phoneMobile', 'phoneWork',
      'ahpraNumber', 'ahpraExpiry', 'prescriberNumber', 'providerNumber', 'hpii', 'qualifications', 'specialisation'] as const;
    const patch: Record<string, unknown> = { updated_at: new Date() };
    // Narrow via keyof: every value in `allowed` is a valid property of the
    // parsed schema (StaffSelfUpdate), so we can index safely.
    const selfBodyRec = selfBody as Record<typeof allowed[number], unknown>;
    for (const key of allowed) {
      if (selfBodyRec[key] !== undefined) {
        const col = key === 'givenName' ? 'given_name' : key === 'familyName' ? 'family_name'
          : key === 'phoneMobile' ? 'phone_mobile' : key === 'phoneWork' ? 'phone_work'
          : key === 'ahpraNumber' ? 'ahpra_number' : key === 'prescriberNumber' ? 'prescriber_number'
          : key === 'providerNumber' ? 'provider_number'
          : key; // hpii, qualifications, specialisation map 1:1
        patch[col] = selfBodyRec[key] ?? null;
      }
    }
    if (selfBody.discipline !== undefined) {
      const normalizedDisciplineId = selfBody.discipline.trim();
      if (normalizedDisciplineId.length === 0) {
        patch.discipline_id = null;
        patch.discipline = null;
      } else {
        const disciplineRow = await db('professional_disciplines')
          .where({ id: normalizedDisciplineId, clinic_id: clinicId })
          .first('id', 'name');
        if (!disciplineRow?.id) {
          return next(new AppError('Selected discipline is not valid for this clinic', 422, ErrorCode.VALIDATION_ERROR));
        }
        patch.discipline_id = normalizedDisciplineId;
        patch.discipline = disciplineRow.name;
      }
    }

    // SECURITY: explicit safe-column allowlist. Sensitive secret columns
    // (auth credentials, MFA material, OAuth tokens) are intentionally
    // omitted here. The authoritative list lives in staffRepository's
    // SAFE_STAFF_COLUMNS. Keep this list a strict subset of that one.
    const SAFE_COLS = [
      'id', 'clinic_id', 'given_name', 'family_name', 'preferred_name', 'email', 'role',
      'discipline', 'discipline_id', 'phone_mobile', 'phone_work',
      'ahpra_number', 'prescriber_number', 'provider_number', 'hpii',
      'qualifications', 'specialisation', 'employment_type', 'worker_type',
      'mfa_enabled', 'is_active', 'digital_signature', 'created_at', 'updated_at',
    ];
    const [row] = await db("staff").where({ id: userId, clinic_id: clinicId }).whereNull('staff.deleted_at').update(patch).returning(SAFE_COLS);
    if (!row) { res.status(404).json({ error: "Staff not found" }); return; }

    // Self-service specialty enrolment: same replace-all semantics as
    // PUT /staff/:id but scoped to the caller's own staff_id. Only
    // applied when the caller explicitly passes `specialties` (allowing
    // undefined to mean "leave alone").
    if (Array.isArray(selfBody.specialties)) {
      const { staffRepository } = await import('./staffRepository');
      await staffRepository.replaceSpecialtiesForStaff(
        userId, clinicId, selfBody.specialties, userId,
      );
    }
    const { staffRepository: repo } = await import('./staffRepository');
    const specialties = await repo.listSpecialtiesForStaff(userId, clinicId);
    const settingsProfileTabVisible = await repo.getProfileTabVisibility(userId, clinicId);

    res.json({
      id: row.id, givenName: row.given_name, familyName: row.family_name,
      email: row.email, role: row.role, discipline: row.discipline_id ?? null,
      phoneMobile: row.phone_mobile ?? null, phoneWork: row.phone_work ?? null,
      ahpraNumber: row.ahpra_number ?? null, prescriberNumber: row.prescriber_number ?? null,
      providerNumber: row.provider_number ?? null, hpii: row.hpii ?? null,
      qualifications: row.qualifications ?? null, specialisation: row.specialisation ?? null,
      settingsProfileTabVisible,
      specialties,
    });
  } catch (err) { next(err); }
});

// Digital signature — save and retrieve
// Uses dbAdmin to bypass RLS — signature is a personal setting scoped by user ID
staffRouter.get("/me/signature", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { dbAdmin } = await import("../../db/db");
    const row = await dbAdmin("staff").where({ id: req.user!.id, clinic_id: req.clinicId }).select("digital_signature").first();
    res.json({ signature: row?.digital_signature ?? null });
  } catch (err) { next(err); }
});

staffRouter.put("/me/signature", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { dbAdmin } = await import("../../db/db");
    const { logger } = await import("../../utils/logger");
    const { SignatureSchema } = await import('@signacare/shared');
    const { signature } = SignatureSchema.parse(req.body);
    const count = await dbAdmin("staff").where({ id: req.user!.id, clinic_id: req.clinicId }).update({ digital_signature: signature, updated_at: new Date() });
    if (count === 0) {
      logger.warn({ userId: req.user!.id, clinicId: req.clinicId }, 'Signature save: no rows updated');
      res.status(404).json({ error: 'Staff record not found' });
      return;
    }
    logger.info({ userId: req.user!.id, sigLen: signature.length }, 'Digital signature saved');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

staffRouter.get("/", requirePermission("staff:read"), listStaffController);
staffRouter.get("/:id", requirePermission("staff:read"), getStaffController);
staffRouter.post("/", requirePermission("staff:create"), createStaffController);
staffRouter.put("/:id", requirePermission("staff:update"), updateStaffController);
