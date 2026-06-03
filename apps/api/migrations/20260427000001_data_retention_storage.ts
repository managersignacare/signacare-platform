/**
 * BUG-374a — data-retention storage layer.
 *
 * Adds 4 columns to `clinics` (per-clinic retention configuration) +
 * 2 columns to `patients` (deceased clock per Q2b + purge sentinel).
 *
 * Policy locked 2026-04-26 (project_data_retention_policy.md):
 *   - 25-year minimum floor; NO purge before that floor.
 *   - Per-subscription configurable upward via Power Settings UI.
 *   - DB CHECK enforces floor as the L4 defence layer (Zod min(25)
 *     at the route is L1+L2; service-layer guard is L3; this CHECK
 *     is L4; cron predicate uses MAX(25, configured) as L5).
 *
 * Down() drops all 6 columns. Reversible.
 *
 * Builder-first per CLAUDE.md §12.1; raw() only for the CHECK
 * constraint per §12.4 taxonomy.
 *
 * fix-registry anchors: BUG-374A-COLUMN-EXISTS, BUG-374A-CHECK-FLOOR-25,
 * BUG-374A-PURGE-DEFAULT-FALSE, BUG-374A-DECEASED-DATE-COLUMN.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Per-clinic retention configuration on `clinics`.
  await knex.schema.alterTable('clinics', (t) => {
    t.integer('data_retention_years').notNullable().defaultTo(25);
    t.boolean('retention_purge_enabled').notNullable().defaultTo(false);
    t.timestamp('retention_purge_enabled_at', { useTz: true }).nullable();
    t.uuid('retention_purge_enabled_by_staff_id')
      .nullable()
      .references('id')
      .inTable('staff')
      .onDelete('SET NULL');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinics
      ADD CONSTRAINT clinics_data_retention_years_check
      CHECK (data_retention_years >= 25)
  `);

  // Q2b — deceased clock + purge sentinel on `patients`.
  await knex.schema.alterTable('patients', (t) => {
    t.date('deceased_date').nullable();
    t.timestamp('purged_at', { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(
    'ALTER TABLE clinics DROP CONSTRAINT IF EXISTS clinics_data_retention_years_check',
  );

  await knex.schema.alterTable('patients', (t) => {
    t.dropColumn('purged_at');
    t.dropColumn('deceased_date');
  });

  await knex.schema.alterTable('clinics', (t) => {
    t.dropColumn('retention_purge_enabled_by_staff_id');
    t.dropColumn('retention_purge_enabled_at');
    t.dropColumn('retention_purge_enabled');
    t.dropColumn('data_retention_years');
  });
}
