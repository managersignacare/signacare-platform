// apps/api/src/repositories/staffRepository.ts
import { db } from "../../db/db";

/**
 * @schema-drift-exempt partial-shape
 * BUG-536 — DB has additional columns the interface does not yet declare:
 *   - `require_mfa` + `has_mfa_configured` (newer MFA-state model that
 *     supersedes mfa_enabled; both still exist while migration is in flight)
 *   - `outlook_calendar_id` (calendar-sync feature)
 *   - `digital_signature` (signed-document workflow)
 *   - `max_concurrent_sessions` (session-limit policy)
 * BUG-536 tracks resolving the MFA-column duplication and surfacing the
 * remaining feature columns (or formalising the projection).
 */
export interface StaffRow {
  id: string;
  clinic_id: string;
  given_name: string;
  family_name: string;
  preferred_name: string | null;
  email: string;
  password_hash: string;
  role: string;
  discipline: string | null;
  discipline_id: string | null;
  phone_mobile: string | null;
  phone_work: string | null;
  ahpra_number: string | null;
  prescriber_number: string | null;
  provider_number: string | null;
  hpii: string | null;
  qualifications: string | null;
  specialisation: string | null;
  employment_type: string | null;
  worker_type: string | null;
  mfa_enabled: boolean;
  mfa_secret: string | null;
  recovery_codes: string | null;
  is_active: boolean;
  must_change_password: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  outlook_email: string | null;
  outlook_refresh_token: string | null;
  outlook_token_expires_at: number | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface StaffSpecialtyRow {
  specialty_code: string;
  is_primary: boolean;
}

interface StaffSettingProfileTabRow {
  staff_id: string;
  setting_value: unknown;
}

/**
 * @schema-drift-exempt partial-shape
 * Intentional sub-projection used by listPendingUnsignedNotesByAuthor().
 * The query selects only `id`, `patient_id`, `note_type`, and
 * `note_date_time`.
 */
export interface PendingUnsignedNoteSummaryRow {
  id: string;
  patient_id: string;
  note_type: string;
  note_date_time: Date | string | null;
}

// Safe columns — never include password_hash, mfa_secret, recovery_codes, outlook_refresh_token
const SAFE_STAFF_COLUMNS = [
  'id', 'clinic_id', 'given_name', 'family_name', 'preferred_name', 'email', 'role',
  'discipline', 'discipline_id', 'phone_mobile', 'phone_work',
  'ahpra_number', 'prescriber_number', 'provider_number', 'hpii',
  'qualifications', 'specialisation', 'employment_type', 'worker_type',
  'mfa_enabled', 'is_active', 'failed_login_attempts', 'locked_until',
  'last_login_at', 'created_at', 'updated_at', 'deleted_at',
];

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

export class StaffRepository {
  async disciplineExistsForClinic(disciplineId: string, clinicId: string): Promise<boolean> {
    const row = await db('professional_disciplines')
      .where({ id: disciplineId, clinic_id: clinicId })
      .first('id');
    return Boolean(row?.id);
  }

  async getDisciplineNameForClinic(
    disciplineId: string,
    clinicId: string,
  ): Promise<string | null> {
    const row = await db('professional_disciplines')
      .where({ id: disciplineId, clinic_id: clinicId })
      .first<{ name: string }>('name');
    return row?.name ?? null;
  }

