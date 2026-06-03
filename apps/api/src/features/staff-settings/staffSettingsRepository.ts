import { randomUUID } from 'crypto'
import { db } from '../../db/db'
// Phase 0b.2c-batch-6a (2026-05-06): drain 3 standard singular→plural
// hand-written column constants to migration-driven SSoT per Phase 0b.2
// plan + CLAUDE.md §15.
//
// permanent: alias re-exports IS the end-state per Phase 0b.2 DoD.
// Migration-driven SSoT auto-propagates forward when migrations land.
// Zero external consumers per grep — module-private `const`.
//
// Batch-6a scope: 3 standard singular→plural aliases ONLY (no pattern
// variation):
//   CLINICAL_ROLE_COLUMNS      = CLINICAL_ROLES_COLUMNS
//   REFERRAL_SOURCE_COLUMNS    = REFERRAL_SOURCES_COLUMNS
//   INVESTIGATION_TYPE_COLUMNS = INVESTIGATION_TYPES_COLUMNS
//
// Held for batch-6b (operator-authorized split 2026-05-06): the 3
// name-shortening sites in this file (DISCIPLINE / STAFF_TEAM /
// STAFF_ROLE) remain hand-written — they will land only when
// BUG-PHASE-0B-COLUMN-CONSTANT-NAMING-GUARD ships its naming guard +
// `@column-alias-exempt` annotation mechanism, OR with fresh explicit
// authorization. Reason: shipping new name-shortening sites pre-guard
// expands the very surface the guard is meant to contain — the BUG
// authorization covered guard + retroactive annotation of pre-existing
// ECOG site, NOT pre-guard expansion. Memory:
// `feedback_no_authorization_token_expansion.md`.
import { CLINICAL_ROLES_COLUMNS } from '../../db/types/clinical_roles'
import { REFERRAL_SOURCES_COLUMNS } from '../../db/types/referral_sources'
import { INVESTIGATION_TYPES_COLUMNS } from '../../db/types/investigation_types'

// Phase 0.7.5 c24 D10b — explicit .returning() column lists per table.
//
// BUG-STAFF-SETTINGS-CLINIC-ID-FILTER (S1) 2026-05-06: STAFF_TEAM_COLUMNS
// + STAFF_ROLE_COLUMNS expanded to include `clinic_id` (column added by
// migration 20260701000054 — Group 2 structural fix). Held-for-batch-7b
// status preserved (these 2 arrays remain hand-written per
// `feedback_no_authorization_token_expansion.md` discipline; they will
// migrate to alias re-exports of STAFF_TEAM_ASSIGNMENTS_COLUMNS /
// STAFF_ROLE_ASSIGNMENTS_COLUMNS in batch-7b after the naming guard
// ships). The column-list expansion here is a schema-driven update
// per CLAUDE.md §15, not a pre-guard alias-shape change.
const DISCIPLINE_COLUMNS = [
  'id', 'clinic_id', 'name', 'is_active', 'sort_order',
  'created_at', 'updated_at',
] as const

const CLINICAL_ROLE_COLUMNS = CLINICAL_ROLES_COLUMNS

const STAFF_TEAM_COLUMNS = [
  'id', 'staff_id', 'org_unit_id', 'start_date', 'end_date',
  'is_active', 'created_at', 'updated_at', 'clinic_id',
] as const

const STAFF_ROLE_COLUMNS = [
  'id', 'staff_id', 'org_unit_id', 'clinical_role_id', 'role_type',
  'start_date', 'end_date', 'is_active', 'created_at', 'updated_at',
  'clinic_id',
] as const

const REFERRAL_SOURCE_COLUMNS = REFERRAL_SOURCES_COLUMNS

const INVESTIGATION_TYPE_COLUMNS = INVESTIGATION_TYPES_COLUMNS

interface StaffScopeProbeRow {
  id: string
  clinic_id: string
  recovery_codes: unknown
}

function staffScopeProbeToResponse(row: Pick<StaffScopeProbeRow, 'id' | 'recovery_codes'>) {
  return {
    id: row.id,
    recoveryCodes: row.recovery_codes,
  }
}

// --- Professional Disciplines ---

