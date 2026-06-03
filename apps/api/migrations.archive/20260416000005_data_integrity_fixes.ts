/**
 * Phase 0.7.2 Group C — Data integrity fixes from audit.
 *
 * 1. Add deleted_at to escalations (audit finding 17.1)
 * 2. Add partial indexes on soft-delete columns (audit 17.3)
 * 3. Add appointment status transition CHECK (audit finding #5)
 * 4. Add medication status transition CHECK (audit finding #14)
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. Escalations deleted_at — clinical escalations must be
  //    soft-deleted for audit trail compliance, not hard-deleted.
  if (await knex.schema.hasTable('escalations')) {
    if (!(await knex.schema.hasColumn('escalations', 'deleted_at'))) {
      await knex.schema.alterTable('escalations', (t) => {
        t.timestamp('deleted_at', { useTz: true }).nullable();
      });
    }
    // Partial index for WHERE deleted_at IS NULL queries
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_escalations_deleted_at
      ON escalations (deleted_at) WHERE deleted_at IS NULL
    `);
  }

  // 2. Partial indexes on soft-delete columns for high-traffic tables.
  //    These cover the WHERE deleted_at IS NULL filter that every
  //    query uses — without them, the DB does a full table scan.
  const softDeleteTables = [
    'episodes',
    'clinical_notes',
    'referrals',
    'patient_medications',
    'appointments',
    'tasks',
  ];
  for (const table of softDeleteTables) {
    if (await knex.schema.hasTable(table)) {
      if (await knex.schema.hasColumn(table, 'deleted_at')) {
        await knex.raw(`
          CREATE INDEX IF NOT EXISTS idx_${table}_not_deleted
          ON ${table} (id) WHERE deleted_at IS NULL
        `);
      }
    }
  }

  // 3. Appointment status transition CHECK — prevents setting
  //    status to invalid values via direct SQL.
  if (await knex.schema.hasTable('appointments')) {
    const existing = await knex.raw(
      `SELECT 1 FROM pg_constraint WHERE conname = 'appointments_status_valid'`,
    );
    if ((existing.rows ?? []).length === 0) {
      await knex.raw(`
        ALTER TABLE appointments ADD CONSTRAINT appointments_status_valid
        CHECK (status IN ('scheduled','confirmed','arrived','in_session','completed','cancelled','no_show','rescheduled'))
      `);
    }
  }

  // 4. Medication status CHECK — prevents ceased→active via direct SQL.
  if (await knex.schema.hasTable('patient_medications')) {
    const existing = await knex.raw(
      `SELECT 1 FROM pg_constraint WHERE conname = 'patient_medications_status_valid'`,
    );
    if ((existing.rows ?? []).length === 0) {
      await knex.raw(`
        ALTER TABLE patient_medications ADD CONSTRAINT patient_medications_status_valid
        CHECK (status IN ('active','ceased','ceased_discontinued','paused','draft'))
      `);
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_valid');
  await knex.raw('ALTER TABLE patient_medications DROP CONSTRAINT IF EXISTS patient_medications_status_valid');
  for (const table of ['episodes', 'clinical_notes', 'referrals', 'patient_medications', 'appointments', 'tasks']) {
    await knex.raw(`DROP INDEX IF EXISTS idx_${table}_not_deleted`);
  }
  await knex.raw('DROP INDEX IF EXISTS idx_escalations_deleted_at');
  if (await knex.schema.hasColumn('escalations', 'deleted_at')) {
    await knex.schema.alterTable('escalations', (t) => t.dropColumn('deleted_at'));
  }
}
