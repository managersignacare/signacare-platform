import type { Knex } from 'knex';
import { DEMO_SHORTCUT_ADMINS, EXECUTIVE_STAFF } from '../config/catalog';
import { clinicId, staffId } from '../config/ids';
import {
  buildEmail,
  buildPlainPassword,
  hashPassword,
} from '../lib/credentials';
import type { GeneratorResult } from './01_clinics';

// Phase 0.8 generator 02 — executive + corporate staff (5 rows).
//
// Every persona lives inside the 'executive' clinic tenant so they
// share RLS scope with each other but cannot see any clinical tenant's
// patients. Later generators (department heads, clinic staff,
// patients) anchor to the four mental-health clinic tenants.
//
// The pure row builder takes a `hashFn` so tests can pass `stubHash`
// (fast, deterministic shape check) while the real seed passes
// `hashPassword` (bcrypt cost 10). This keeps the generator testable
// without paying the bcrypt cost in CI.

export interface StaffRow {
  id: string;
  clinic_id: string;
  given_name: string;
  family_name: string;
  email: string;
  password_hash: string;
  role: string;
  discipline: string | null;
  prescriber_number?: string | null;
  provider_number?: string | null;
  hpii?: string | null;
  is_active: boolean;
  require_mfa: boolean;
  has_mfa_configured: boolean;
  failed_login_attempts: number;
}

export interface StaffMasterLoginRow {
  readonly staffId: string;
  readonly email: string;
  readonly plainPassword: string;
  readonly titleLabel: string;
  readonly clinicSlug: string;
  readonly role: string;
}

export interface ExecutiveStaffBuild {
  readonly rows: StaffRow[];
  readonly loginTable: StaffMasterLoginRow[];
}

export async function buildExecutiveStaff(
  hashFn: (plain: string) => string | Promise<string>,
): Promise<ExecutiveStaffBuild> {
  const execClinicId = clinicId('executive');
  const rows: StaffRow[] = [];
  const loginTable: StaffMasterLoginRow[] = [];

  for (const persona of EXECUTIVE_STAFF) {
    const id = staffId('executive', persona.slug);
    const email = buildEmail(persona.givenName, persona.familyName, 'exec');
    const plainPassword = buildPlainPassword(persona.slug, persona.familyName);
    const hash = await Promise.resolve(hashFn(plainPassword));

    rows.push({
      id,
      clinic_id: execClinicId,
      given_name: persona.givenName,
      family_name: persona.familyName,
      email,
      password_hash: hash,
      role: persona.role,
      discipline: persona.discipline,
      is_active: true,
      require_mfa: true,
      has_mfa_configured: false,
      failed_login_attempts: 0,
    });

    loginTable.push({
      staffId: id,
      email,
      plainPassword,
      titleLabel: persona.titleLabel,
      clinicSlug: 'executive',
      role: persona.role,
    });
  }

  return { rows, loginTable };
}

/**
 * Build demo-shortcut admin rows for the Good Health tenant.
 *
 * Mirrors the shape of buildExecutiveStaff() so the master-login writer
 * can append the output to the executive section. The KEY DIFFERENCE is
 * that email + plaintext password come directly from the catalog entry
 * rather than the derived buildEmail() / buildPlainPassword() helpers
 * — these rows exist for a memorable demo login (admin@signacare.local),
 * not for the standardised "<firstname>.<lastname>@<clinic>.goodhealth.demo"
 * pattern.
 *
 * Defence in depth:
 *   - Asserts the catalog's `email` does not collide with the standard
 *     EXECUTIVE_STAFF derivation. If a future operator changes either
 *     side and produces a collision, the build throws BEFORE inserting,
 *     so the seed cannot silently corrupt the executive-clinic uniqueness.
 *   - Asserts the catalog's email is not a real production address by
 *     refusing any host that does NOT end in `.local`, `.demo`, `.test`,
 *     `.invalid`, `.example`, or `.localhost`. Tests pin this list.
 */
