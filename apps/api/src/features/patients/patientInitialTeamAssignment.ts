import type { Knex } from 'knex';

interface EnsureInitialTeamAssignmentArgs {
  trx: Knex.Transaction;
  clinicId: string;
  patientId: string;
  staffId: string;
}

function toIsoDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function resolveDefaultOrgUnitId(
  trx: Knex.Transaction,
  clinicId: string,
  staffId: string,
): Promise<string | null> {
  const teamAssignment = await trx('staff_team_assignments as sta')
    .join('org_units as ou', 'ou.id', 'sta.org_unit_id')
    .where({
      'sta.clinic_id': clinicId,
      'sta.staff_id': staffId,
      'sta.is_active': true,
      'ou.clinic_id': clinicId,
      'ou.is_active': true,
    })
    .whereNull('sta.end_date')
    .orderBy('sta.updated_at', 'desc')
    .orderBy('sta.created_at', 'desc')
    .first<{ org_unit_id: string }>('sta.org_unit_id');

  if (typeof teamAssignment?.org_unit_id === 'string' && teamAssignment.org_unit_id.length > 0) {
    return teamAssignment.org_unit_id;
  }

  const roleAssignment = await trx('staff_role_assignments as sra')
    .join('org_units as ou', 'ou.id', 'sra.org_unit_id')
    .where({
      'sra.clinic_id': clinicId,
      'sra.staff_id': staffId,
      'sra.is_active': true,
      'ou.clinic_id': clinicId,
      'ou.is_active': true,
    })
    .whereNull('sra.end_date')
    .orderBy('sra.updated_at', 'desc')
    .orderBy('sra.created_at', 'desc')
    .first<{ org_unit_id: string }>('sra.org_unit_id');

  if (typeof roleAssignment?.org_unit_id === 'string' && roleAssignment.org_unit_id.length > 0) {
    return roleAssignment.org_unit_id;
  }

  const clinicOrgUnit = await trx('org_units')
    .where({
      clinic_id: clinicId,
      is_active: true,
    })
    .orderBy('sort_order', 'asc')
    .orderBy('created_at', 'asc')
    .first<{ id: string }>('id');

  if (typeof clinicOrgUnit?.id === 'string' && clinicOrgUnit.id.length > 0) {
    return clinicOrgUnit.id;
  }

  const created = await trx('org_units')
    .insert({
      id: trx.raw('gen_random_uuid()'),
      clinic_id: clinicId,
      name: 'Default Team',
      level: 'team',
      parent_id: null,
      sort_order: 0,
      is_active: true,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .returning<{ id: string }[]>('id');

  return created[0]?.id ?? null;
}

async function ensureStaffTeamMembership(
  trx: Knex.Transaction,
  clinicId: string,
  staffId: string,
  orgUnitId: string,
): Promise<void> {
  const existing = await trx('staff_team_assignments')
    .where({
      clinic_id: clinicId,
      staff_id: staffId,
      org_unit_id: orgUnitId,
      is_active: true,
    })
    .whereNull('end_date')
    .first<{ id: string }>('id');

  if (existing?.id) return;

  await trx('staff_team_assignments').insert({
    id: trx.raw('gen_random_uuid()'),
    clinic_id: clinicId,
    staff_id: staffId,
    org_unit_id: orgUnitId,
    start_date: toIsoDateOnly(new Date()),
    end_date: null,
    is_active: true,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now(),
  });
}

/**
 * Ensure a newly-created patient has at least one active team assignment
 * anchored to the creating staff member's own active org unit.
 *
 * This prevents newly-created patients from falling into a relationship
 * gap where patient-detail tabs render but relationship-gated clinical
 * modules (medications, clozapine monitoring) fail with NO_PATIENT_RELATIONSHIP.
 */
export async function ensureInitialTeamAssignmentForPatient(
  args: EnsureInitialTeamAssignmentArgs,
): Promise<string | null> {
  const orgUnitId = await resolveDefaultOrgUnitId(args.trx, args.clinicId, args.staffId);
  if (!orgUnitId) return null;

  await ensureStaffTeamMembership(args.trx, args.clinicId, args.staffId, orgUnitId);

  await args.trx('patient_team_assignments')
    .insert({
      id: args.trx.raw('gen_random_uuid()'),
      patient_id: args.patientId,
      org_unit_id: orgUnitId,
      primary_clinician_id: null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .onConflict(['patient_id', 'org_unit_id'])
    .merge({
      is_active: true,
      updated_at: new Date(),
    });

  return orgUnitId;
}
