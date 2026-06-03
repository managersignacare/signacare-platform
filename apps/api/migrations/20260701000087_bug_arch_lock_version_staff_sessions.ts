import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('staff_sessions', (t) => {
    t.integer('lock_version').notNullable().defaultTo(1);
  });
}

export async function down(knex: Knex): Promise<void> {
  // lock_version columns are append-only under concurrency safety posture.
  void knex;
}
