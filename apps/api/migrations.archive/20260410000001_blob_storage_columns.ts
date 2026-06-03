import type { Knex } from 'knex';

/**
 * S1.1 — Blob storage columns
 *
 * Adds `storage_backend`, `storage_key`, `storage_bucket`, `storage_etag`
 * to the three patient attachment tables so the upload code can route files
 * through the BlobStorage facade (apps/api/src/lib/blobStorage.ts) instead
 * of writing directly to local disk via Multer.
 *
 * Defaults to `storage_backend = 'local'` so existing rows continue to work
 * unchanged: the GET handlers fall back to constructing a download URL from
 * `file_path` whenever `storage_key` is NULL.
 *
 * Also defensively adds `clinic_id` to legal/alert attachment tables (with
 * a hasColumn guard so this is a no-op if a prior hand-fix already added
 * it). This is NOT a multi-tenancy fix — backfilling clinic_id values for
 * existing rows is out of scope for S1.1 and will be done in a follow-up
 * migration that references the parent patient row.
 *
 * Append-only migration — never edited after merge.
 */

const TABLES = ['patient_attachments', 'patient_legal_attachments', 'patient_alert_attachments'] as const;

export async function up(knex: Knex): Promise<void> {
  for (const table of TABLES) {
    if (!(await knex.schema.hasTable(table))) {
      // Should never happen — v2 baseline creates all three. Skip safely.
      continue;
    }

    // Knex's schema-builder callback MUST be synchronous — running
    // `await knex.schema.hasColumn(...)` inside it issues overlapping
    // queries on the same pool connection and poisons the migration's
    // transaction with 25P02. Hoist the existence checks out of the
    // builder so the callback stays a pure synchronous builder.
    const [hasBackend, hasKey, hasBucket, hasEtag, hasClinicId] = await Promise.all([
      knex.schema.hasColumn(table, 'storage_backend'),
      knex.schema.hasColumn(table, 'storage_key'),
      knex.schema.hasColumn(table, 'storage_bucket'),
      knex.schema.hasColumn(table, 'storage_etag'),
      knex.schema.hasColumn(table, 'clinic_id'),
    ]);

    if (!hasBackend || !hasKey || !hasBucket || !hasEtag || !hasClinicId) {
      await knex.schema.alterTable(table, (t) => {
        // Storage descriptor columns. Default backend is 'local' so the
        // GET handlers can branch on storage_backend without a NULL check.
        if (!hasBackend) t.text('storage_backend').notNullable().defaultTo('local');
        if (!hasKey)     t.text('storage_key').nullable();
        if (!hasBucket)  t.text('storage_bucket').nullable();
        if (!hasEtag)    t.text('storage_etag').nullable();
        // Defensive clinic_id add for legal/alert attachment tables
        // (the v2 baseline didn't include them on the older tables).
        // Nullable so existing rows survive — a follow-up migration
        // backfills values and tightens the column.
        if (!hasClinicId) t.uuid('clinic_id').nullable();
      });
    }

    // Indexes for backfill / cutover queries. CREATE INDEX IF NOT EXISTS
    // is idempotent on its own, so no try/catch is needed here — a
    // real failure should propagate, not be swallowed.
    await knex.raw(`CREATE INDEX IF NOT EXISTS ${table}_storage_key_idx ON ${table} (storage_key)`);
    await knex.raw(`CREATE INDEX IF NOT EXISTS ${table}_clinic_id_idx ON ${table} (clinic_id)`);
  }
}

export async function down(knex: Knex): Promise<void> {
  // Down migrations are never run in production for this codebase.
  // We leave the schema additions in place to avoid data loss on rollback.
  for (const table of TABLES) {
    try {
      await knex.raw(`DROP INDEX IF EXISTS ${table}_storage_key_idx`);
    } catch {
      // best-effort
    }
  }
}
