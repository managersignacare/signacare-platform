// apps/api/src/services/staffService.ts
import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "crypto";
import type { AuthContext } from "@signacare/shared";
import bcrypt from "bcryptjs";
import { StaffRepository, StaffRow } from "./staffRepository";
import { HttpError } from "../../shared/errors";
import { blacklistAllUserTokens } from "../../middleware/jwtBlacklist";
import { AuthRepository } from "../auth/authRepository";
import {
  assertPasswordNotBreached,
  generateNonBreachedPassword,
} from "../auth/passwordBreachService";
import { writeAuditLog } from "../../utils/audit";
import { logger } from "../../utils/logger";
import { shouldEnforceStaffDeactivationPendingNotes } from "../../shared/staffDeactivationPendingNotesPolicy";
import { invalidateCache } from "../../utils/queryCache";
import { assertSuperadminRoleMutationAllowed } from "../../shared/superadminPolicy";

/** Generate a random password that satisfies the StaffCreateSchema regex requirements. */
function generateStrongTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*';
  const pick = (chars: string) => chars[randomBytes(1)[0]! % chars.length]!;
  // Guarantee at least one of each required class
  const required = [pick(upper), pick(lower), pick(digits), pick(special)];
  // Fill remaining 8 chars from all classes
  const all = upper + lower + digits + special;
  for (let i = 0; i < 8; i++) required.push(pick(all));
  // Shuffle
  for (let i = required.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1);
    [required[i], required[j]] = [required[j]!, required[i]!];
  }
  return required.join('');
}

export interface StaffResponse {
  id: string;
  clinicId: string;
  givenName: string;
  familyName: string;
  email: string;
  role: string;
  isActive: boolean;
  discipline?: string;
  phoneMobile?: string;
  phoneWork?: string;
  ahpraNumber?: string;
  ahpraExpiry?: string;
  prescriberNumber?: string;
  providerNumber?: string;
  hpii?: string;
  qualifications?: string;
  specialisation?: string;
  specialties?: Array<{ code: string; isPrimary: boolean }>;
  settingsProfileTabVisible: boolean;
  mfaEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapStaffRowToResponse(
  row: StaffRow,
  specialties?: Array<{ code: string; isPrimary: boolean }>,
  settingsProfileTabVisible = false,
): StaffResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    givenName: row.given_name,
    familyName: row.family_name,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
    discipline: row.discipline_id ?? undefined,
    phoneMobile: row.phone_mobile ?? undefined,
    phoneWork: row.phone_work ?? undefined,
    ahpraNumber: row.ahpra_number ?? undefined,
    ahpraExpiry: undefined, // stored in qualifications JSON
    prescriberNumber: row.prescriber_number ?? undefined,
    providerNumber: row.provider_number ?? undefined,
    hpii: row.hpii ?? undefined,
    qualifications: row.qualifications ?? undefined,
    specialisation: row.specialisation ?? undefined,
    specialties: specialties ?? [],
    settingsProfileTabVisible,
    mfaEnabled: row.mfa_enabled,
    createdAt: row.created_at?.toISOString?.() ?? String(row.created_at),
    updatedAt: row.updated_at?.toISOString?.() ?? String(row.updated_at),
  };
}

export class StaffService {
  constructor(private readonly repo: StaffRepository) {}

