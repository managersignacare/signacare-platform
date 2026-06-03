import type { Knex } from 'knex';

/**
 * BUG-325
 *
 * Remove dead `trg_llm_interactions_updated_at` trigger.
 *
 * Why this is safe:
 * - BUG-286 made `llm_interactions` append-only at DB level via
 *   BEFORE UPDATE/DELETE immutability triggers + privilege revoke.
 * - UPDATE on `llm_interactions` now raises before any updated_at stamp
 *   can run, so the legacy updated_at trigger is unreachable dead code.
 * - Keeping unreachable triggers increases schema noise and can mislead
 *   operators during incident triage.
 */

export async function up(knex: Knex): Promise<void> {
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS trg_llm_interactions_updated_at ON llm_interactions');
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS trg_llm_interactions_updated_at ON llm_interactions');

  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER trg_llm_interactions_updated_at
      BEFORE UPDATE ON llm_interactions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
}
