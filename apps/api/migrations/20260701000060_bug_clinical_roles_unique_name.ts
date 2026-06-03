import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // BUG-CLINICAL-ROLES-DUPLICATE-AUTOCREATE:
  // Keep one canonical role row per (clinic_id, name), then re-point
  // staff_role_assignments to the kept id before deleting duplicates.
  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    WITH ranked AS (
      SELECT
        id,
        clinic_id,
        name,
        ROW_NUMBER() OVER (
          PARTITION BY clinic_id, name
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
        ) AS rn,
        FIRST_VALUE(id) OVER (
          PARTITION BY clinic_id, name
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
        ) AS keep_id
      FROM clinical_roles
    ),
    dupes AS (
      SELECT id, keep_id
      FROM ranked
      WHERE rn > 1
    )
    UPDATE staff_role_assignments sra
    SET clinical_role_id = dupes.keep_id,
        updated_at = NOW()
    FROM dupes
    WHERE sra.clinical_role_id = dupes.id
  `);

  // @migration-raw-exempt: data_backfill_delete
  await knex.raw(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY clinic_id, name
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
        ) AS rn
      FROM clinical_roles
    )
    DELETE FROM clinical_roles cr
    USING ranked
    WHERE cr.id = ranked.id
      AND ranked.rn > 1
  `);

  await knex.schema.alterTable('clinical_roles', (t) => {
    t.unique(['clinic_id', 'name'], {
      indexName: 'uq_clinical_roles_clinic_id_name',
    });
  });
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(
    'ALTER TABLE clinical_roles DROP CONSTRAINT IF EXISTS uq_clinical_roles_clinic_id_name',
  );
}
