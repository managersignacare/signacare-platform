// apps/api/src/shared/authGuards.ts
//
// Composable service-layer authorization guards. Each guard checks
// one dimension of access — services compose them to enforce the
// full authorization policy. Defense-in-depth on top of HTTP
// middleware RBAC.
//
// Usage in a service:
//   requireClinicalAccessRole(auth);
//   requirePermission(auth, 'medication:create');
//   await requireSpecialty(auth, ['psychiatry', 'medicine']);
//   await requirePatientRelationship(auth, dto.patientId);

import type { AuthContext } from '@signacare/shared';
import { getAllowedDutyRelationshipTypes, isPrescriberSystemRole } from '@signacare/shared';
import type { Request } from 'express';
import type { Knex } from 'knex';
import { AppError, HttpError } from './errors';
import { db, dbAdmin, rlsStore } from '../db/db';
import { writeAuditLog } from '../utils/audit';
import { hasClinicWideClinicalLeadershipAccess } from './clinicalLeadershipAccess';

// BYPASS_ROLES moved to shared/authConstants.ts (BUG-280 L5 absorption)
// so retrospective audit tooling can import the same set without drift.
// OPERATIONAL_ONLY_ROLES added in Phase 0.5.B for the clinical-access
// role block.
import { BYPASS_ROLES, OPERATIONAL_ONLY_ROLES } from './authConstants';

/**
 * Verify the caller has a specific permission. Superadmin/admin
 * bypass all permission checks (matches middleware behaviour).
 */
export function requirePermission(auth: AuthContext, permission: string): void {
  if (BYPASS_ROLES.has(auth.role)) return;
  if (!auth.permissions.includes(permission)) {
    throw new AppError(
      `Permission '${permission}' required`,
      403,
      'FORBIDDEN',
    );
  }
}

const CLINICAL_LEADERSHIP_PERMISSION_OVERRIDES = new Set([
  'note:read',
  'note:create',
  'note:update',
]);

/**
 * Allows clinic-wide clinical leadership roles to read/write clinical notes
 * even when their base JWT permission set is narrower than clinician/admin.
 *
 * This is intentionally scoped to note permissions only. It preserves least
 * privilege for unrelated modules while reflecting the operational model where
 * clinical managers and medical directors can review and document care across
 * the clinic.
 */
export async function requirePermissionOrClinicalLeadershipOverride(
  auth: AuthContext,
  permission: string,
): Promise<void> {
  if (BYPASS_ROLES.has(auth.role)) return;
  if (auth.permissions.includes(permission)) return;

  if (CLINICAL_LEADERSHIP_PERMISSION_OVERRIDES.has(permission)) {
    const hasClinicWideLeadershipAccess = await withRelationshipDbContext(
      auth.clinicId,
      (relationshipDb) =>
        hasClinicWideClinicalLeadershipAccess(
          relationshipDb,
          auth.clinicId,
          auth.staffId,
        ),
    );
    if (hasClinicWideLeadershipAccess) return;
  }

  throw new AppError(
    `Permission '${permission}' required`,
    403,
    'FORBIDDEN',
  );
}

/**
 * Verify the resource belongs to the caller's clinic.
 * Prevents cross-tenant data access at the service layer.
 */
export function requireClinicMatch(
  auth: AuthContext,
  resourceClinicId: string,
): void {
  if (auth.clinicId !== resourceClinicId) {
    throw new AppError('Cross-clinic access denied', 403, 'CROSS_CLINIC');
  }
}

/**
 * Verify the caller has an enrolled specialty that matches
 * the required list. Blocks psychologists from prescribing
 * even if they have a 'clinician' role.
 */
export async function requireSpecialty(
  auth: AuthContext,
  allowedSpecialties: string[],
): Promise<void> {
  if (BYPASS_ROLES.has(auth.role)) return;

  const enrollment = await db('staff_specialties')
    .where({ staff_id: auth.staffId })
    .whereIn('specialty_code', allowedSpecialties)
    .first();

  if (!enrollment) {
    throw new AppError(
      `Specialty enrollment required: ${allowedSpecialties.join(' or ')}`,
      403,
      'SPECIALTY_REQUIRED',
    );
  }
}

