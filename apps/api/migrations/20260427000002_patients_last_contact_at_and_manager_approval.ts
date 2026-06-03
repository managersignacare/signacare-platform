/**
 * BUG-374b — destructive retention purge cycle storage.
 *
 * Two-part migration:
 *
 * 1. `patients.last_contact_at timestamptz NULLABLE` — Q-A(a). The 3-clock
 *    purge predicate uses this as the canonical "last clinical contact"
 *    timestamp. Backfilled from GREATEST of:
 *      - MAX(clinical_notes.note_date_time WHERE deleted_at IS NULL)
 *      - MAX(appointments.start_time WHERE deleted_at IS NULL AND
 *            status NOT IN ('cancelled','no_show'))
 *      - MAX(contact_records.created_at)
 *           (contact_records has no deleted_at column per CLAUDE.md §1.4
 *           explicit list — no soft-delete filter is applicable)
 *      - patients.updated_at (fallback)
 *    Going-forward maintenance is BUG-374b-CASCADE-2 (out of this BUG's
 *    scope to bound the surface).
 *
 * 2. `clinics.retention_purge_manager_approved_by_staff_id` +
 *    `clinics.retention_purge_manager_approved_at` — Q-F triple-lock
 *    third gate. Manager approval workflow with segregation of duties
 *    (different staff than `retention_purge_enabled_by_staff_id`) and
 *    30-day TTL enforced at the cron predicate. Both columns nullable;
 *    NULL means "no current approval, purge skipped".
 *
 * Down() drops the 3 columns. Reversible.
 *
 * fix-registry: BUG-374B-LAST-CONTACT-COLUMN.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Q-A(a) — `patients.last_contact_at`
  await knex.schema.alterTable('patients', (t) => {
    t.timestamp('last_contact_at', { useTz: true }).nullable();
  });

  // Backfill from clinical activity. GREATEST returns NULL if all inputs
  // are NULL — fall through to patients.updated_at as final fallback.
  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    UPDATE patients p
    SET last_contact_at = GREATEST(
      (SELECT MAX(cn.note_date_time) FROM clinical_notes cn WHERE cn.patient_id = p.id AND cn.deleted_at IS NULL),
      (SELECT MAX(a.start_time) FROM appointments a WHERE a.patient_id = p.id AND a.deleted_at IS NULL AND a.status NOT IN ('cancelled','no_show')),
      (SELECT MAX(cr.created_at) FROM contact_records cr WHERE cr.patient_id = p.id),
      p.updated_at
    )
    WHERE p.deleted_at IS NULL
  `);

  // Q-F — manager approval workflow columns on clinics
  await knex.schema.alterTable('clinics', (t) => {
    t.uuid('retention_purge_manager_approved_by_staff_id')
      .nullable()
      .references('id')
      .inTable('staff')
      .onDelete('SET NULL');
    t.timestamp('retention_purge_manager_approved_at', { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinics', (t) => {
    t.dropColumn('retention_purge_manager_approved_at');
    t.dropColumn('retention_purge_manager_approved_by_staff_id');
  });
  await knex.schema.alterTable('patients', (t) => {
    t.dropColumn('last_contact_at');
  });
}
