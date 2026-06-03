import type { Knex } from 'knex';

/**
 * BUG-SCRIBE25-003
 *
 * Add deterministic lineage keys to scribe_action_items so equivalent
 * proposals from in-visit and post-sign flows converge to one row.
 */
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('scribe_action_items', 'lineage_key');
  if (!hasColumn) {
    await knex.schema.alterTable('scribe_action_items', (t) => {
      t.string('lineage_key', 64).nullable();
    });
  }

  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    UPDATE scribe_action_items
    SET lineage_key = substring(
      encode(
        digest(
          lower(
            concat_ws(
              '|',
              coalesce(item_type, ''),
              regexp_replace(trim(coalesce(description, '')), '\\s+', ' ', 'g'),
              coalesce(assignee_role, ''),
              coalesce(to_char(due_date, 'YYYY-MM-DD'), '')
            )
          )::bytea,
          'sha256'
        ),
        'hex'
      ),
      1, 48
    )
    WHERE lineage_key IS NULL
  `);

  await knex.schema.alterTable('scribe_action_items', (t) => {
    t.string('lineage_key', 64).notNullable().alter();
  });

  // @migration-raw-exempt: index_functional
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_scribe_action_items_lineage
      ON scribe_action_items (clinic_id, session_id, lineage_key)
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: index_functional
  await knex.raw('DROP INDEX IF EXISTS uq_scribe_action_items_lineage');

  const hasColumn = await knex.schema.hasColumn('scribe_action_items', 'lineage_key');
  if (hasColumn) {
    await knex.schema.alterTable('scribe_action_items', (t) => {
      t.dropColumn('lineage_key');
    });
  }
}
