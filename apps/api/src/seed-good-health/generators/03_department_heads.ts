import type { Knex } from 'knex';
import { DEPARTMENT_HEADS } from '../config/catalog';
import { clinicId, staffId, derive } from '../config/ids';
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

// Phase 0.8 generator 03 — department heads (7 HODs).
//
// Every HOD is a corporate-level clinical lead anchored to the
// 'executive' clinic tenant. Each one gets two rows:
//
//   1. A staff row with role='admin' (they manage the department but
//      aren't tenant superadmins — that stays with CEO / CMO).
//   2. A staff_specialties row pinning them to the specialty_code
//      their catalog entry declares, with is_primary=true.
//
// The specialties lookup is seeded by
// apps/api/migrations/20260420000000_specialties_core.ts, so the
// FK constraint staff_specialties.specialty_code → specialties.code
// is satisfied on every run without this generator touching the
// lookup itself.

interface StaffSpecialtyRow {
  id: string;
  clinic_id: string;
  staff_id: string;
  specialty_code: string;
  is_primary: boolean;
  credential_ref: string | null;
}

export interface DepartmentHeadsBuild {
  readonly staffRows: StaffRow[];
  readonly specialtyRows: StaffSpecialtyRow[];
  readonly loginTable: StaffMasterLoginRow[];
}

export async function buildDepartmentHeads(
  hashFn: (plain: string) => string | Promise<string>,
): Promise<DepartmentHeadsBuild> {
  const execClinicId = clinicId('executive');
  const staffRows: StaffRow[] = [];
  const specialtyRows: StaffSpecialtyRow[] = [];
  const loginTable: StaffMasterLoginRow[] = [];

  for (const persona of DEPARTMENT_HEADS) {
    const id = staffId('executive', persona.slug);
    const email = buildEmail(persona.givenName, persona.familyName, 'exec');
    const plainPassword = buildPlainPassword(persona.slug, persona.familyName);
    const hash = await Promise.resolve(hashFn(plainPassword));

    staffRows.push({
      id,
      clinic_id: execClinicId,
      given_name: persona.givenName,
      family_name: persona.familyName,
      email,
      password_hash: hash,
      role: 'admin',
      discipline: persona.discipline,
      is_active: true,
      require_mfa: true,
      has_mfa_configured: false,
      failed_login_attempts: 0,
    });

    specialtyRows.push({
      id: derive(id, `specialty.${persona.specialtyCode}`),
      clinic_id: execClinicId,
      staff_id: id,
      specialty_code: persona.specialtyCode,
      is_primary: true,
      credential_ref: null,
    });

    loginTable.push({
      staffId: id,
      email,
      plainPassword,
      titleLabel: persona.titleLabel,
      clinicSlug: 'executive',
      role: 'admin',
    });
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

export async function runDepartmentHeadsStep(
  knex: Knex,
): Promise<GeneratorResult> {
  const { staffRows, specialtyRows, loginTable } = await buildDepartmentHeads(
    hashPassword,
  );
  void loginTable; // Written to the master login file in a later step.

  const s = await upsertById(knex, 'staff', staffRows);
  const sp = await upsertById(knex, 'staff_specialties', specialtyRows);

  return {
    inserted: s.inserted + sp.inserted,
    updated: s.updated + sp.updated,
  };
}