  /** Auth flow — returns password_hash for bcrypt compare. ONLY use in authService. */
  async findByEmail(email: string): Promise<StaffRow | undefined> {
    const normalizedEmail = email.trim().toLowerCase();

    // Identity lookup is case-insensitive and stable across historical
    // case-drift rows. If duplicates exist from legacy data, prefer the
    // clinic-bound nominated/delegated admin row first; otherwise pick
    // the oldest row deterministically so login does not drift across
    // clinics between requests.
    const row = await db<StaffRow>("staff as s")
      .leftJoin("clinics as nominated_clinic", function joinNominatedClinic() {
        this.on("nominated_clinic.nominated_admin_staff_id", "=", "s.id")
          .andOn("nominated_clinic.id", "=", "s.clinic_id");
      })
      .leftJoin("clinics as delegated_clinic", function joinDelegatedClinic() {
        this.on("delegated_clinic.delegated_admin_staff_id", "=", "s.id")
          .andOn("delegated_clinic.id", "=", "s.clinic_id");
      })
      .whereRaw("LOWER(s.email) = ?", [normalizedEmail])
      .whereNull("s.deleted_at")
      .select("s.*")
      .orderByRaw(
        [
          "CASE",
          "  WHEN nominated_clinic.id IS NOT NULL THEN 0",
          "  WHEN delegated_clinic.id IS NOT NULL THEN 1",
          "  ELSE 2",
          "END",
        ].join(" "),
      )
      .orderBy("s.created_at", "asc")
      .orderBy("s.id", "asc")
      .first();

    return (row as StaffRow | undefined) ?? undefined;
  }

  async findById(id: string): Promise<StaffRow | undefined> {
    const row = await db("staff")
      .where({ id, deleted_at: null })
      .select(...SAFE_STAFF_COLUMNS)
      .first() as StaffRow | undefined;
    return row ?? undefined;
  }

  /** Auth flow — returns password_hash for bcrypt compare. ONLY use in authService. */
  async findByIdWithHash(id: string): Promise<StaffRow | undefined> {
    const row = await db<StaffRow>("staff")
      .where({ id, deleted_at: null })
      .first();
    return row ?? undefined;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await db<StaffRow>("staff")
      .where({ id })
      .update({ password_hash: passwordHash, must_change_password: false, updated_at: new Date() });
  }

  async findByIdAndClinic(id: string, clinicId: string): Promise<StaffRow | undefined> {
    const row = await db("staff")
      .where({ id, clinic_id: clinicId, deleted_at: null })
      .select(...SAFE_STAFF_COLUMNS)
      .first() as StaffRow | undefined;
    return row ?? undefined;
  }

  async listByClinic(clinicId: string): Promise<StaffRow[]> {
    return db<StaffRow>("staff")
      .where({ clinic_id: clinicId, deleted_at: null })
      .select(...SAFE_STAFF_COLUMNS)
      .orderBy("family_name", "asc")
      .orderBy("given_name", "asc");
  }

  async listProfileTabVisibilityForMany(
    staffIds: string[],
    clinicId: string,
  ): Promise<Record<string, boolean>> {
    if (staffIds.length === 0) return {};
    const rows = await db<StaffSettingProfileTabRow>('staff_settings as ss')
      .join('staff as s', 's.id', 'ss.staff_id')
      .whereIn('ss.staff_id', staffIds)
      .andWhere('ss.setting_key', SETTINGS_PROFILE_TAB_VISIBLE_KEY)
      .andWhere('s.clinic_id', clinicId)
      .whereNull('s.deleted_at')
      .select('ss.staff_id', 'ss.setting_value');

    const out: Record<string, boolean> = {};
    for (const row of rows) {
      out[row.staff_id] = parseProfileTabVisibilitySetting(row.setting_value);
    }
    return out;
  }

  async getProfileTabVisibility(
    staffId: string,
    clinicId: string,
  ): Promise<boolean> {
    const row = await db<{ setting_value: unknown }>('staff_settings as ss')
      .join('staff as s', 's.id', 'ss.staff_id')
      .where({ 'ss.staff_id': staffId, 'ss.setting_key': SETTINGS_PROFILE_TAB_VISIBLE_KEY })
      .andWhere('s.clinic_id', clinicId)
      .whereNull('s.deleted_at')
      .first('ss.setting_value');
    return parseProfileTabVisibilitySetting(row?.setting_value);
  }