  private async normalizeAndResolveDiscipline(
    clinicId: string,
    disciplineId: string | undefined | null,
  ): Promise<{ disciplineId: string | null; disciplineName: string | null }> {
    const normalizedDisciplineId = disciplineId?.trim() ?? '';
    if (!normalizedDisciplineId) {
      return { disciplineId: null, disciplineName: null };
    }
    const disciplineName = await this.repo.getDisciplineNameForClinic(
      normalizedDisciplineId,
      clinicId,
    );
    if (!disciplineName) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'Selected discipline is not valid for this clinic');
    }
    return { disciplineId: normalizedDisciplineId, disciplineName };
  }

  private async invalidateLookupCache(clinicId: string): Promise<void> {
    try {
      await invalidateCache(`staff:lookup:${clinicId}`);
    } catch (err) {
      logger.warn(
        { err, clinicId },
        "Staff lookup cache invalidation failed",
      );
    }
  }

  async listStaff(clinicId: string): Promise<StaffResponse[]> {
    const rows = await this.repo.listByClinic(clinicId);
    const specMap = await this.repo.listSpecialtiesForMany(
      rows.map((r) => r.id),
      clinicId,
    );
    const profileTabMap = await this.repo.listProfileTabVisibilityForMany(
      rows.map((r) => r.id),
      clinicId,
    );
    return rows.map((r) =>
      mapStaffRowToResponse(
        r,
        specMap[r.id] ?? [],
        profileTabMap[r.id] ?? false,
      ),
    );
  }

  async getStaff(clinicId: string, id: string): Promise<StaffResponse> {
    const row = await this.repo.findByIdAndClinic(id, clinicId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "Staff not found");
    const specialties = await this.repo.listSpecialtiesForStaff(id, clinicId);
    const settingsProfileTabVisible = await this.repo.getProfileTabVisibility(id, clinicId);
    return mapStaffRowToResponse(row, specialties, settingsProfileTabVisible);
  }

  async createStaff(clinicId: string, dto: {
    givenName: string; familyName: string; email: string; password?: string;
    role?: string; discipline?: string; phone?: string; phoneMobile?: string; phoneWork?: string;
    ahpraNumber?: string; ahpraExpiry?: string; isPrescriber?: boolean;
    prescriberNumber?: string; providerNumber?: string;
    providerNumbers?: { number: string; location?: string; type: string }[];
    hpii?: string; specialisation?: string;
    phiProvider?: string; phiNumber?: string;
    settingsProfileTabVisible?: boolean;
    specialties?: Array<{ code: string; isPrimary?: boolean }>;
  }, actorAuth?: AuthContext): Promise<StaffResponse & { temporaryPassword?: string }> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const targetRole = (dto.role ?? 'clinician').toLowerCase();
    assertSuperadminRoleMutationAllowed({
      actorAuth,
      existingRole: null,
      targetRole,
      targetEmail: normalizedEmail,
    });

    const resolvedDiscipline = await this.normalizeAndResolveDiscipline(
      clinicId,
      dto.discipline,
    );

    // Check for duplicate email
    const existing = await this.repo.findByEmail(normalizedEmail);
    if (existing) throw new HttpError(409, "DUPLICATE_EMAIL", "A staff member with this email already exists");

    // Generate a strong temporary password when none provided. The temp password
    // is returned to the admin ONE TIME so they can give it to the new staff member.
    const passwordBreachAuth: AuthContext = actorAuth ?? {
      staffId: 'system',
      clinicId,
      role: 'system',
      permissions: [],
    };

    const isAutoPassword = !dto.password;
    const tempPassword = dto.password
      ?? await generateNonBreachedPassword(
        passwordBreachAuth,
        generateStrongTempPassword,
        { surface: 'staff.create.autogenerated-password' },
      );
    if (dto.password) {
      await assertPasswordNotBreached(
        passwordBreachAuth,
        dto.password,
        { surface: 'staff.create.provided-password' },
      );
    }
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    // Store first provider number in the main column; extras in qualifications (JSON) for now
    const primaryProvider = dto.providerNumbers?.find(p => p.number.trim());

    const row = await this.repo.insert({
      id: uuidv4(),
      clinic_id: clinicId,
      given_name: dto.givenName,
      family_name: dto.familyName,
      email: normalizedEmail,
      password_hash: passwordHash,
      role: targetRole,
      discipline_id: resolvedDiscipline.disciplineId,
      discipline: resolvedDiscipline.disciplineName,
      phone_mobile: dto.phone ?? dto.phoneMobile ?? null,
      ahpra_number: dto.ahpraNumber ?? null,
      prescriber_number: dto.prescriberNumber ?? null,
      provider_number: dto.providerNumber ?? primaryProvider?.number ?? null,
      hpii: dto.hpii ?? dto.phiNumber ?? null,
      qualifications: dto.providerNumbers?.length
        ? JSON.stringify(dto.providerNumbers)
        : null,
      specialisation: dto.specialisation ?? dto.phiProvider ?? null,
      is_active: true,
      must_change_password: true,
      deleted_at: null,
    });

    // Write any specialty enrolments supplied at create time. If the
    // caller omitted specialties entirely, leave the junction empty so
    // the admin can fill it in afterwards — we do NOT auto-seed
    // mental_health here because new hires might be for any specialty.
    if (dto.specialties && dto.specialties.length > 0) {
      await this.repo.replaceSpecialtiesForStaff(
        row.id,
        clinicId,
        dto.specialties,
        null, // created_by actor is not currently threaded through createStaff
      );
    }
    await this.repo.setProfileTabVisibility(
      row.id,
      dto.settingsProfileTabVisible ?? false,
    );
    const specialties = await this.repo.listSpecialtiesForStaff(row.id, clinicId);
    const settingsProfileTabVisible = await this.repo.getProfileTabVisibility(row.id, clinicId);

    const response = mapStaffRowToResponse(row, specialties, settingsProfileTabVisible);
    await this.invalidateLookupCache(clinicId);
    // Return the temporary password so admin can share it with the new staff member.
    // This is the only time the password is ever visible — it is not stored in plaintext.
    return { ...response, temporaryPassword: isAutoPassword ? tempPassword : undefined };
  }

  async updateStaff(clinicId: string, id: string, dto: Partial<{
    givenName: string; familyName: string; email: string;
    role: string; isActive: boolean; discipline: string; phoneMobile: string;
    ahpraNumber: string; ahpraExpiry: string; prescriberNumber: string;
    providerNumber: string; hpii: string; qualifications: string;
    specialisation: string; phoneWork: string;
    isPrescriber: boolean;
    providerNumbers: Array<{ type: string; number: string; location?: string }>;
    phiProvider: string;
    phiNumber: string;
    settingsProfileTabVisible: boolean;
    specialties: Array<{ code: string; isPrimary?: boolean }>;
  }>, actorAuth?: AuthContext): Promise<StaffResponse> {
    const existing = await this.repo.findByIdAndClinic(id, clinicId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Staff not found");
    const targetEmail = (dto.email ?? existing.email).trim().toLowerCase();
    const targetRole = dto.role ?? existing.role;
    assertSuperadminRoleMutationAllowed({
      actorAuth,
      existingRole: existing.role,
      targetRole,
      targetEmail,
    });

    const isDeactivationAttempt =
      dto.isActive !== undefined && dto.isActive === false && existing.is_active === true;
    if (isDeactivationAttempt) {
      const authForPolicy: AuthContext = actorAuth ?? {
        staffId: 'system',
        clinicId,
        role: 'system',
        permissions: [],
      };
      const enforcePendingNotesGate = await shouldEnforceStaffDeactivationPendingNotes(
        authForPolicy,
      );
      if (enforcePendingNotesGate) {
        const pendingCount = await this.repo.countPendingUnsignedNotesByAuthor(id, clinicId);
        if (pendingCount > 0) {
          const sampleNotes = await this.repo.listPendingUnsignedNotesByAuthor(id, clinicId, 5);
          throw new HttpError(
            409,
            "STAFF_DEACTIVATION_BLOCKED_PENDING_UNSIGNED_NOTES",
            `Cannot deactivate this staff member while ${pendingCount} unsigned clinical note${pendingCount === 1 ? '' : 's'} remain. Sign or reassign those notes first.`,
            {
              pendingUnsignedNotesCount: pendingCount,
              pendingUnsignedNotesSample: sampleNotes.map((note) => ({
                id: note.id,
                patientId: note.patient_id,
                noteType: note.note_type,
                noteDateTime: note.note_date_time,
              })),
            },
          );
        }
      }
    }

    const resolvedDiscipline = dto.discipline !== undefined
      ? await this.normalizeAndResolveDiscipline(clinicId, dto.discipline)
      : undefined;

    const patch: Partial<StaffRow> = {};
    if (dto.givenName !== undefined) patch.given_name = dto.givenName;
    if (dto.familyName !== undefined) patch.family_name = dto.familyName;
    if (dto.email !== undefined) patch.email = targetEmail;
    if (dto.role !== undefined) patch.role = targetRole;
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;
    if (resolvedDiscipline !== undefined) {
      patch.discipline_id = resolvedDiscipline.disciplineId;
      patch.discipline = resolvedDiscipline.disciplineName;
    }
    if (dto.phoneMobile !== undefined) patch.phone_mobile = dto.phoneMobile ?? null;
    if (dto.phoneWork !== undefined) patch.phone_work = dto.phoneWork ?? null;
    if (dto.ahpraNumber !== undefined) patch.ahpra_number = dto.ahpraNumber ?? null;
    if (dto.prescriberNumber !== undefined) patch.prescriber_number = dto.prescriberNumber ?? null;
    if (dto.isPrescriber === false && dto.prescriberNumber === undefined) {
      patch.prescriber_number = null;
    }
    if (dto.providerNumber !== undefined) patch.provider_number = dto.providerNumber ?? null;
    if (dto.hpii !== undefined) patch.hpii = dto.hpii ?? null;
    if (dto.qualifications !== undefined) patch.qualifications = dto.qualifications ?? null;
    if (dto.specialisation !== undefined) patch.specialisation = dto.specialisation ?? null;
    if (dto.providerNumbers !== undefined) {
      const cleanProviderNumbers = dto.providerNumbers
        .map((row) => ({
          type: row.type?.trim() ?? '',
          number: row.number?.trim() ?? '',
          location: row.location?.trim() ?? '',
        }))
        .filter((row) => row.number.length > 0);
      patch.qualifications = cleanProviderNumbers.length > 0
        ? JSON.stringify(cleanProviderNumbers)
        : null;
      if (dto.providerNumber === undefined) {
        patch.provider_number = cleanProviderNumbers[0]?.number ?? null;
      }
    }
    if (dto.phiProvider !== undefined) patch.specialisation = dto.phiProvider ?? null;
    if (dto.phiNumber !== undefined) patch.hpii = dto.phiNumber ?? null;

    const updated = await this.repo.update(id, clinicId, patch);
    if (!updated) throw new HttpError(500, "INTERNAL_ERROR", "Failed to update staff");

    // BUG-356 — force-invalidate access tokens when a security-critical
    // column on the staff row changed. Layer A (application-layer) of
    // the permissions-change-must-invalidate-sessions invariant. A future
    // BUG-353 redo will add a matching DB trigger as Layer B.
    //
    // Compare `existing` (pre-update) against the diff patch to decide
    // whether a state change actually occurred. Benign column updates
    // (givenName, email, phoneMobile, etc.) do NOT fire the blacklist —
    // only role / is_active / deleted_at. This mirrors the column scope
    // of the BUG-354 trigger.
    //
    // Blacklist failure MUST NOT block the update — the write has
    // already committed and the user-facing response depends on
    // returning a 200 with the updated row. Degradation is logged so
    // observability alerts can fire if Redis is unreachable for a
    // sustained period.
    const roleChanged = dto.role !== undefined && dto.role !== existing.role;
    const activeChanged = dto.isActive !== undefined && dto.isActive !== existing.is_active;
    if (roleChanged || activeChanged) {
      // L5 Standard 3 absorb — blacklist access tokens (Redis) AND
      // revoke all active staff_sessions rows (Postgres). Without the
      // staff_sessions revoke, a demoted user's refresh-token (7-day
      // TTL) can mint fresh access tokens whose iat > blacklist
      // timestamp — so `isUserRevokedAfter` returns false and the
      // revocation leaks. authService.refresh reads revoked_at from
      // staff_sessions, so revoking here closes that escape hatch.
      try {
        await blacklistAllUserTokens(id);
      } catch (err) {
        logger.error(
          { err, staffId: id, roleChanged, activeChanged },
          "BUG-356: blacklistAllUserTokens failed — existing access tokens NOT invalidated",
        );
      }
      try {
        await new AuthRepository().revokeSessionsForStaff(id);
      } catch (err) {
        logger.error(
          { err, staffId: id, roleChanged, activeChanged },
          "BUG-356: revokeSessionsForStaff failed — refresh tokens NOT invalidated",
        );
      }
      // L4 Rule 5 absorb — emit a structured audit_log row so forensic
      // review can reconstruct "who was demoted by whom, when" without
      // cross-referencing Redis key TTLs. Fails silently inside
      // writeAuditLog per audit.ts convention (Never let audit failures
      // break clinical flows).
      await writeAuditLog({
        clinicId,
        actorId: id,  // Best-effort: the subject of the revocation.
                      // A controller-wrapped variant would pass
                      // auth.staffId (the ACTOR) instead — follow-up
                      // for the AuthContext-first migration.
        tableName: "staff",
        recordId: id,
        action: "SESSION_REVOKED_BY_STATE_CHANGE",
        oldValues: { role: existing.role, is_active: existing.is_active },
        newValues: { role: dto.role ?? existing.role, is_active: dto.isActive ?? existing.is_active, trigger: roleChanged ? "role_changed" : "active_changed" },
      });
    }

    // Replace-all semantics: specialties only touched when the caller
    // explicitly sends the field (undefined vs empty array is the signal).
    if (dto.specialties !== undefined) {
      await this.repo.replaceSpecialtiesForStaff(id, clinicId, dto.specialties, null);
    }
    if (dto.settingsProfileTabVisible !== undefined) {
      await this.repo.setProfileTabVisibility(id, dto.settingsProfileTabVisible);
    }
    const specialties = await this.repo.listSpecialtiesForStaff(id, clinicId);
    const settingsProfileTabVisible = await this.repo.getProfileTabVisibility(id, clinicId);
    await this.invalidateLookupCache(clinicId);
    return mapStaffRowToResponse(updated, specialties, settingsProfileTabVisible);
  }
}