/**
 * Verify the caller is one of the explicitly-authorised prescribing
 * system roles. Prescribing authority is now derived from system role,
 * not from the legacy discipline allow-list.
 *
 * No bypass roles for this guard. Prescribing authority is a clinical
 * safety control, not an administrative one — admin/superadmin callers
 * must satisfy the same role gate as clinicians.
 *
 * Fails with HTTP 403 PRESCRIBING_DISCIPLINE_REQUIRED to preserve the
 * existing API contract for callers and historical test fixtures.
 */
export async function requirePrescribingDiscipline(auth: AuthContext): Promise<void> {
  if (!isPrescriberSystemRole(auth.role)) {
    throw new AppError(
      'Prescribing requires an authorised prescriber system role',
      403,
      'PRESCRIBING_DISCIPLINE_REQUIRED',
    );
  }
}

/**
 * BUG-296 — verify the caller's staff.hpii is a structurally-valid
 * HPI-I (Healthcare Provider Identifier - Individual): 16 digits,
 * 800361 prefix, Luhn-checksum valid. Paired with
 * requirePrescribingDiscipline as defence-in-depth at every
 * prescribing surface (medicationService.create, prescriptionService
 * .create, etc.).
 *
 * S0 hardening posture: prescriber HPI-I is now mandatory and strict
 * for every prescribing flow. There is no warn-mode and no role-based
 * bypass — malformed/missing HPI-I always blocks with 403.
 */
export async function requireValidHpii(auth: AuthContext): Promise<void> {
  const row = await db('staff')
    .where({ id: auth.staffId })
    .select('hpii')
    .first();

  const hpii = (row?.hpii as string | null | undefined) ?? null;

  // Local import to avoid a circular dep against integrations/hiService.
  const { validateHpiiFormat } = await import('../integrations/hiService/hiServiceClient');
  const valid = hpii !== null && validateHpiiFormat(hpii);
  if (valid) return;

  const releaseEnv = (process.env.SIGNACARE_RELEASE_ENV ?? '').trim().toLowerCase();
  const stagingBypassEnabled =
    releaseEnv === 'staging'
    && (process.env.ALLOW_INVALID_HPII_IN_STAGING ?? '').trim().toLowerCase() === 'true';
  if (stagingBypassEnabled) {
    return;
  }

  throw new AppError(
    hpii === null
      ? 'Prescribing requires a valid HPI-I on the prescriber staff record (none set)'
      : `Prescriber HPI-I '${hpii}' is not a valid 16-digit HPI-I (must start with 800361 and pass Luhn check)`,
    403,
    'PRESCRIBER_HPII_INVALID',
  );
}

/**
 * Phase 0.5.B — two-rail access model. Verify the caller has an
 * active relationship with the patient. Passes if ANY of:
 *
 *   (1) auth.breakGlassSessionId is set (emergency-access path,
 *       audited separately via writeBreakGlassAudit).
 *   (2) Caller is the clinic's nominated_admin_staff_id OR
 *       delegated_admin_staff_id (clinic-scoped admin authority).
 *   (3) Active patient-team assignment where caller is the assigned
 *       primary_clinician_id.
 *   (4) Open episode where caller is primary_clinician_id OR
 *       key_worker_id.
 *   (4.5) Active duty relationship — caller has a non-revoked,
 *       unexpired patient_duty_relationships row. `duty_prescriber`
 *       only counts while the caller still holds an authorised
 *       prescriber system role.
 *   (5) Team membership — caller has either a staff_team_assignments
 *       row OR a staff_role_assignments row on the patient's team,
 *       OR on any ANCESTOR org_unit of the patient's team. The seed
 *       team comes from either active patient_team_assignments OR the
 *       current open episode.team_id so MDT allocations remain valid
 *       even when the episode team is newer than the patient-team
 *       anchor (recursive hierarchy cascade — executives with
 *       facility-level assignments see patients in descendant teams).
 *   (6) Caller is an active appointment attendee.
 *
 * Role-based bypass was REMOVED in Phase 0.5.B: superadmin and
 * generic role='admin' no longer auto-pass this guard. Per PART 12,
 * superadmin is a cross-clinic settings operator with no clinical-
 * data access; clinic admins must be explicitly nominated/delegated
 * to see clinical data.
 *
 * The CTE does the cascade in a single query rather than a JS loop
 * to avoid N-round-trips on deeply-nested hierarchies.
 */