export interface DisciplineRow {
  id: string; clinic_id: string; name: string; is_active: boolean; sort_order: number; created_at: string; updated_at: string
}

export async function findDisciplines(clinicId: string): Promise<DisciplineRow[]> {
  return db<DisciplineRow>('professional_disciplines').where({ clinic_id: clinicId }).orderBy('sort_order', 'asc')
}

export async function insertDiscipline(clinicId: string, name: string, sortOrder = 0): Promise<DisciplineRow> {
  const [row] = await db('professional_disciplines')
    .insert({ id: randomUUID(), clinic_id: clinicId, name, is_active: true, sort_order: sortOrder, created_at: new Date(), updated_at: new Date() })
    .returning(DISCIPLINE_COLUMNS)
  return row as DisciplineRow
}

export async function updateDiscipline(clinicId: string, id: string, data: Partial<{ name: string; is_active: boolean; sort_order: number }>): Promise<DisciplineRow | undefined> {
  const [row] = await db('professional_disciplines').where({ id, clinic_id: clinicId }).update({ ...data, updated_at: new Date() }).returning(DISCIPLINE_COLUMNS)
  return row as DisciplineRow | undefined
}

export async function deleteDiscipline(clinicId: string, id: string): Promise<void> {
  await db('professional_disciplines').where({ id, clinic_id: clinicId }).delete()
}

// --- Clinical Roles ---

export interface ClinicalRoleRow {
  id: string; clinic_id: string; name: string; is_active: boolean; sort_order: number; created_at: string; updated_at: string
}

export async function findClinicalRoles(clinicId: string): Promise<ClinicalRoleRow[]> {
  return db<ClinicalRoleRow>('clinical_roles').where({ clinic_id: clinicId }).orderBy('sort_order', 'asc')
}

export async function insertClinicalRole(clinicId: string, name: string, sortOrder = 0): Promise<ClinicalRoleRow> {
  const [row] = await db('clinical_roles')
    .insert({ id: randomUUID(), clinic_id: clinicId, name, is_active: true, sort_order: sortOrder, created_at: new Date(), updated_at: new Date() })
    .returning(CLINICAL_ROLE_COLUMNS)
  return row as ClinicalRoleRow
}

export async function updateClinicalRole(clinicId: string, id: string, data: Partial<{ name: string; is_active: boolean; sort_order: number }>): Promise<ClinicalRoleRow | undefined> {
  const [row] = await db('clinical_roles').where({ id, clinic_id: clinicId }).update({ ...data, updated_at: new Date() }).returning(CLINICAL_ROLE_COLUMNS)
  return row as ClinicalRoleRow | undefined
}

export async function deleteClinicalRole(clinicId: string, id: string): Promise<void> {
  await db('clinical_roles').where({ id, clinic_id: clinicId }).delete()
}

// --- Staff Team Assignments ---

export interface StaffTeamRow {
  id: string; clinic_id: string; staff_id: string; org_unit_id: string; start_date: string; end_date: string | null; is_active: boolean; created_at: string; updated_at: string
}

export async function findTeamAssignmentsByStaff(staffId: string, clinicId?: string): Promise<(StaffTeamRow & { org_unit_name?: string })[]> {
  const query = db('staff_team_assignments')
    .join('org_units', 'org_units.id', 'staff_team_assignments.org_unit_id')
    .where('staff_team_assignments.staff_id', staffId)
    .select('staff_team_assignments.*', 'org_units.name as org_unit_name')
    .orderBy('staff_team_assignments.start_date', 'desc')
  if (clinicId) query.andWhere('staff_team_assignments.clinic_id', clinicId)
  return query
}

export async function findTeamAssignmentsByClinic(clinicId: string): Promise<(StaffTeamRow & { org_unit_name?: string; staff_name?: string })[]> {
  return db('staff_team_assignments')
    .join('org_units', 'org_units.id', 'staff_team_assignments.org_unit_id')
    .join('staff', 'staff.id', 'staff_team_assignments.staff_id')
    .where('staff_team_assignments.clinic_id', clinicId)
    .select(
      'staff_team_assignments.*',
      'org_units.name as org_unit_name',
      db.raw("staff.given_name || ' ' || staff.family_name as staff_name"),
    )
    .orderBy('staff_team_assignments.start_date', 'desc')
}

