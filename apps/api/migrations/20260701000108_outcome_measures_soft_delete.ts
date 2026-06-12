import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('outcome_measures');
  if (!hasTable) return;

  const hasDeletedAt = await knex.schema.hasColumn('outcome_measures', 'deleted_at');
  if (!hasDeletedAt) {
    await knex.schema.alterTable('outcome_measures', (t) => {
      t.timestamp('deleted_at', { useTz: true }).nullable();
      t.index(['clinic_id', 'deleted_at'], 'idx_outcome_measures_clinic_deleted_at');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('outcome_measures');
  if (!hasTable) return;

  const hasDeletedAt = await knex.schema.hasColumn('outcome_measures', 'deleted_at');
  if (!hasDeletedAt) return;

  await knex.schema.alterTable('outcome_measures', (t) => {
    t.dropIndex(['clinic_id', 'deleted_at'], 'idx_outcome_measures_clinic_deleted_at');
    t.dropColumn('deleted_at');
  });
}
