/**
 * Phase 13 PR1 — backfill 'calendar' module access.
 *
 * Every active clinician, admin, and superadmin gets write access
 * to the new `calendar` module key so that the moment the calendar
 * routes start enforcing `requireModuleRead(MODULE_KEYS.CALENDAR)`
 * / `requireModuleWrite(...)` nobody who already uses the
 * appointment surface gets locked out.
 *
 * Idempotency note — the staff_module_access table has no unique
 * index on (staff_id, module), so ON CONFLICT can't be used.
 * Instead the insert is guarded by a NOT EXISTS subquery so re-
 * running the migration is a no-op.
 *
 * Receptionists, managers, referral_coordinators, and readonly
 * users don't get a row — the calendar is a clinician-facing
 * surface. A clinic admin can extend access to a specific user
 * via the admin module-access matrix if they want to.
 */
import type { Knex } from 'knex';

const NEW_MODULE_KEYS = ['calendar'] as const;
const GRANT_ROLES = ['clinician', 'admin', 'superadmin'] as const;

export async function up(knex: Knex): Promise<void> {
  for (const mod of NEW_MODULE_KEYS) {
    await knex.raw(
      `
      INSERT INTO staff_module_access (
        staff_id, clinic_id, module, access_level, can_delegate_this,
        created_at, updated_at
      )
      SELECT s.id, s.clinic_id, ?, 'write', false, now(), now()
        FROM staff s
       WHERE s.role = ANY(?)
         AND s.is_active = true
         AND s.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM staff_module_access sma
            WHERE sma.staff_id = s.id AND sma.module = ?
         );
      `,
      [mod, GRANT_ROLES as unknown as string[], mod],
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex('staff_module_access')
    .whereIn('module', NEW_MODULE_KEYS as unknown as string[])
    .where({ access_level: 'write' })
    .delete();
}
