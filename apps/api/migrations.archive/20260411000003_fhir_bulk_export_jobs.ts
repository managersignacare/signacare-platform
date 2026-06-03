import type { Knex } from 'knex';

/**
 * S3.2 — FHIR Bulk Data Access $export jobs
 *
 * Backs the asynchronous kickoff → poll → download flow defined by
 * https://hl7.org/fhir/uv/bulkdata/export.html. The pre-S3.2 stub did
 * the export synchronously inside the request handler — readable for
 * a demo, OOM-prone at scale, and not spec-compliant.
 *
 * Lifecycle of a row:
 *   - kickoff inserts with status='accepted'
 *   - worker picks it up, sets status='in_progress', started_at=now()
 *   - worker writes NDJSON to BlobStorage, populates output_files (a
 *     JSON array of {type, url, count}) and sets status='completed'
 *   - failure path sets status='failed', error_text=<message>
 *   - DELETE /$export-status/:id sets status='cancelled' (idempotent)
 *
 * RLS: clinic_id is the partition key. The export endpoint always sets
 * clinic_id from req.clinicId so a clinic A user can never poll a
 * clinic B export.
 *
 * Append-only migration with hasTable guard. Down is a no-op.
 */

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('fhir_bulk_export_jobs'))) {
    await knex.schema.createTable('fhir_bulk_export_jobs', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable();
      t.uuid('requested_by_staff_id').notNullable();

      // Spec-defined parameters
      t.specificType('types', 'text[]').notNullable(); // _type filter
      t.timestamp('since', { useTz: true }).nullable(); // _since filter
      t.text('request_url').notNullable(); // original kickoff URL for the manifest
      t.text('group_id').nullable(); // populated for /Group/[id]/$export

      // State
      // 'accepted' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
      t.string('status', 16).notNullable().defaultTo('accepted');
      t.text('error_text').nullable();

      // Output manifest (JSONB array of { type, url, count, sizeBytes })
      // Populated by the worker as files are written.
      t.jsonb('output_files').notNullable().defaultTo('[]');

      // Progress tracking — used in the X-Progress header during polling
      t.integer('total_resources').nullable();
      t.integer('exported_resources').notNullable().defaultTo(0);

      t.timestamp('started_at', { useTz: true }).nullable();
      t.timestamp('finished_at', { useTz: true }).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
      t.index(['status']);
      t.index(['created_at']);
    });
  }
}

export async function down(): Promise<void> {
  // No-op. Bulk export rows are operational history; we don't drop them
  // on rollback.
}
