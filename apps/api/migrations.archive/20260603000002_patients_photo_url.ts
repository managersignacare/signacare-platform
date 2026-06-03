import type { Knex } from 'knex';

/**
 * Phase 0.7.5 c24 D11 — SD52 fix: add patients.photo_url column.
 *
 * crossRoleFeatureRoutes.ts (POST /patients/:id/photo) uploads a
 * patient photo to blob storage, then UPDATEs the `patients` row
 * with `photo_url`. That column did not exist. Every photo upload
 * was crashing at the UPDATE with "column 'photo_url' does not
 * exist" — the file was still written to S3/local but the DB had
 * no way to reference it, so photos disappeared on the next GET.
 *
 * Single-column add; text (nullable) to hold the storage URL. No
 * backfill needed (NULL = "no photo uploaded yet", matches existing
 * behavior for patients who never had a photo).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('patients', (t) => {
    t.text('photo_url');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('patients', (t) => {
    t.dropColumn('photo_url');
  });
}
