import type { Knex } from 'knex';
import { dbRead } from '../../db/db';

/**
 * Canonical team-task scope predicate shared by task list surfaces and
 * dashboard aggregates.
 *
 * Includes:
 * 1) tasks assigned to clinicians actively mapped to the selected teams
 *    (via either staff_team_assignments or staff_role_assignments), and
 * 2) unassigned tasks that still belong to the selected teams by either
 *    episode.team_id or active patient_team_assignments.
 */
export function applyTeamTaskScopeFilter(
  query: Knex.QueryBuilder,
  clinicId: string,
  teamIds: string[],
): void {
  query.andWhere((qb) => {
    qb.whereIn(
      't.assigned_to_id',
      dbRead('staff_team_assignments as sta')
        .join('staff as s', 's.id', 'sta.staff_id')
        .where('sta.clinic_id', clinicId)
        .whereIn('sta.org_unit_id', teamIds)
        .where('sta.is_active', true)
        .where((activeQb) =>
          activeQb.whereNull('sta.end_date').orWhere('sta.end_date', '>=', dbRead.raw('CURRENT_DATE')),
        )
        .whereNull('s.deleted_at')
        .select('sta.staff_id'),
    ).orWhere(
      't.assigned_to_id',
      'in',
      dbRead('staff_role_assignments as sra')
        .join('staff as s', 's.id', 'sra.staff_id')
        .where('sra.clinic_id', clinicId)
        .whereIn('sra.org_unit_id', teamIds)
        .where('sra.is_active', true)
        .where((activeQb) =>
          activeQb.whereNull('sra.end_date').orWhere('sra.end_date', '>=', dbRead.raw('CURRENT_DATE')),
        )
        .whereNull('s.deleted_at')
        .select('sra.staff_id'),
    ).orWhere((unassignedQb) => {
      unassignedQb.whereNull('t.assigned_to_id').andWhere((belongsQb) => {
        belongsQb
          .whereExists(
            dbRead('episodes as e')
              .select(dbRead.raw('1'))
              .whereRaw('e.id = t.episode_id')
              .where('e.clinic_id', clinicId)
              .whereIn('e.team_id', teamIds)
              .whereNull('e.deleted_at'),
          )
          .orWhereExists(
            dbRead('patient_team_assignments as pta')
              .join('org_units as ou', 'ou.id', 'pta.org_unit_id')
              .select(dbRead.raw('1'))
              .whereRaw('pta.patient_id = t.patient_id')
              .whereIn('pta.org_unit_id', teamIds)
              .where('pta.is_active', true)
              .where('ou.clinic_id', clinicId)
              .where('ou.is_active', true),
          );
      });
    });
  });
}

