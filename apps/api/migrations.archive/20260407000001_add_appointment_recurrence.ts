import type { Knex } from 'knex';

/**
 * Add recurrence columns to appointments table.
 * These are referenced by appointmentService.createRecurring() but were
 * never added to the schema.
 */
export async function up(knex: Knex): Promise<void> {
  // Appointment recurrence
  const hasRecurrenceRule = await knex.schema.hasColumn('appointments', 'recurrence_rule');
  if (!hasRecurrenceRule) {
    await knex.schema.alterTable('appointments', (t) => {
      t.string('recurrence_rule', 30).nullable();
      t.date('recurrence_end_date').nullable();
      t.uuid('recurrence_parent_id').nullable().references('id').inTable('appointments').onDelete('SET NULL');
      t.index(['recurrence_parent_id']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn('appointments', 'recurrence_rule');
  if (hasCol) {
    await knex.schema.alterTable('appointments', (t) => {
      t.dropColumn('recurrence_parent_id');
      t.dropColumn('recurrence_end_date');
      t.dropColumn('recurrence_rule');
    });
  }
}
