import type { Knex } from 'knex';
import {
  CLINIC_ROLE_ROSTER,
  MENTAL_HEALTH_CLINICS,
  TEAM_SLUGS,
  GIVEN_NAMES,
  FAMILY_NAMES,
} from '../config/catalog';
import { clinicId, staffId, derive } from '../config/ids';
import { createRng } from '../lib/rng';
import {
  buildEmail,
  buildPlainPassword,
  hashPassword,
} from '../lib/credentials';
import type { GeneratorResult } from './01_clinics';
import type {
  StaffRow,
  StaffMasterLoginRow,
} from './02_executive_staff';

// Phase 0.8 generator 04 — clinical staff (80 personas).
//
// Shape: 4 mental-health clinics × 2 teams (alpha/beta) × 10 roster
// slots = 80 staff rows. Each staff row gets a matching
// staff_specialties row pinning them to specialty_code='mental_health'
// with is_primary=true so later generators that scope a clinical
// query by specialty (e.g. listing available clinicians for an
// appointment) find every seeded person.
//
// Names are drawn from a deterministic name pool via a seeded PRNG
// forked per (clinic, team) so the Alpha team's name picks don't
// contaminate the Beta team's picks — adding roster entries to one
// team later can't retroactively move names on the other team.
//
// Collisions (two personas drawing the same given + family name
// within a tenant) are resolved by appending a numeric suffix to the
// email until the email is unique. The first occurrence keeps the
// base email; subsequent collisions become name.lastname.2@..., .3, etc.
// This is a belt-and-braces safeguard — the name pools are large
// enough (40 × 40 = 1600 combinations vs 80 personas) that the base
// probability of even one collision is low, but the generator must
// be robust to the pool being narrowed in a future edit.

interface StaffSpecialtyRow {
  id: string;
  clinic_id: string;
  staff_id: string;
  specialty_code: string;
  is_primary: boolean;
  credential_ref: string | null;
}

export interface ClinicStaffBuild {
  readonly staffRows: StaffRow[];
  readonly specialtyRows: StaffSpecialtyRow[];
  readonly loginTable: StaffMasterLoginRow[];
}

export async function buildClinicStaff(
  hashFn: (plain: string) => string | Promise<string>,
): Promise<ClinicStaffBuild> {
  const staffRows: StaffRow[] = [];
  const specialtyRows: StaffSpecialtyRow[] = [];
  const loginTable: StaffMasterLoginRow[] = [];
  const emailsByClinic = new Map<string, Set<string>>();

  for (const clinic of MENTAL_HEALTH_CLINICS) {
    const cid = clinicId(clinic.slug);
    const usedEmails = emailsByClinic.get(cid) ?? new Set<string>();
    emailsByClinic.set(cid, usedEmails);

    for (const team of TEAM_SLUGS) {
      // Fork rng per (clinic, team) so adding roster slots later
      // cannot retroactively move name picks in other (clinic, team)
      // pairs. Seed is a plain number; the tag is the only distinguisher.
      const rng = createRng(0xa11ce).fork(`${clinic.slug}.${team}`);

      for (const roster of CLINIC_ROLE_ROSTER) {
        const personaSlug = `${team}.${roster.slug}`;
        const id = staffId(clinic.slug, personaSlug);

        const given = rng.pick(GIVEN_NAMES);
        const family = rng.pick(FAMILY_NAMES);

        // Email uniqueness within the clinic tenant.
        let suffix = 1;
        let email = buildEmail(given, family, clinic.slug);
        while (usedEmails.has(email)) {
          suffix++;
          email = buildEmail(
            given,
            `${family}${suffix}`,
            clinic.slug,
          );
        }
        usedEmails.add(email);

        const plainPassword = buildPlainPassword(roster.passwordToken, family);
        const hash = await Promise.resolve(hashFn(plainPassword));

        staffRows.push({
          id,
          clinic_id: cid,
          given_name: given,
          family_name: family,
          email,
          password_hash: hash,
          role: roster.role,
          discipline: roster.discipline,
          is_active: true,
          require_mfa: true,
          has_mfa_configured: false,
          failed_login_attempts: 0,
        });

        specialtyRows.push({
          id: derive(id, 'specialty.mental_health'),
          clinic_id: cid,
          staff_id: id,
          specialty_code: 'mental_health',
          is_primary: true,
          credential_ref: null,
        });

        loginTable.push({
          staffId: id,
          email,
          plainPassword,
          titleLabel: `${roster.titleLabel} — ${clinic.name} (${team === 'alpha' ? 'Alpha' : 'Beta'})`,
          clinicSlug: clinic.slug,
          role: roster.role,
        });
      }
    }
  }

  return { staffRows, specialtyRows, loginTable };
}

async function upsertById<T extends { id: string }>(
  knex: Knex,
  table: string,
  rows: readonly T[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = await knex(table).where({ id: row.id }).first();
    if (existing) {
      await knex(table).where({ id: row.id }).update(row);
      updated++;
    } else {
      await knex(table).insert(row);
      inserted++;
    }
  }
  return { inserted, updated };
}

export async function runClinicStaffStep(
  knex: Knex,
): Promise<GeneratorResult> {
  const { staffRows, specialtyRows, loginTable } = await buildClinicStaff(
    hashPassword,
  );
  void loginTable; // Master login writer lands in a later step.

  const s = await upsertById(knex, 'staff', staffRows);
  const sp = await upsertById(knex, 'staff_specialties', specialtyRows);

  return {
    inserted: s.inserted + sp.inserted,
    updated: s.updated + sp.updated,
  };
}
