import type { Knex } from 'knex';

/**
 * Add key_worker_id to episodes table.
 * Referenced by team-assignments endpoint and referral allocation
 * but was never added to the schema.
 */
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('episodes', 'key_worker_id');
  if (!hasColumn) {
    await knex.schema.alterTable('episodes', (t) => {
      t.uuid('key_worker_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('episodes', 'key_worker_id');
  if (hasColumn) {
    await knex.schema.alterTable('episodes', (t) => {
      t.dropColumn('key_worker_id');
    });
  }
}