export async function buildDemoShortcutAdmins(
  hashFn: (plain: string) => string | Promise<string>,
): Promise<ExecutiveStaffBuild> {
  const rows: StaffRow[] = [];
  const loginTable: StaffMasterLoginRow[] = [];

  // Pre-compute derived emails for the standard EXECUTIVE_STAFF so we
  // can detect a catalog collision before insert.
  const derivedExecEmails = new Set(
    EXECUTIVE_STAFF.map((p) => buildEmail(p.givenName, p.familyName, 'exec')),
  );

  // Email-host allowlist for demo-shortcut entries — keeps a future
  // contributor from accidentally seeding a real production address.
  const ALLOWED_DEMO_HOSTS = ['.local', '.demo', '.test', '.invalid', '.example', '.localhost'];

  for (const persona of DEMO_SHORTCUT_ADMINS) {
    const host = persona.email.split('@')[1] ?? '';
    if (!ALLOWED_DEMO_HOSTS.some((suffix) => host.toLowerCase().endsWith(suffix))) {
      throw new Error(
        `DEMO_SHORTCUT_ADMINS[${persona.slug}].email='${persona.email}' uses a host that is not in the demo allowlist. ` +
          `Allowed suffixes: ${ALLOWED_DEMO_HOSTS.join(', ')}.`,
      );
    }
    if (derivedExecEmails.has(persona.email)) {
      throw new Error(
        `DEMO_SHORTCUT_ADMINS[${persona.slug}].email='${persona.email}' collides with a derived EXECUTIVE_STAFF email`,
      );
    }

    const id = staffId(persona.clinicSlug, persona.slug);
    const hash = await Promise.resolve(hashFn(persona.plainPassword));

    rows.push({
      id,
      clinic_id: clinicId(persona.clinicSlug),
      given_name: persona.givenName,
      family_name: persona.familyName,
      email: persona.email,
      password_hash: hash,
      role: persona.role,
      discipline: persona.discipline,
      is_active: true,
      // MFA is required for the standard exec personas; demo shortcut
      // admins are explicitly NOT MFA-required so an operator can log
      // in with email+password alone for a quick demo. The seed-time
      // toggle is fine — production never sees these rows.
      require_mfa: false,
      has_mfa_configured: false,
      failed_login_attempts: 0,
    });

    loginTable.push({
      staffId: id,
      email: persona.email,
      plainPassword: persona.plainPassword,
      titleLabel: persona.titleLabel,
      clinicSlug: persona.clinicSlug,
      role: persona.role,
    });
  }

  return { rows, loginTable };
}

async function upsertStaffRow(
  knex: Knex,
  row: StaffRow,
): Promise<'inserted' | 'updated'> {
  const existing = await knex('staff').where({ id: row.id }).first();
  if (existing) {
    // Re-run preserves the original password_hash unless the plain
    // password actually changed. We can't detect that from the row
    // alone, so always update — bcrypt output is non-deterministic
    // but verifying a re-run produces the SAME row requires hashing
    // once, which the caller handles.
    await knex('staff').where({ id: row.id }).update(row);
    return 'updated';
  }
  await knex('staff').insert(row);
  return 'inserted';
}

export async function runExecutiveStaffStep(
  knex: Knex,
): Promise<GeneratorResult> {
  // Use the real hash function for the live seed. Tests exercise
  // buildExecutiveStaff() with stubHash directly.
  const { rows, loginTable } = await buildExecutiveStaff(hashPassword);
  void loginTable; // Master login file writer lands in a later step.

  // Demo-shortcut admin rows (e.g. admin@signacare.local) — these are
  // memorable, fixed-credential logins meant to give a tester one-click
  // demo access. The `staff` table carries a global unique index
  // `staff_email_normalized_active_uniq ON staff ((LOWER(email))) WHERE
  // deleted_at IS NULL`, so if the canonical-personas dev fixture has
  // already seeded the same email (as it does for admin@signacare.local
  // with role=superadmin), inserting a parallel row would fail and
  // abort the entire Good Health seed.
  //
  // We therefore CHECK FOR COLLISION before insert:
  //   - If an active row with the same LOWER(email) exists, skip the
  //     demo-shortcut row + log INFO. The existing row already grants
  //     the operator a superadmin login; visibility across Good Health
  //     clinics comes for free from `clinicService.listClinics()` which
  //     returns every clinic when role === 'superadmin'.
  //   - If no row exists, insert the demo-shortcut row as designed so
  //     a fresh DB (or a future dev who is not using canonical
  //     personas) still gets a working memorable login.
  const demoBuild = await buildDemoShortcutAdmins(hashPassword);
  void demoBuild.loginTable; // Master login writer also reads these.

  let inserted = 0;
  let updated = 0;
  let skippedDueToExistingEmail = 0;

  for (const row of rows) {
    const result = await upsertStaffRow(knex, row);
    if (result === 'inserted') inserted++;
    else updated++;
  }

  for (const row of demoBuild.rows) {
    const conflict = await knex('staff')
      .whereRaw('LOWER(email) = LOWER(?)', [row.email])
      .whereNull('deleted_at')
      .where((qb) => qb.whereNot('id', row.id))
      .first('id', 'role', 'clinic_id');
    if (conflict) {
      console.log(
        `[seed:good-health] demo-shortcut admin '${row.email}' skipped — ` +
          `email already active at staff_id=${conflict.id} ` +
          `(role=${conflict.role}, clinic_id=${conflict.clinic_id}). ` +
          'Superadmin login already grants Good Health visibility via clinicService.listClinics(); ' +
          'no parallel row needed.',
      );
      skippedDueToExistingEmail++;
      continue;
    }
    const result = await upsertStaffRow(knex, row);
    if (result === 'inserted') inserted++;
    else updated++;
  }

  if (skippedDueToExistingEmail > 0) {
    console.log(
      `[seed:good-health] ${skippedDueToExistingEmail} demo-shortcut admin row(s) ` +
        'skipped due to existing email — see logs above.',
    );
  }

  return { inserted, updated };
}

// Keep a tiny helper re-export so unit tests don't have to reach
// into lib/ to produce a fast deterministic build.
export { stubHash } from '../lib/credentials';
