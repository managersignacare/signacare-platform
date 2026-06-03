import type { Knex } from 'knex';

/**
 * BUG-568 — treatment_pathways mutation actor traceability.
 *
 * Problem:
 *   treatment_pathways PATCH and POST /:id/session mutations had no
 *   first-class actor column on the row itself; forensic attribution
 *   relied on implicit JSONB payload history.
 *
 * Fix:
 *   add nullable `updated_by_staff_id` FK to staff(id) with SET NULL
 *   semantics so row history survives staff deactivation/deletion.
 *
 * Notes:
 *   - Nullable by design for legacy rows and system migrations.
 *   - Service-layer audit rows are added separately in BUG-568 code
 *     changes (this migration owns schema only).
 */
const TABLE = 'treatment_pathways';
const COLUMN = 'updated_by_staff_id';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn(TABLE, COLUMN);
  if (has) return;

  await knex.schema.alterTable(TABLE, (t) => {
    // R-FIX-BUG-568-MIGRATION-COLUMN
    t.uuid(COLUMN).nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.index([COLUMN], 'idx_treatment_pathways_updated_by_staff_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn(TABLE, COLUMN);
  if (!has) return;

  await knex.schema.alterTable(TABLE, (t) => {
    t.dropColumn(COLUMN);
  });
}
