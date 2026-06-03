import { randomUUID } from 'crypto'
import { db } from '../../db/db'

// Explicit column lists for .returning() (Phase R3 / CLAUDE.md §1.7).
const ORG_UNIT_COLUMNS = [
  'id', 'clinic_id', 'parent_id', 'name', 'level', 'sort_order',
  'is_active', 'created_at', 'updated_at',
] as const;
const PROGRAM_COLUMNS = [
  'id', 'clinic_id', 'name', 'description', 'is_active',
  'created_at', 'updated_at',
] as const;

// --- Level Labels ---

export interface OrgLevelLabelRow {
  id: string
  clinic_id: string
  level: number
  label: string
  created_at: string
  updated_at: string
}

export async function findLabelsByClinic(clinicId: string): Promise<OrgLevelLabelRow[]> {
  return db<OrgLevelLabelRow>('org_level_labels')
    .where({ clinic_id: clinicId })
    .orderBy('level', 'asc')
}

export async function upsertLevelLabel(
  clinicId: string,
  level: number,
  label: string,
): Promise<void> {
  await db('org_level_labels')
    .insert({
      id: randomUUID(),
      clinic_id: clinicId,
      level,
      label,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .onConflict(['clinic_id', 'level'])
    .merge({ label, updated_at: new Date() })
}

// --- Org Units ---

export interface OrgUnitRow {
  id: string
  clinic_id: string
  parent_id: string | null
  name: string
  level: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export async function findUnitsByClinic(clinicId: string): Promise<OrgUnitRow[]> {
  return db<OrgUnitRow>('org_units')
    .where({ clinic_id: clinicId })
    .orderBy(['level', 'sort_order', 'name'])
}

export async function findUnitById(id: string): Promise<OrgUnitRow | undefined> {
  return db<OrgUnitRow>('org_units').where({ id }).first()
}

export async function insertUnit(data: {
  clinicId: string
  parentId: string | null
  name: string
  level: string
  sortOrder: number
  isActive: boolean
}): Promise<OrgUnitRow> {
  const [row] = await db('org_units')
    .insert({
      id: randomUUID(),
      clinic_id: data.clinicId,
      parent_id: data.parentId,
      name: data.name,
      level: data.level,
      sort_order: data.sortOrder,
      is_active: data.isActive,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returning(ORG_UNIT_COLUMNS)
  return row as OrgUnitRow
}

export async function updateUnit(
  id: string,
  data: Partial<{ name: string; sort_order: number; is_active: boolean }>,
): Promise<OrgUnitRow | undefined> {
  const [row] = await db('org_units')
    .where({ id })
    .update({ ...data, updated_at: new Date() })
    .returning(ORG_UNIT_COLUMNS)
  return row as OrgUnitRow | undefined
}

export async function deleteUnit(id: string): Promise<void> {
  await db('org_units').where({ id }).delete()
}

// --- Programs ---

export interface ProgramRow {
  id: string
  clinic_id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export async function findProgramsByClinic(clinicId: string): Promise<ProgramRow[]> {
  return db<ProgramRow>('programs')
    .where({ clinic_id: clinicId })
    .orderBy('name', 'asc')
}

export async function findProgramById(id: string): Promise<ProgramRow | undefined> {
  return db<ProgramRow>('programs').where({ id }).first()
}

export async function insertProgram(data: {
  clinicId: string
  name: string
  description?: string
}): Promise<ProgramRow> {
  const [row] = await db('programs')
    .insert({
      id: randomUUID(),
      clinic_id: data.clinicId,
      name: data.name,
      description: data.description ?? null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returning(PROGRAM_COLUMNS)
  return row as ProgramRow
}

export async function updateProgram(
  id: string,
  data: Partial<{ name: string; description: string; is_active: boolean }>,
): Promise<ProgramRow | undefined> {
  const [row] = await db('programs')
    .where({ id })
    .update({ ...data, updated_at: new Date() })
    .returning(PROGRAM_COLUMNS)
  return row as ProgramRow | undefined
}

export async function deleteProgram(id: string): Promise<void> {
  await db('programs').where({ id }).delete()
}

// --- Program Assignments ---

// Mirrors `org_unit_programs` (verified via psql \d on 2026-04-17).
// Phase 0.7.5 c24 C8 (SD15) — interface previously declared `programid`
// which doesn't exist. The table was redesigned to denormalise: it
// stores the program `name` directly plus clinic_id (for RLS) and
// is_active. No FK to `programs.id`. The repository now resolves
// program IDs to names at write time (and back again at read time)
// so the service/route API contract — which still thinks in
// programId — is preserved.
export interface OrgUnitProgramRow {
  id: string
  clinic_id: string
  org_unit_id: string
  name: string
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * Returns the denormalised assignment rows joined with the programs
 * table so callers get both the row + the FK-like `program_id` they
 * can use in the API response. Name match is scoped to the clinic
 * (no cross-clinic collision because the join is on clinic_id on both
 * sides).
 */
export async function findAssignmentsByClinic(
  clinicId: string,
): Promise<Array<OrgUnitProgramRow & { program_id: string | null }>> {
  return db<OrgUnitProgramRow>('org_unit_programs as oup')
    .leftJoin('programs as p', function () {
      this.on('p.clinic_id', 'oup.clinic_id').andOn('p.name', 'oup.name')
    })
    .where('oup.clinic_id', clinicId)
    .select(
      'oup.id',
      'oup.clinic_id',
      'oup.org_unit_id',
      'oup.name',
      'oup.is_active',
      'oup.created_at',
      'oup.updated_at',
      'p.id as program_id',
    ) as unknown as Promise<Array<OrgUnitProgramRow & { program_id: string | null }>>
}

export async function assignProgram(
  clinicId: string,
  orgUnitId: string,
  programId: string,
): Promise<void> {
  // Resolve programId → name + clinic_id. The row-iface guard enforces
  // `programs` matches its interface, so this join is safe.
  const program = await db('programs')
    .where({ id: programId, clinic_id: clinicId })
    .select('name')
    .first() as { name?: string } | undefined
  if (!program?.name) {
    throw new Error(`Program ${programId} not found in clinic ${clinicId}`)
  }

  await db('org_unit_programs')
    .insert({
      id: randomUUID(),
      clinic_id: clinicId,
      org_unit_id: orgUnitId,
      name: program.name,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .onConflict(['org_unit_id', 'name'])
    .merge({ is_active: true, updated_at: new Date() })
}

export async function unassignProgram(
  clinicId: string,
  orgUnitId: string,
  programId: string,
): Promise<void> {
  const program = await db('programs')
    .where({ id: programId, clinic_id: clinicId })
    .select('name')
    .first() as { name?: string } | undefined
  if (!program?.name) return

  await db('org_unit_programs')
    .where({ clinic_id: clinicId, org_unit_id: orgUnitId, name: program.name })
    .delete()
}
