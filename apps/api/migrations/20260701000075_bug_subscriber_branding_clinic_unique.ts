import type { Knex } from 'knex';

/**
 * BUG-BRANDING-UPSERT-CONFLICT
 *
 * `powerSettingsRepository.upsertBranding` uses ON CONFLICT (clinic_id),
 * but subscriber_branding lacked a unique index/constraint on clinic_id.
 * That made every upsert fail at runtime with 42P10.
 *
 * This migration:
 * 1. Deduplicates legacy rows per clinic (keep most recently updated row)
 * 2. Adds a unique index on clinic_id so ON CONFLICT is valid
 */
export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('subscriber_branding');
  if (!hasTable) return;

  // @migration-raw-exempt: data_backfill_delete
  await knex.raw(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY clinic_id
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
        ) AS rn
      FROM subscriber_branding
    )
    DELETE FROM subscriber_branding sb
    USING ranked r
    WHERE sb.id = r.id
      AND r.rn > 1
  `);

  // @migration-raw-exempt: idempotency_guard
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS subscriber_branding_clinic_id_uniq
    ON subscriber_branding (clinic_id)
  `);
}

export async function down(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('subscriber_branding');
  if (!hasTable) return;

  // @migration-raw-exempt: idempotency_guard
  await knex.raw('DROP INDEX IF EXISTS subscriber_branding_clinic_id_uniq');
}
