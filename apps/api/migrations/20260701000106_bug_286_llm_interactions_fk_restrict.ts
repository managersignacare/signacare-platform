import type { Knex } from 'knex';

/**
 * BUG-286 follow-up — align llm_interactions foreign keys with append-only
 * immutability.
 *
 * Why this is required:
 * - BUG-286 makes llm_interactions append-only via BEFORE UPDATE/DELETE
 *   triggers.
 * - The historical foreign keys on user_id / patient_id / episode_id still
 *   used ON DELETE SET NULL, which internally issues an UPDATE against
 *   llm_interactions.
 * - That means any hard-delete of a referenced staff/patient/episode row
 *   collides with the immutability trigger and surfaces as noisy DB errors.
 *
 * Gold-standard stance:
 * - Audit-class rows should preserve their original relationship pointers.
 * - Hard deletes of referenced domain rows must be rejected; operational
 *   cleanup should use soft delete / deactivation instead.
 * - New installs must not recreate the stale mutable-FK shape.
 *
 * Scope:
 * - Replace the three mutable FKs with RESTRICT delete rules.
 * - Re-drop the dead updated_at trigger defensively so upgraded DBs with
 *   partial migration history still converge on the immutable shape.
 */

export async function up(knex: Knex): Promise<void> {
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS trg_llm_interactions_updated_at ON llm_interactions');

  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`
    ALTER TABLE llm_interactions
      DROP CONSTRAINT IF EXISTS llm_interactions_user_id_foreign,
      DROP CONSTRAINT IF EXISTS llm_interactions_patient_id_foreign,
      DROP CONSTRAINT IF EXISTS llm_interactions_episode_id_foreign
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE llm_interactions
      ADD CONSTRAINT llm_interactions_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES staff(id) ON DELETE RESTRICT,
      ADD CONSTRAINT llm_interactions_patient_id_foreign
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
      ADD CONSTRAINT llm_interactions_episode_id_foreign
        FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE RESTRICT
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Honest reversal of THIS migration only. BUG-325 separately owns the
  // dead-trigger removal, so we do not recreate trg_llm_interactions_updated_at
  // here.

  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`
    ALTER TABLE llm_interactions
      DROP CONSTRAINT IF EXISTS llm_interactions_user_id_foreign,
      DROP CONSTRAINT IF EXISTS llm_interactions_patient_id_foreign,
      DROP CONSTRAINT IF EXISTS llm_interactions_episode_id_foreign
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE llm_interactions
      ADD CONSTRAINT llm_interactions_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES staff(id) ON DELETE SET NULL,
      ADD CONSTRAINT llm_interactions_patient_id_foreign
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
      ADD CONSTRAINT llm_interactions_episode_id_foreign
        FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE SET NULL
  `);
}