export async function requirePatientRelationship(
  auth: AuthContext,
  patientId: string,
): Promise<void> {
  if (auth.breakGlassSessionId) return;

  const hasRelationship = await withRelationshipDbContext(
    auth.clinicId,
    async (relationshipDb) => {
      // Check 0 (Phase 0.5.B + BUG-351): clinic-scoped nominated/delegated
      // admin. Joins clinics on the patient's clinic_id (not auth.clinicId)
      // so the bypass can't leak across tenants — a nominated admin for
      // Clinic A can't see Clinic B's patient even if auth.clinicId were
      // spoofed to B.
      //
      // BUG-351 absorb closes three post-facto drift vectors on the
      // referenced staff row — the bypass is ONLY granted when the staff
      // record is currently:
      //   1. Active (`is_active=true`) — deactivated admin loses bypass
      //   2. Not operational-only (`role NOT IN OPERATIONAL_ONLY_ROLES`)
      //      — admin demoted to receptionist/readonly loses bypass
      //   3. Not soft-deleted (`deleted_at IS NULL`) — offboarded admin
      //      loses bypass (L3-absorb-1; staff soft-delete is the
      //      canonical offboarding path per staffRepository SSoT)
      //
      // Without all three, a demoted / deactivated / soft-deleted admin
      // retains clinic-wide PHI bypass until a superadmin re-nominates.
      const accessAdmin = await relationshipDb('clinics as c')
        .join('patients as p', 'p.clinic_id', 'c.id')
        .join('staff as s', function () {
          this.on(function () {
            this.on('s.id', 'c.nominated_admin_staff_id')
              .orOn('s.id', 'c.delegated_admin_staff_id');
          });
        })
        .where('p.id', patientId)
        .andWhere('s.id', auth.staffId)
        .andWhere('s.is_active', true)
        .whereNull('s.deleted_at')
        .whereNotIn('s.role', Array.from(OPERATIONAL_ONLY_ROLES))
        .first('c.id as clinic_id');

      if (accessAdmin) return true;

      // Check 0.5: clinic-wide leadership role bypass. Clinical Director
      // / Executive Director can view all patient data in their clinic
      // across units/teams.
      const hasClinicWideLeadershipAccess =
        await hasClinicWideClinicalLeadershipAccess(
          relationshipDb,
          auth.clinicId,
          auth.staffId,
        );
      if (hasClinicWideLeadershipAccess) return true;

      // Check 1: direct patient-team assignment where caller is the
      // named primary clinician. This is the canonical "I am currently
      // assigned to this patient" relationship and must not depend on a
      // parallel staff_team_assignments row staying in sync.
      const patientTeamAssignment = await relationshipDb(
        'patient_team_assignments as pta',
      )
        .join('org_units as ou', 'ou.id', 'pta.org_unit_id')
        .join('patients as p', 'p.id', 'pta.patient_id')
        .where({
          'pta.patient_id': patientId,
          'pta.primary_clinician_id': auth.staffId,
          'pta.is_active': true,
          'p.clinic_id': auth.clinicId,
          'ou.clinic_id': auth.clinicId,
        })
        .whereNull('p.deleted_at')
        .first('pta.id');

      if (patientTeamAssignment) return true;

      // Check 2: open episode where caller is primary_clinician_id or key_worker
      const episode = await relationshipDb('episodes')
        .where({
          patient_id: patientId,
          clinic_id: auth.clinicId,
        })
        .whereNull('deleted_at')
        .whereIn('status', ['open', 'active', 'admitted'])
        .andWhere(function () {
          this.where('primary_clinician_id', auth.staffId)
            .orWhere('key_worker_id', auth.staffId);
        })
        .first();

      if (episode) return true;

      // Check 2.5: active duty relationship. This is an explicit,
      // shift-bounded escape hatch for on-duty clinicians/prescribers
      // who are covering a patient outside their standing care-team
      // anchor. The relationship is auditable and time-limited, so it
      // is materially different from break-glass.
      const allowedDutyTypes = getAllowedDutyRelationshipTypes(auth.role);
      if (allowedDutyTypes.length > 0) {
        const dutyRelationship = await relationshipDb('patient_duty_relationships')
          .where({
            clinic_id: auth.clinicId,
            patient_id: patientId,
            staff_id: auth.staffId,
          })
          .whereNull('revoked_at')
          .where('expires_at', '>', new Date())
          .whereIn('relationship_type', allowedDutyTypes)
          .first('id');

        if (dutyRelationship) return true;
      }

      // Check 3 (Phase 0.5.B — expanded): team membership via EITHER
      // staff_team_assignments OR staff_role_assignments, with recursive
      // cascade up org_units.parent_id. Pre-0.5.B this branch only
      // matched plain staff_team_assignments on the EXACT org_unit of the
      // patient. Team leaders attached via role-only and facility-level
      // executives were rejected. The recursive CTE now seeds from BOTH
      // active patient_team_assignments and the current open episode.team_id
      // so care-team allocations written through the episode workflow do
      // not fall through when patient_team_assignments lags behind.
      const teamResult = await relationshipDb.raw<{
        rows: Array<{ has_match: boolean }>;
      }>(
        `
          WITH RECURSIVE ancestor_units AS (
            -- Seed A: the patient's active team assignment(s). depth=1.
            SELECT ou.id, ou.parent_id, ou.clinic_id, 1 AS depth
            FROM patient_team_assignments pta
            JOIN patients p ON p.id = pta.patient_id
            JOIN org_units ou ON ou.id = pta.org_unit_id
            WHERE pta.patient_id = :patientId
              AND pta.is_active = true
              AND p.clinic_id = :clinicId
              AND p.deleted_at IS NULL
              AND ou.clinic_id = :clinicId
            UNION
            -- Seed B: the current open/admitted episode team. This keeps
            -- MDT members on the episode's team in relationship even when
            -- patient_team_assignments has not been refreshed yet.
            SELECT ou.id, ou.parent_id, ou.clinic_id, 1 AS depth
            FROM episodes e
            JOIN org_units ou ON ou.id = e.team_id
            WHERE e.patient_id = :patientId
              AND e.clinic_id = :clinicId
              AND e.team_id IS NOT NULL
              AND e.deleted_at IS NULL
              AND e.status IN ('open', 'active', 'admitted')
              AND ou.clinic_id = :clinicId
            UNION
            -- Recurse: each ancestor org_unit. L5-absorb-1 depth cap:
            -- fail-loud on a cycle or pathologically-nested hierarchy.
            -- Real orgs are region → facility → team → sub-team; a cap
            -- of 20 is ~10x the deepest legitimate nesting.
            SELECT parent.id, parent.parent_id, parent.clinic_id, child.depth + 1
            FROM org_units parent
            JOIN ancestor_units child ON child.parent_id = parent.id
            WHERE child.depth < 20
          )
          SELECT EXISTS(
            -- Plain team membership at any ancestor level
            SELECT 1
            FROM staff_team_assignments sta
            JOIN ancestor_units au ON au.id = sta.org_unit_id
            WHERE sta.staff_id = :staffId
              AND sta.is_active = true
              AND au.clinic_id = :clinicId
            UNION
            -- Role-based assignment at any ancestor level
            SELECT 1
            FROM staff_role_assignments sra
            JOIN ancestor_units au ON au.id = sra.org_unit_id
            WHERE sra.staff_id = :staffId
              AND sra.is_active = true
              AND au.clinic_id = :clinicId
          ) AS has_match
        `,
        { patientId, staffId: auth.staffId, clinicId: auth.clinicId },
      );
      if (teamResult.rows?.[0]?.has_match) return true;

      // Check 4: appointment attendee
      const appointment = await relationshipDb('appointment_attendees as aa')
        .join('appointments as a', 'a.id', 'aa.appointment_id')
        .where({
          'a.patient_id': patientId,
          'a.clinic_id': auth.clinicId,
          'aa.staff_id': auth.staffId,
        })
        .whereNull('a.deleted_at')
        .whereNot('aa.attendance_status', 'removed')
        .first();

      return Boolean(appointment);
    },
  );

  if (hasRelationship) return;

  throw new AppError(
    'No active relationship with this patient. Add a duty relationship if you are covering this patient on shift, or use break-glass access for emergency.',
    403,
    'NO_PATIENT_RELATIONSHIP',
  );
}

