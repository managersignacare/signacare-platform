import type { Knex } from 'knex';
import { EXECUTIVE_STAFF } from '../config/catalog';
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

  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const result = await upsertStaffRow(knex, row);
    if (result === 'inserted') inserted++;
    else updated++;
  }
  return { inserted, updated };
}

// Keep a tiny helper re-export so unit tests don't have to reach
// into lib/ to produce a fast deterministic build.
export { stubHash } from '../lib/credentials';
