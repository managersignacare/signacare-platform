import type { Knex } from 'knex';

/**
 * S1.3 — Persistent backup configuration + history
 *
 * Replaces the in-memory `backupConfig` object in
 * apps/api/src/features/backup/backupRoutes.ts with two real DB tables:
 *
 *   backup_config   — single-row table holding the schedule + retention
 *                     + offsite target. Survives process restarts.
 *
 *   backup_history  — append-only ledger of every backup attempt
 *                     (scheduled and manual). Indexed by started_at so
 *                     the admin UI can paginate recent runs cheaply.
 *
 * Neither table has a clinic_id — backups are global, admin-only.
 * RLS is intentionally not enabled (RLS would prevent the cron worker,
 * which has no request context, from reading the schedule).
 *
 * Append-only migration with hasTable / hasColumn guards. Never edited
 * after merge. Down migration is a no-op to avoid data loss in any
 * environment that has accumulated backup history.
 */

export async function up(knex: Knex): Promise<void> {
  // ── backup_config ──────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('backup_config'))) {
    await knex.schema.createTable('backup_config', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.boolean('schedule_enabled').notNullable().defaultTo(true);
      // Frequency: 'hourly' | 'daily' | 'weekly'.
      t.string('frequency', 16).notNullable().defaultTo('daily');
      // Wall-clock time for daily/weekly runs (HH:MM, 24h, local time).
      t.string('time_of_day', 5).notNullable().defaultTo('02:00');
      t.integer('retention_days').notNullable().defaultTo(30);
      // Local destination directory (legacy code path; may be empty when
      // BLOB_STORAGE_BACKEND=s3 is in use).
      t.text('local_dir').nullable();
      // Offsite target — currently 's3://bucket/prefix' or null.
      t.text('offsite_target').nullable();
      // Last run cache (denormalised so the GET /config endpoint is fast).
      t.timestamp('last_run_at', { useTz: true }).nullable();
      t.string('last_run_status', 16).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    // Enforce single-row semantics via a partial unique index on the
    // constant `true`. Any second INSERT would violate the constraint.
    await knex.raw('CREATE UNIQUE INDEX backup_config_singleton_idx ON backup_config((true))');
    // Seed the initial row with the prior in-memory defaults so the
    // existing scheduler starts up unchanged.
    await knex('backup_config').insert({
      schedule_enabled: true,
      frequency: 'daily',
      time_of_day: '02:00',
      retention_days: 30,
      local_dir: null,
    });
  }

  // ── backup_history ─────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('backup_history'))) {
    await knex.schema.createTable('backup_history', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('finished_at', { useTz: true }).nullable();
      // 'running' | 'success' | 'failed' | 'verified' | 'restored'
      t.string('status', 16).notNullable();
      t.bigInteger('size_bytes').nullable();
      // Where the artifact ended up: local path or s3 key.
      t.text('location').nullable();
      t.text('error_text').nullable();
      // 'manual' | 'scheduled' | 'restore_drill'
      t.string('trigger_kind', 16).notNullable().defaultTo('manual');
      t.uuid('triggered_by_staff_id').nullable();
      t.index(['started_at']);
      t.index(['status']);
      t.index(['trigger_kind']);
    });
  }
}

export async function down(): Promise<void> {
  // Down migrations are intentionally no-ops in this codebase to avoid
  // dropping tables that contain operational history.
}