async function withRelationshipDbContext<T>(
  clinicId: string,
  work: (relationshipDb: Knex) => Promise<T>,
): Promise<T> {
  const activeRequestTx = rlsStore.getStore();
  if (activeRequestTx) {
    return work(dbAdmin);
  }

  return dbAdmin.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
    return work(trx as unknown as Knex);
  });
}

/**
 * Phase 0.5.B — block operational-only roles from clinical-data
 * surfaces regardless of team attachment. Receptionist and readonly
 * personas may legitimately appear in staff_team_assignments (front
 * desk is attached to the clinic's teams) but must never read
 * clinical notes, patient meds, risk assessments etc.
 *
 * Synchronous guard — throws AppError 403 CLINICAL_ACCESS_DENIED.
 * Use at the service-layer entry point of any clinical-feature
 * service, AND as a frontend parity mirror via
 * hasClinicalAccess(role) from @signacare/shared/permissions.
 *
 * NOTE: this guard also blocks the 'superadmin' role? NO. Superadmin
 * passes this guard at the role-level — the clinical-data refusal
 * for superadmin is enforced by requirePatientRelationship, which
 * no longer role-bypasses them. This keeps requireClinicalAccessRole
 * as a narrow operational-role block, not a superadmin block. The
 * two-rail model is precise — each guard refuses exactly one thing.
 */
