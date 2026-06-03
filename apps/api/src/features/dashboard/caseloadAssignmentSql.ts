/**
 * Shared caseload-assignment SQL predicates.
 *
 * Purpose:
 * keep clinician dashboard, manager caseload reports, and allocation
 * mutation views aligned on the same assignment semantics.
 */

export const OPEN_CASELOAD_EPISODE_STATUSES = ['open', 'onhold', 'active'] as const;

export const OPEN_CASELOAD_STATUS_SQL = "('open','onhold','active')";

function buildCaseloadPredicate(params: {
  episodeAlias: string;
  staffExpr: string;
}): string {
  const episodeAlias = params.episodeAlias;
  const staffExpr = params.staffExpr;
  return `
(
  ${episodeAlias}.primary_clinician_id = ${staffExpr}
  OR ${episodeAlias}.key_worker_id = ${staffExpr}
  OR EXISTS (
    SELECT 1
    FROM patient_team_assignments pta_primary
    WHERE pta_primary.patient_id = ${episodeAlias}.patient_id
      AND pta_primary.is_active = true
      AND pta_primary.primary_clinician_id = ${staffExpr}
  )
  OR EXISTS (
    SELECT 1
    FROM staff_role_assignments sra
    WHERE sra.clinic_id = ${episodeAlias}.clinic_id
      AND sra.staff_id = ${staffExpr}
      AND sra.is_active = true
      AND (sra.end_date IS NULL OR sra.end_date >= CURRENT_DATE)
      AND (
        sra.org_unit_id = ${episodeAlias}.team_id
        OR EXISTS (
          SELECT 1
          FROM patient_team_assignments pta_role
          WHERE pta_role.patient_id = ${episodeAlias}.patient_id
            AND pta_role.org_unit_id = sra.org_unit_id
            AND pta_role.is_active = true
        )
      )
  )
  OR EXISTS (
    SELECT 1
    FROM staff_team_assignments sta
    WHERE sta.clinic_id = ${episodeAlias}.clinic_id
      AND sta.staff_id = ${staffExpr}
      AND sta.is_active = true
      AND (sta.end_date IS NULL OR sta.end_date >= CURRENT_DATE)
      AND (
        sta.org_unit_id = ${episodeAlias}.team_id
        OR EXISTS (
          SELECT 1
          FROM patient_team_assignments pta_team
          WHERE pta_team.patient_id = ${episodeAlias}.patient_id
            AND pta_team.org_unit_id = sta.org_unit_id
            AND pta_team.is_active = true
        )
      )
  )
)`.trim();
}

/**
 * Predicate with parameter placeholders.
 * Callers must bind staffId five times (same order as returned below).
 */
export function caseloadAssignmentPredicateForBoundStaff(
  episodeAlias = 'e',
): string {
  return buildCaseloadPredicate({ episodeAlias, staffExpr: '?' });
}

export function caseloadAssignmentBindingsForBoundStaff(
  staffId: string,
): [string, string, string, string, string] {
  return [staffId, staffId, staffId, staffId, staffId];
}

/**
 * Predicate using SQL aliases for set-based staff queries.
 * Example: staff alias "s", episode alias "e".
 */
export function caseloadAssignmentPredicateForStaffAlias(
  episodeAlias = 'e',
  staffAlias = 's',
): string {
  return buildCaseloadPredicate({
    episodeAlias,
    staffExpr: `${staffAlias}.id`,
  });
}
