import type { Knex } from 'knex';

/**
 * Enterprise hardening migration:
 * 1. Partial unique index on episodes (one open episode per type per patient)
 * 2. Unique constraint on patient_team_assignments (one assignment per patient per org unit)
 */
export async function up(knex: Knex): Promise<void> {
  // Dedupe existing open episodes that violate the "one open episode
  // per type per patient" business rule BEFORE adding the partial
  // unique index — otherwise a legacy clinic with existing duplicates
  // blocks the entire migration chain (and every subsequent specialty
  // migration with it). Keep the most recent open row; soft-delete
  // the older duplicates so history is preserved.
  if (await knex.schema.hasTable('episodes')) {
    await knex.raw(`
      UPDATE episodes e
      SET deleted_at = NOW(),
          updated_at = NOW()
      FROM (
        SELECT id
        FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY patient_id, episode_type
                   ORDER BY created_at DESC, id DESC
                 ) AS rn
          FROM episodes
          WHERE status = 'open'
            AND deleted_at IS NULL
        ) ranked
        WHERE rn > 1
      ) dupes
      WHERE e.id = dupes.id
    `);
  }

  // Partial unique index: only one open episode per episode_type per patient
  // Uses WHERE status = 'open' so closed/completed episodes don't conflict
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_episodes_one_open_per_type
    ON episodes (patient_id, episode_type)
    WHERE status = 'open' AND deleted_at IS NULL
  `);

  // Ensure patient_team_assignments has unique constraint for onConflict merge
  const hasConstraint = await knex.raw(`
    SELECT 1 FROM pg_constraint WHERE conname = 'patient_team_assignments_patient_id_org_unit_id_unique'
  `);
  if (!hasConstraint.rows.length) {
    // Remove duplicates first (keep the most recent)
    if (await knex.schema.hasTable('patient_team_assignments')) {
      await knex.raw(`
        DELETE FROM patient_team_assignments a
        USING patient_team_assignments b
        WHERE a.patient_id = b.patient_id
          AND a.org_unit_id = b.org_unit_id
          AND a.created_at < b.created_at
      `);
    }

    const existing = await knex.raw(
      `SELECT 1 FROM pg_constraint WHERE conname = 'patient_team_assignments_patient_id_org_unit_id_unique'`,
    );
    if (!existing.rows.length && (await knex.schema.hasTable('patient_team_assignments'))) {
      await knex.raw(`
        ALTER TABLE patient_team_assignments
        ADD CONSTRAINT patient_team_assignments_patient_id_org_unit_id_unique
        UNIQUE (patient_id, org_unit_id)
      `);
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_episodes_one_open_per_type');
  await knex.raw('ALTER TABLE patient_team_assignments DROP CONSTRAINT IF EXISTS patient_team_assignments_patient_id_org_unit_id_unique');
}
