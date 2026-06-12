import type { Knex } from 'knex';

/**
 * Clinic-wide clinical leadership roles that may view all patient data
 * within their clinic, regardless of team/unit assignment.
 *
 * Scope note:
 * this is still tenant-bounded (clinic-scoped), not cross-clinic.
 */
export const CLINIC_WIDE_CLINICAL_LEADERSHIP_ROLE_PREFIXES = [
  'clinical manager',
  'medical director',
  'clinical director',
  'executive director',
] as const;

/**
 * Returns true when a staff member has an active leadership clinical-role
 * assignment in the given clinic.
 */
export async function hasClinicWideClinicalLeadershipAccess(
  conn: Knex,
  clinicId: string,
  staffId: string,
): Promise<boolean> {
  const row = await conn('staff_role_assignments as sra')
    .join('clinical_roles as cr', 'cr.id', 'sra.clinical_role_id')
    .join('staff as s', 's.id', 'sra.staff_id')
    .where('sra.clinic_id', clinicId)
    .andWhere('sra.staff_id', staffId)
    .andWhere('sra.is_active', true)
    .andWhere('cr.is_active', true)
    .andWhere('s.is_active', true)
    .whereNull('s.deleted_at')
    .where(function activeDateWindow() {
      this.whereNull('sra.end_date').orWhereRaw('sra.end_date >= CURRENT_DATE');
    })
    .where(function leadershipRoleMatch() {
      CLINIC_WIDE_CLINICAL_LEADERSHIP_ROLE_PREFIXES.forEach((prefix, index) => {
        const matcher = `LOWER(TRIM(cr.name)) LIKE ?`;
        const value = [`${prefix}%`];
        if (index === 0) {
          this.whereRaw(matcher, value);
        } else {
          this.orWhereRaw(matcher, value);
        }
      });
    })
    .first('sra.id');

  return Boolean(row);
}
