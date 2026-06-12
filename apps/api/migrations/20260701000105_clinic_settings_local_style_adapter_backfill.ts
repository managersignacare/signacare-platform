import { Knex } from 'knex';

const TABLE_NAME = 'clinic_settings';
const COLUMN_NAME = 'local_style_adapter_model_name';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(TABLE_NAME, COLUMN_NAME);
  if (hasColumn) {
    return;
  }

  await knex.schema.alterTable(TABLE_NAME, (t) => {
    t.string(COLUMN_NAME, 200).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(TABLE_NAME, COLUMN_NAME);
  if (!hasColumn) {
    return;
  }

  await knex.schema.alterTable(TABLE_NAME, (t) => {
    t.dropColumn(COLUMN_NAME);
  });
}
