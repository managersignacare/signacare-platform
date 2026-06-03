import { Knex } from 'knex';

/**
 * BUG-PHI-PATIENT-CAPACITY (2026-07-01)
 *
 * Problem:
 * Patient PHI columns are encrypted at rest (AES-GCM iv:tag:ciphertext).
 * Ciphertext is materially longer than plaintext, but several patient
 * columns were still sized for plaintext widths (e.g. medicare_reference
 * varchar(10), phone_home varchar(30)). Under encryption-enabled runtime
 * this produced insert/update failures:
 *   SQLSTATE 22001 -> "value too long for type character varying(10|30)"
 *
 * Why 512:
 * Shared schema allows up to 255 chars for some encrypted fields
 * (email_primary, address_line1). AES-GCM storage in iv:tag:ciphertext
 * base64 format expands 255-char plaintext to ~390 chars. 512 gives safe
 * headroom for current max inputs while preserving bounded varchar typing.
 */
export async function up(knex: Knex): Promise<void> {
  // `patients.search_tsv` is a STORED generated column that references
  // `medicare_number`, so Postgres blocks type changes on the source
  // column unless the generated column is dropped first.
  // @migration-raw-exempt: idempotency_guard
  await knex.raw('DROP INDEX IF EXISTS patients_search_tsv_gin');
  await knex.schema.alterTable('patients', (t) => {
    t.dropColumn('search_tsv');
  });

  await knex.schema.alterTable('patients', (t) => {
    t.string('medicare_number', 512).alter();
    t.string('medicare_reference', 512).alter();
    t.string('ihi_number', 512).alter();
    t.string('dva_number', 512).alter();
    t.string('phone_mobile', 512).alter();
    t.string('phone_home', 512).alter();
    t.string('email_primary', 512).alter();
    t.string('address_line1', 512).alter();
    t.string('suburb', 512).alter();
    t.string('nok_phone', 512).alter();
  });

  await knex.schema.alterTable('patients', (t) => {
    t.specificType(
      'search_tsv',
      `tsvector GENERATED ALWAYS AS (
        to_tsvector('english',
          COALESCE(family_name, '')::text || ' ' ||
          COALESCE(given_name, '')::text || ' ' ||
          COALESCE(preferred_name, '')::text || ' ' ||
          COALESCE(emr_number, '')::text || ' ' ||
          COALESCE(medicare_number, '')::text
        )
      ) STORED`,
    );
    t.index(['search_tsv'], 'patients_search_tsv_gin', 'gin');
  });
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: idempotency_guard
  await knex.raw('DROP INDEX IF EXISTS patients_search_tsv_gin');
  await knex.schema.alterTable('patients', (t) => {
    t.dropColumn('search_tsv');
  });

  // Roll back to pre-BUG-PHI-PATIENT-CAPACITY widths.
  await knex.schema.alterTable('patients', (t) => {
    t.string('medicare_number', 30).alter();
    t.string('medicare_reference', 10).alter();
    t.string('ihi_number', 30).alter();
    t.string('dva_number', 30).alter();
    t.string('phone_mobile', 100).alter();
    t.string('phone_home', 30).alter();
    t.string('email_primary', 255).alter();
    t.string('address_line1', 255).alter();
    t.string('suburb', 100).alter();
    t.string('nok_phone', 30).alter();
  });

  await knex.schema.alterTable('patients', (t) => {
    t.specificType(
      'search_tsv',
      `tsvector GENERATED ALWAYS AS (
        to_tsvector('english',
          COALESCE(family_name, '')::text || ' ' ||
          COALESCE(given_name, '')::text || ' ' ||
          COALESCE(preferred_name, '')::text || ' ' ||
          COALESCE(emr_number, '')::text || ' ' ||
          COALESCE(medicare_number, '')::text
        )
      ) STORED`,
    );
    t.index(['search_tsv'], 'patients_search_tsv_gin', 'gin');
  });
}