export async function insertTeamAssignment(clinicId: string, data: { staffId: string; orgUnitId: string; startDate: string; endDate?: string | null }): Promise<StaffTeamRow> {
  const [row] = await db('staff_team_assignments')
    .insert({ id: randomUUID(), clinic_id: clinicId, staff_id: data.staffId, org_unit_id: data.orgUnitId, start_date: data.startDate, end_date: data.endDate ?? null, is_active: true, created_at: new Date(), updated_at: new Date() })
    .returning(STAFF_TEAM_COLUMNS)
  return row as StaffTeamRow
}

export async function updateTeamAssignment(clinicId: string, id: string, data: Partial<{ end_date: string | null; is_active: boolean }>): Promise<StaffTeamRow | undefined> {
  const [row] = await db('staff_team_assignments').where({ id, clinic_id: clinicId }).update({ ...data, updated_at: new Date() }).returning(STAFF_TEAM_COLUMNS)
  return row as StaffTeamRow | undefined
}

export async function deleteTeamAssignment(clinicId: string, id: string): Promise<void> {
  await db('staff_team_assignments').where({ id, clinic_id: clinicId }).delete()
}

// --- Staff Role Assignments ---

export interface StaffRoleRow {
  id: string; clinic_id: string; staff_id: string; org_unit_id: string; clinical_role_id: string; role_type: string; start_date: string; end_date: string | null; is_active: boolean; created_at: string; updated_at: string
}

export async function findRoleAssignmentsByStaff(staffId: string, clinicId?: string): Promise<(StaffRoleRow & { org_unit_name?: string; clinical_role_name?: string })[]> {
  const query = db('staff_role_assignments')
    .join('org_units', 'org_units.id', 'staff_role_assignments.org_unit_id')
    .join('clinical_roles', 'clinical_roles.id', 'staff_role_assignments.clinical_role_id')
    .where('staff_role_assignments.staff_id', staffId)
    .select('staff_role_assignments.*', 'org_units.name as org_unit_name', 'clinical_roles.name as clinical_role_name')
    .orderBy('staff_role_assignments.start_date', 'desc')
  if (clinicId) query.andWhere('staff_role_assignments.clinic_id', clinicId)
  return query
}

export async function findRoleAssignmentsByClinic(clinicId: string): Promise<(StaffRoleRow & { org_unit_name?: string; clinical_role_name?: string; staff_name?: string })[]> {
  return db('staff_role_assignments')
    .join('org_units', 'org_units.id', 'staff_role_assignments.org_unit_id')
    .join('clinical_roles', 'clinical_roles.id', 'staff_role_assignments.clinical_role_id')
    .join('staff', 'staff.id', 'staff_role_assignments.staff_id')
    .where('staff_role_assignments.clinic_id', clinicId)
    .select(
      'staff_role_assignments.*',
      'org_units.name as org_unit_name',
      'clinical_roles.name as clinical_role_name',
      db.raw("staff.given_name || ' ' || staff.family_name as staff_name"),
    )
    .orderBy('staff_role_assignments.start_date', 'desc')
}

export async function insertRoleAssignment(clinicId: string, data: {
  staffId: string; orgUnitId: string; clinicalRoleId: string; roleType: string; startDate: string; endDate?: string | null
}): Promise<StaffRoleRow> {
  const [row] = await db('staff_role_assignments')
    .insert({
      id: randomUUID(), clinic_id: clinicId, staff_id: data.staffId, org_unit_id: data.orgUnitId, clinical_role_id: data.clinicalRoleId,
      role_type: data.roleType, start_date: data.startDate, end_date: data.endDate ?? null, is_active: true,
      created_at: new Date(), updated_at: new Date(),
    })
    .returning(STAFF_ROLE_COLUMNS)
  return row as StaffRoleRow
}

export async function staffExistsInClinic(staffId: string, clinicId: string): Promise<boolean> {
  const row = await db<StaffScopeProbeRow>('staff')
    .where({ id: staffId, clinic_id: clinicId })
    .whereNull('deleted_at')
    .first('id', 'recovery_codes')
  if (!row) return false
  return Boolean(staffScopeProbeToResponse(row).id)
}