export function requireClinicalAccessRole(auth: AuthContext): void {
  if (OPERATIONAL_ONLY_ROLES.has(auth.role)) {
    throw new AppError(
      `Role '${auth.role}' is not authorised for clinical data access`,
      403,
      'CLINICAL_ACCESS_DENIED',
    );
  }
}

/**
 * Phase 0.5.B — settings-rail authority. Passes if:
 *
 *   (1) auth.role === 'superadmin' (cross-clinic settings operator,
 *       PART 12 clarification #1).
 *   (2) Caller is nominated_admin_staff_id OR delegated_admin_staff_id
 *       for the target clinic.
 *
 * Otherwise throws AppError 403 ACCESS_SETTINGS_READ_ONLY. Used on
 * every write to staff_module_access, staff_role_assignments,
 * staff_team_assignments, and the new clinics.{nominated,delegated}
 * _admin_staff_id columns themselves (in Power Settings).
 *
 * Generic role='admin' staff that aren't nominated/delegated get
 * 403 on writes; they can still GET (view-only) via the existing
 * requireRole('admin','superadmin') middleware on read endpoints.
 */
export async function requireAccessSettingsAuthority(
  auth: AuthContext,
  clinicId: string,
): Promise<void> {
  if (auth.role === 'superadmin') return;

  const clinic = await db('clinics')
    .where({ id: clinicId })
    .select('nominated_admin_staff_id', 'delegated_admin_staff_id')
    .first();

  if (!clinic) {
    throw new AppError(
      `Clinic ${clinicId} not found`,
      404,
      'NOT_FOUND',
    );
  }

  if (
    clinic.nominated_admin_staff_id === auth.staffId
    || clinic.delegated_admin_staff_id === auth.staffId
  ) {
    return;
  }

  throw new AppError(
    'Your admin role can view access settings but only the clinic\'s nominated or delegated admin may change them. Contact them or the superadmin to request a change.',
    403,
    'ACCESS_SETTINGS_READ_ONLY',
  );
}

/**
 * BUG-430-PATIENT-APP — patient-or-clinician access gate for the
 * dual-purpose `/api/v1/patient-app/:patientId` route family.
 *
 * The `/patient-app/*` URL prefix is a misleading naming convention:
 * the same handlers serve TWO caller classes:
 *   (a) PATIENT-APP session — the Viva mobile client posting/getting
 *       its OWN data (req.user.isPatientApp === true; req.user.patientId
 *       must equal req.params.patientId).
 *   (b) STAFF session — the clinician's web app (`VivaTab.tsx`,
 *       `SummaryTab.tsx`, etc.) reading/mutating the patient's Viva
 *       data on the patient-detail screen. The staff is reading
 *       another person's record; ownership is established via the
 *       staff-to-patient relationship (episode primary clinician,
 *       team membership, appointment attendee).
 *
 * The two caller classes need ORTHOGONAL gates. This helper dispatches:
 *
 *   - patient-app session  → assert `req.user.patientId === paramPatientId`
 *                            AND `req.user.clinicId === req.clinicId`.
 *                            On miss, audit `PATIENT_APP_IDOR_ATTEMPT`
 *                            (HIPAA §164.312(b)) THEN throw 403.
 *
 *   - staff session        → delegate to `requirePatientRelationship`
 *                            (the existing helper at L221). On miss
 *                            that helper throws 403 NO_PATIENT_RELATIONSHIP.
 *
 *   - neither (no JWT)     → 401 (should never reach here — authMiddleware
 *                            would have rejected first).
 *
 * Filed alongside this helper:
 *   - BUG-486 (S2 post-staging): convert patient-app dbAdmin queries
 *     to RLS-enforced `db`. Closes the dependence on this helper for
 *     tenant defence (RLS would catch cross-clinic).
 *   - BUG-491 (STRUCTURAL): split patientAppRoutes.ts into a true
 *     patient-app-only file + a clinician-side `vivaPlatformRoutes.ts`
 *     so the dual-use becomes explicit at the file layout level.
 *   - BUG-492 (S2): assert `req.user.clinicId === req.clinicId`
 *     invariant test across the entire authed surface.
 *
 * NOT a substitute for the `clinic_id: req.clinicId` predicate on
 * each dbAdmin query — that's the application-layer tenant filter.
 * Both must be present per CLAUDE.md §1.3 + §1.6 because dbAdmin
 * bypasses RLS Layer-2.
 */
