import type { Knex } from 'knex';

const TABLE = 'patient_duty_relationships';
const COLUMN = 'lock_version';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable(TABLE))) return;

  if (!(await knex.schema.hasColumn(TABLE, COLUMN))) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.integer(COLUMN).notNullable().defaultTo(1);
    });
  }

  await knex(TABLE)
    .whereNull(COLUMN)
    .update({ [COLUMN]: 1 });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (!(await knex.schema.hasColumn(TABLE, COLUMN))) return;

  await knex.schema.alterTable(TABLE, (t) => {
    t.dropColumn(COLUMN);
  });
}