  async setProfileTabVisibility(
    staffId: string,
    visible: boolean,
  ): Promise<void> {
    await db('staff_settings')
      .insert({
        staff_id: staffId,
        setting_key: SETTINGS_PROFILE_TAB_VISIBLE_KEY,
        setting_value: visible,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict(['staff_id', 'setting_key'])
      .merge({
        setting_value: visible,
        updated_at: new Date(),
      });
  }

  async insert(data: Partial<StaffRow> & { id: string; clinic_id: string; email: string; password_hash: string; given_name: string; family_name: string; role: string }): Promise<StaffRow> {
    const now = new Date();
    // SECURITY: .returning(SAFE_STAFF_COLUMNS) — must NOT return password_hash,
    // mfa_secret, recovery_codes, outlook_refresh_token. Even though the
    // insert includes those fields, the returning() list controls what
    // Postgres sends back over the wire and what downstream code sees.
    const [row] = await db<StaffRow>("staff")
      .insert({
        ...data,
        failed_login_attempts: 0,
        locked_until: null,
        mfa_enabled: data.mfa_enabled ?? false,
        is_active: data.is_active ?? true,
        must_change_password: data.must_change_password ?? true,
        created_at: now,
        updated_at: now,
      })
      .returning(SAFE_STAFF_COLUMNS);
    return row as StaffRow;
  }

  async update(id: string, clinicId: string, data: Partial<StaffRow>): Promise<StaffRow | undefined> {
    const now = new Date();
    // SECURITY: .returning(SAFE_STAFF_COLUMNS) — see insert() comment.
    const [row] = await db<StaffRow>("staff")
      .where({ id, clinic_id: clinicId, deleted_at: null })
      .update({ ...data, updated_at: now })
      .returning(SAFE_STAFF_COLUMNS);
    return (row as StaffRow) ?? undefined;
  }

  async countPendingUnsignedNotesByAuthor(staffId: string, clinicId: string): Promise<number> {
    const row = await db('clinical_notes')
      .where('clinic_id', clinicId)
      .where('author_id', staffId)
      .where('status', 'draft')
      .whereNull('deleted_at')
      .count<{ cnt: string | number }>('* as cnt')
      .first();
    const rawCount = row?.cnt ?? 0;
    return typeof rawCount === 'number' ? rawCount : Number(rawCount);
  }

  async listPendingUnsignedNotesByAuthor(
    staffId: string,
    clinicId: string,
    limit = 5,
  ): Promise<PendingUnsignedNoteSummaryRow[]> {
    return db<PendingUnsignedNoteSummaryRow>('clinical_notes')
      .where('clinic_id', clinicId)
      .where('author_id', staffId)
      .where('status', 'draft')
      .whereNull('deleted_at')
      .orderBy('updated_at', 'desc')
      .select('id', 'patient_id', 'note_type', 'note_date_time')
      .limit(limit);
  }

  async incrementFailedLogins(id: string): Promise<void> {
    await db<StaffRow>("staff").where({ id }).increment("failed_login_attempts", 1);
  }

  async recordFailedLoginAttempt(
    id: string,
    maxAttempts: number,
    lockoutMinutes: number,
  ): Promise<{ failedLoginAttempts: number; lockedUntil: Date | null }> {
    const now = new Date();
    const [row] = await db<StaffRow>('staff')
      .where({ id })
      .update({
        failed_login_attempts: db.raw('failed_login_attempts + 1'),
        locked_until: db.raw(
          `CASE
             WHEN failed_login_attempts + 1 >= ?
               THEN GREATEST(COALESCE(locked_until, NOW()), NOW() + (? * INTERVAL '1 minute'))
             ELSE locked_until
           END`,
          [maxAttempts, lockoutMinutes],
        ),
        updated_at: now,
      })
      .returning(['failed_login_attempts', 'locked_until']);

    if (!row) {
      return { failedLoginAttempts: 0, lockedUntil: null };
    }
    return {
      failedLoginAttempts: Number(row.failed_login_attempts ?? 0),
      lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
    };
  }

  async resetFailedLogins(id: string): Promise<void> {
    await db<StaffRow>("staff").where({ id }).update({
      failed_login_attempts: 0, locked_until: null, updated_at: new Date(),
    });
  }

  async lockAccount(id: string, until: Date): Promise<void> {
    await db<StaffRow>("staff").where({ id }).update({ locked_until: until, updated_at: new Date() });
  }

  async enableMfa(id: string): Promise<void> {
    await db<StaffRow>("staff").where({ id }).update({ mfa_enabled: true, updated_at: new Date() });
  }

  async disableMfa(id: string): Promise<void> {
    await db<StaffRow>("staff").where({ id }).update({ mfa_enabled: false, mfa_secret: null, recovery_codes: null, updated_at: new Date() });
  }

  async setMfaSecret(id: string, secret: string): Promise<void> {
    await db<StaffRow>("staff").where({ id }).update({ mfa_secret: secret, updated_at: new Date() });
  }

  async setRecoveryCodes(id: string, codes: string[]): Promise<void> {
    await db<StaffRow>("staff").where({ id }).update({ recovery_codes: JSON.stringify(codes), updated_at: new Date() });
  }

  // ── Specialty enrolment (Phase 0 staff_specialties junction) ─────────────

  async listSpecialtiesForStaff(
    staffId: string,
    clinicId: string,
  ): Promise<Array<{ code: string; isPrimary: boolean }>> {
    const rows = await db('staff_specialties')
      .where({ staff_id: staffId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .orderBy('is_primary', 'desc')
      .orderBy('created_at', 'asc')
      .select('specialty_code', 'is_primary') as StaffSpecialtyRow[];
    return rows.map((row) => ({ code: row.specialty_code, isPrimary: !!row.is_primary }));
  }

  async listSpecialtiesForMany(
    staffIds: string[],
    clinicId: string,
  ): Promise<Record<string, Array<{ code: string; isPrimary: boolean }>>> {
    if (staffIds.length === 0) return {};
    const rows = await db('staff_specialties')
      .where({ clinic_id: clinicId })
      .whereIn('staff_id', staffIds)
      .whereNull('deleted_at')
      .orderBy('is_primary', 'desc')
      .orderBy('created_at', 'asc')
      .select('staff_id', 'specialty_code', 'is_primary') as Array<{ staff_id: string; specialty_code: string; is_primary: boolean }>;
    const grouped: Record<string, Array<{ code: string; isPrimary: boolean }>> = {};
    for (const r of rows) {
      (grouped[r.staff_id] ??= []).push({ code: r.specialty_code, isPrimary: !!r.is_primary });
    }
    return grouped;
  }

  /**
   * Replace the full specialty enrolment set for a staff member. Atomic:
   * runs inside a single transaction so readers never see a partial
   * update. Normalises `is_primary` — at most one row per staff has it
   * set; if the caller provides none, the first row wins.
   */
  async replaceSpecialtiesForStaff(
    staffId: string,
    clinicId: string,
    specialties: Array<{ code: string; isPrimary?: boolean }>,
    actorId: string | null,
  ): Promise<void> {
    // Dedupe by code so a buggy UI doesn't hand us duplicates.
    const byCode = new Map<string, { code: string; isPrimary: boolean }>();
    for (const s of specialties) {
      byCode.set(s.code, { code: s.code, isPrimary: !!s.isPrimary });
    }
    const normalised = Array.from(byCode.values());

    // Normalise is_primary: exactly one true if any rows exist.
    if (normalised.length > 0) {
      const primaries = normalised.filter((s) => s.isPrimary);
      if (primaries.length === 0) {
        normalised[0]!.isPrimary = true;
      } else if (primaries.length > 1) {
        // Keep only the first as primary.
        for (let i = 1; i < normalised.length; i++) {
          if (normalised[i]!.isPrimary) normalised[i]!.isPrimary = false;
        }
      }
    }

    await db.transaction(async (trx) => {
      // Soft delete existing enrolments rather than hard delete — keeps
      // an audit trail and avoids touching the created_at for rows we
      // are re-inserting.
      await trx('staff_specialties')
        .where({ staff_id: staffId, clinic_id: clinicId })
        .whereNull('deleted_at')
        .delete();

      if (normalised.length === 0) return;

      await trx('staff_specialties').insert(
        normalised.map((s) => ({
          clinic_id: clinicId,
          staff_id: staffId,
          specialty_code: s.code,
          is_primary: s.isPrimary,
          created_by: actorId,
          created_at: new Date(),
          updated_at: new Date(),
        })),
      );
    });
  }
}

export const staffRepository = new StaffRepository();