export async function orgUnitExistsInClinic(orgUnitId: string, clinicId: string): Promise<boolean> {
  const row = await db('org_units')
    .where({ id: orgUnitId, clinic_id: clinicId })
    .first('id')
  return Boolean(row?.id)
}

export async function clinicalRoleExistsInClinic(clinicalRoleId: string, clinicId: string): Promise<boolean> {
  const row = await db('clinical_roles')
    .where({ id: clinicalRoleId, clinic_id: clinicId })
    .first('id')
  return Boolean(row?.id)
}

export async function updateRoleAssignment(clinicId: string, id: string, data: Partial<{ end_date: string | null; is_active: boolean; role_type: string }>): Promise<StaffRoleRow | undefined> {
  const [row] = await db('staff_role_assignments').where({ id, clinic_id: clinicId }).update({ ...data, updated_at: new Date() }).returning(STAFF_ROLE_COLUMNS)
  return row as StaffRoleRow | undefined
}

export async function deleteRoleAssignment(clinicId: string, id: string): Promise<void> {
  await db('staff_role_assignments').where({ id, clinic_id: clinicId }).delete()
}

// --- Referral Sources ---

export interface ReferralSourceRow {
  id: string; clinic_id: string; category: string; name: string; is_active: boolean; sort_order: number; created_at: string; updated_at: string
}

export async function findReferralSources(clinicId: string): Promise<ReferralSourceRow[]> {
  return db<ReferralSourceRow>('referral_sources').where({ clinic_id: clinicId }).orderBy(['category', 'sort_order', 'name'])
}

export async function insertReferralSource(clinicId: string, category: string, name: string, sortOrder = 0): Promise<ReferralSourceRow> {
  const [row] = await db('referral_sources')
    .insert({ id: randomUUID(), clinic_id: clinicId, category, name, is_active: true, sort_order: sortOrder, created_at: new Date(), updated_at: new Date() })
    .returning(REFERRAL_SOURCE_COLUMNS)
  return row as ReferralSourceRow
}

export async function updateReferralSource(clinicId: string, id: string, data: Partial<{ name: string; category: string; is_active: boolean; sort_order: number }>): Promise<ReferralSourceRow | undefined> {
  const [row] = await db('referral_sources').where({ id, clinic_id: clinicId }).update({ ...data, updated_at: new Date() }).returning(REFERRAL_SOURCE_COLUMNS)
  return row as ReferralSourceRow | undefined
}

export async function deleteReferralSource(clinicId: string, id: string): Promise<void> {
  await db('referral_sources').where({ id, clinic_id: clinicId }).delete()
}

// --- Investigation Types ---

export interface InvestigationTypeRow {
  id: string; clinic_id: string; name: string; is_active: boolean; sort_order: number; created_at: string; updated_at: string
}

export async function findInvestigationTypes(clinicId: string): Promise<InvestigationTypeRow[]> {
  return db<InvestigationTypeRow>('investigation_types').where({ clinic_id: clinicId }).orderBy(['sort_order', 'name'])
}

export async function insertInvestigationType(clinicId: string, name: string, sortOrder = 0): Promise<InvestigationTypeRow> {
  const [row] = await db('investigation_types')
    .insert({ id: randomUUID(), clinic_id: clinicId, name, is_active: true, sort_order: sortOrder, created_at: new Date(), updated_at: new Date() })
    .returning(INVESTIGATION_TYPE_COLUMNS)
  return row as InvestigationTypeRow
}

export async function updateInvestigationType(clinicId: string, id: string, data: Partial<{ name: string; is_active: boolean; sort_order: number }>): Promise<InvestigationTypeRow | undefined> {
  const [row] = await db('investigation_types').where({ id, clinic_id: clinicId }).update({ ...data, updated_at: new Date() }).returning(INVESTIGATION_TYPE_COLUMNS)
  return row as InvestigationTypeRow | undefined
}

export async function deleteInvestigationType(clinicId: string, id: string): Promise<void> {
  await db('investigation_types').where({ id, clinic_id: clinicId }).delete()
}