export async function requirePatientOwnership(
  req: Request,
  paramPatientId: string,
): Promise<void> {
  const user = req.user as
    | { id?: string; patientId?: string; clinicId?: string; isPatientApp?: boolean; role?: string; permissions?: string[] }
    | undefined;

  if (!user || !user.id) {
    // No JWT — authMiddleware should have rejected. Fail closed.
    throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
  }

  const isPatientApp = user.isPatientApp === true;

  if (isPatientApp) {
    // ── Branch A: patient-app session ──────────────────────────────
    const tokenPatientId = user.patientId;
    const tokenClinicId = user.clinicId;
    const actorId = user.id;

    if (!tokenPatientId || !tokenClinicId) {
      // Patient-app JWT without patientId or clinicId is malformed —
      // /login mints both. Treat as IDOR probe (audit + 403).
      await writeAuditLog({
        clinicId: req.clinicId ?? '00000000-0000-0000-0000-000000000000',
        actorId,
        action: 'PATIENT_APP_IDOR_ATTEMPT',
        tableName: 'patient_app_accounts',
        recordId: '00000000-0000-0000-0000-000000000000',
        newData: {
          attempted_patient_id: paramPatientId,
          route: req.originalUrl,
          method: req.method,
          ip: req.ip ?? null,
          reason: 'malformed_patient_app_jwt',
        },
      });
      throw new HttpError(403, 'PATIENT_OWNERSHIP_MISMATCH', 'Malformed patient-app session');
    }

    // Token-clinic axis — JWT clinic must equal request clinic. A
    // mismatch indicates a mis-routed proxy, header injection, or
    // token-spoof attempt. Audit + 403 (BUG-492 covers the wider
    // invariant test across all sessions).
    if (tokenClinicId !== req.clinicId) {
      await writeAuditLog({
        clinicId: tokenClinicId,
        actorId,
        action: 'PATIENT_APP_IDOR_ATTEMPT',
        tableName: 'patient_app_accounts',
        recordId: tokenPatientId,
        newData: {
          attempted_patient_id: paramPatientId,
          token_clinic_id: tokenClinicId,
          request_clinic_id: req.clinicId,
          route: req.originalUrl,
          method: req.method,
          ip: req.ip ?? null,
          reason: 'token_clinic_mismatch',
        },
      });
      throw new HttpError(403, 'PATIENT_OWNERSHIP_MISMATCH', 'Token clinic mismatch');
    }

    if (tokenPatientId === paramPatientId) return;

    // Patient-app IDOR probe — audit BEFORE throw so the forensic
    // record exists even if the response unwinds.
    await writeAuditLog({
      clinicId: tokenClinicId,
      actorId,
      action: 'PATIENT_APP_IDOR_ATTEMPT',
      tableName: 'patient_app_accounts',
      recordId: tokenPatientId,
      newData: {
        attempted_patient_id: paramPatientId,
        route: req.originalUrl,
        method: req.method,
        ip: req.ip ?? null,
      },
    });

    throw new HttpError(
      403,
      'PATIENT_OWNERSHIP_MISMATCH',
      'You can only access your own patient data',
    );
  }

  // ── Branch B: staff session ──────────────────────────────────────
  // Clinician on VivaTab.tsx / SummaryTab.tsx / AppointmentsTab.tsx
  // reading or mutating a patient's Viva data. Authorisation is by
  // staff-to-patient relationship (episode primary clinician, team
  // member, appointment attendee, break-glass). Delegate to the
  // canonical existing helper.
  //
  // dynamic import keeps this self-contained without re-exporting
  // buildAuthContext from the helper module.
  const { buildAuthContext } = await import('./buildAuthContext');
  const auth = buildAuthContext(req, paramPatientId);
  await requirePatientRelationship(auth, paramPatientId);
}
