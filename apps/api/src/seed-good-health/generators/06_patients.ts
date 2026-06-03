import type { Knex } from 'knex';
import {
  MENTAL_HEALTH_CLINICS,
  TEAM_SLUGS,
  PATIENT_GIVEN_NAMES,
  PATIENT_FAMILY_NAMES,
  PATIENTS_PER_TEAM,
  CLINICS,
} from '../config/catalog';
import { clinicId, patientId } from '../config/ids';
import { createRng } from '../lib/rng';
import type { GeneratorResult } from './01_clinics';

// Phase 0.8 generator 06 — patients (80 rows).
//
// Shape: 4 MH clinics × 2 teams × PATIENTS_PER_TEAM (10) = 80 rows.
// Each patient:
//
//   - Deterministic id via patientId(clinic, team, index) so reseed
//     is an idempotent update, not a duplicate insert.
//   - Name drawn from disjoint patient name pools via an rng forked
//     on (clinic.team) so adding patients to one team later cannot
//     retroactively move names in any other team.
//   - EMR number formatted GH-<CLINIC3>-<TEAM1>-<NNN> (e.g.
//     GH-NTH-A-001). Stable + human-readable for demo copy/paste.
//   - Date of birth deterministic within 1960–2005 (age 20–65 as of
//     2026). Never random — derived from rng state at patient
//     creation time so tests can assert the same row on every run.
//   - Suburb / state / postcode inherited from the clinic's
//     catalog entry so a filter like "patients near Preston" has
//     real geographic grouping.
//   - Consent booleans all true — seed patients are cooperating
//     with the demo tenant by definition.
//
// Every patient row omits PHI-style columns (medicare_number, ihi,
// dva_number, phone, email) — future slices can add these via a
// patient_demographics generator that computes fictional values.
// For now the seed produces a minimal but valid patient row.

interface PatientRow {
  id: string;
  clinic_id: string;
  emr_number: string;
  given_name: string;
  family_name: string;
  date_of_birth: string;      // ISO YYYY-MM-DD
  gender: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  status: string;
  consent_to_treatment: boolean;
}

export interface PatientsBuild {
  readonly rows: PatientRow[];
}

const GENDER_POOL = ['female', 'male', 'non-binary'] as const;

function clinicCatalog(slug: string) {
  const match = CLINICS.find((c) => c.slug === slug);
  if (!match) throw new Error(`Unknown clinic slug: ${slug}`);
  return match;
}

function clinicPrefix(slug: string): string {
  // 3-letter prefix: 'northern' → 'NTH', 'eastern' → 'EST', etc.
  return slug.slice(0, 3).toUpperCase();
}

function formatDob(year: number, monthIdx: number, day: number): string {
  const mm = String(monthIdx + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

export function buildPatients(): PatientsBuild {
  const rows: PatientRow[] = [];

  for (const clinic of MENTAL_HEALTH_CLINICS) {
    const cid = clinicId(clinic.slug);
    const catalog = clinicCatalog(clinic.slug);

    for (const team of TEAM_SLUGS) {
      const rng = createRng(0xb0b1e).fork(`patients.${clinic.slug}.${team}`);

      for (let i = 1; i <= PATIENTS_PER_TEAM; i++) {
        const given = rng.pick(PATIENT_GIVEN_NAMES);
        const family = rng.pick(PATIENT_FAMILY_NAMES);
        const gender = rng.weighted([
          { value: GENDER_POOL[0], weight: 5 },
          { value: GENDER_POOL[1], weight: 5 },
          { value: GENDER_POOL[2], weight: 1 },
        ]);
        // DOB range: 1961-01-01 to 2005-12-31 → ages 20..65 on 2026-04-15
        const year = rng.nextInt(1961, 2005);
        const monthIdx = rng.nextInt(0, 11);
        // Use 28 as the safe upper day so we never emit an invalid
        // Feb-30 / Apr-31 row.
        const day = rng.nextInt(1, 28);

        const emrNumber =
          `GH-${clinicPrefix(clinic.slug)}-${team === 'alpha' ? 'A' : 'B'}-${String(i).padStart(3, '0')}`;

        rows.push({
          id: patientId(clinic.slug, team, i),
          clinic_id: cid,
          emr_number: emrNumber,
          given_name: given,
          family_name: family,
          date_of_birth: formatDob(year, monthIdx, day),
          gender,
          suburb: catalog.suburb,
          state: catalog.state,
          postcode: catalog.postcode,
          country: 'AU',
          status: 'active',
          consent_to_treatment: true,
        });
      }
    }
  }

  return { rows };
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

export async function runPatientsStep(knex: Knex): Promise<GeneratorResult> {
  const { rows } = buildPatients();
  return upsertById(knex, 'patients', rows);
}
