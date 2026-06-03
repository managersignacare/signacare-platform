import type { Knex } from 'knex';

/**
 * BUG-CLINIC-IDENTITY-CASE-DRIFT
 *
 * Staff login identity was effectively case-sensitive in some write paths,
 * which allowed duplicates like `User@demo.local` and `user@demo.local`.
 * That can route users into the wrong clinic context after login.
 *
 * This migration:
 * 1) soft-deletes duplicate active rows per LOWER(email), keeping one row
 *    deterministically (prefer clinic-bound nominated/delegated admin, then
 *    oldest created row),
 * 2) enforces a case-insensitive uniqueness invariant for active rows.
 */
export async function up(knex: Knex): Promise<void> {
  const hasStaff = await knex.schema.hasTable('staff');
  if (!hasStaff) return;

  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    WITH ranked AS (
      SELECT
        s.id,
        ROW_NUMBER() OVER (
          PARTITION BY LOWER(s.email)
          ORDER BY
            CASE
              WHEN nominated_clinic.id IS NOT NULL THEN 0
              WHEN delegated_clinic.id IS NOT NULL THEN 1
              ELSE 2
            END,
            s.created_at ASC NULLS LAST,
            s.id ASC
        ) AS rn
      FROM staff s
      LEFT JOIN clinics nominated_clinic
        ON nominated_clinic.id = s.clinic_id
       AND nominated_clinic.nominated_admin_staff_id = s.id
      LEFT JOIN clinics delegated_clinic
        ON delegated_clinic.id = s.clinic_id
       AND delegated_clinic.delegated_admin_staff_id = s.id
      WHERE s.deleted_at IS NULL
    )
    UPDATE staff s
       SET deleted_at = COALESCE(s.deleted_at, NOW()),
           is_active = FALSE,
           updated_at = NOW()
      FROM ranked r
     WHERE s.id = r.id
       AND r.rn > 1
  `);

  // @migration-raw-exempt: idempotency_guard
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS staff_email_normalized_active_uniq
      ON staff ((LOWER(email)))
      WHERE deleted_at IS NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  const hasStaff = await knex.schema.hasTable('staff');
  if (!hasStaff) return;

  // @migration-raw-exempt: idempotency_guard
  await knex.raw('DROP INDEX IF EXISTS staff_email_normalized_active_uniq');
}
