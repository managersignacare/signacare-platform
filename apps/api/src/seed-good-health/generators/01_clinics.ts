import type { Knex } from 'knex';
import { CLINICS, MENTAL_HEALTH_CLINICS, TEAM_SLUGS, PROGRAMS } from '../config/catalog';
import { clinicId, teamId, programId, derive } from '../config/ids';

// Phase 0.8 generator 01 — clinics + org_units + org_unit_programs.
//
// Shape:
//   - 5 clinics rows (4 mental health + 1 executive)
//   - For each of the 4 mental health clinics:
//       1 org_units row at level='hospital' (Mind Health Hospital)
//       2 org_units rows at level='team' (Alpha + Beta)
//       2-3 org_unit_programs rows (depending on team assignments)
//   - Executive clinic has no org_units or programs — it exists so
//     Good Health corporate staff have a clinic_id that satisfies RLS
//     without leaking into a clinical tenant's data.
//
// Every id derives from `config/ids.ts` so reseed is an upsert.
// Every insert wraps the conflict path in ON CONFLICT (id) DO UPDATE
// so row shape changes (name edits, legal name tweaks) propagate on
// re-run without producing duplicates.
//
// This file is pure row-building + upsert plumbing. All domain data
// lives in `config/catalog.ts` — review that file to see what gets
// seeded; review this file to see how.

interface ClinicRow {
  id: string;
  name: string;
  legal_name: string;
  abn: string;
  hpio: string;
  npds_conformance_id: string;
  time_zone: string;
  is_active: boolean;
}

interface OrgUnitRow {
  id: string;
  clinic_id: string;
  name: string;
  level: string;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
}

interface ProgramRow {
  id: string;
  clinic_id: string;
  org_unit_id: string;
  name: string;
  is_active: boolean;
}

export interface GeneratorResult {
  readonly inserted: number;
  readonly updated: number;
}

export function buildClinicRows(): ClinicRow[] {
  return CLINICS.map((c) => ({
    id: clinicId(c.slug),
    name: c.name,
    legal_name: c.legalName,
    abn: c.abn,
    hpio: c.hpio,
    npds_conformance_id: c.npdsConformanceId,
    time_zone: c.timeZone,
    is_active: true,
  }));
}

export function buildOrgUnitRows(): OrgUnitRow[] {
  const rows: OrgUnitRow[] = [];
  let sort = 0;
  for (const clinic of MENTAL_HEALTH_CLINICS) {
    const cid = clinicId(clinic.slug);
    // Hospital node anchors the clinic's hierarchy. Every clinical
    // team attaches to this node so it can be expanded later with
    // wards, inpatient units, etc., without moving the teams.
    const hospitalOrgId = derive(cid, 'hospital.mind-health');
    rows.push({
      id: hospitalOrgId,
      clinic_id: cid,
      name: 'Mind Health Hospital',
      level: 'hospital',
      parent_id: null,
      sort_order: sort++,
      is_active: true,
    });
    for (const team of TEAM_SLUGS) {
      rows.push({
        id: teamId(clinic.slug, team),
        clinic_id: cid,
        name: `${team === 'alpha' ? 'Alpha' : 'Beta'} Team`,
        level: 'team',
        parent_id: hospitalOrgId,
        sort_order: sort++,
        is_active: true,
      });
    }
  }
  return rows;
}

export function buildProgramRows(): ProgramRow[] {
  const rows: ProgramRow[] = [];
  for (const clinic of MENTAL_HEALTH_CLINICS) {
    const cid = clinicId(clinic.slug);
    for (const program of PROGRAMS) {
      for (const team of program.teamSlugs) {
        const ouId = teamId(clinic.slug, team);
        rows.push({
          id: programId(`${clinic.slug}.${team}.${program.slug}`),
          clinic_id: cid,
          org_unit_id: ouId,
          name: program.name,
          is_active: true,
        });
      }
    }
  }
  return rows;
}

async function upsertById<T extends { id: string }>(
  knex: Knex,
  table: string,
  rows: readonly T[],
): Promise<GeneratorResult> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };
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

export async function runClinicsStep(knex: Knex): Promise<GeneratorResult> {
  const clinicRows = buildClinicRows();
  const orgUnitRows = buildOrgUnitRows();
  const programRows = buildProgramRows();

  const cRes = await upsertById(knex, 'clinics', clinicRows);
  const oRes = await upsertById(knex, 'org_units', orgUnitRows);
  const pRes = await upsertById(knex, 'org_unit_programs', programRows);

  return {
    inserted: cRes.inserted + oRes.inserted + pRes.inserted,
    updated: cRes.updated + oRes.updated + pRes.updated,
  };
}
