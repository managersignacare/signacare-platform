// apps/api/migrations/20260701000056_bug_706_patient_identifier_ciphertext_width.ts
//
// BUG-706 — patient identifier ciphertext exceeds VARCHAR(30).
//
// Root cause:
//   `patients.medicare_number`, `patients.ihi_number`, and
//   `patients.dva_number` are encrypted (AES-GCM payload), but the
//   baseline schema constrains each to VARCHAR(30). Real ciphertext is
//   substantially longer, causing INSERT/UPDATE failures on valid
//   patient registration flows.
//
// Fix:
//   widen all three ciphertext columns to TEXT.
//
// Safety:
//   this is a widening change only (no data rewrite).
//   DOWN path refuses to shrink if any value exceeds 30 chars.

import type { Knex } from 'knex';

const TABLE = 'patients';
// `search_tsv` is a generated column depending on medicare_number.
// Postgres requires dropping/recreating it around type changes.
const SEARCH_TSV_EXPRESSION = `
  to_tsvector(
    'english',
    COALESCE(family_name, '') || ' ' ||
    COALESCE(given_name, '') || ' ' ||
    COALESCE(preferred_name, '') || ' ' ||
    COALESCE(emr_number, '') || ' ' ||
    COALESCE(medicare_number, '')
  )
`;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(TABLE, (table) => {
    table.dropColumn('search_tsv');
  });

  await knex.schema.alterTable(TABLE, (table) => {
    table.text('medicare_number').alter();
    table.text('ihi_number').alter();
    table.text('dva_number').alter();
  });

  await knex.schema.alterTable(TABLE, (table) => {
    table.specificType('search_tsv', `tsvector GENERATED ALWAYS AS (${SEARCH_TSV_EXPRESSION}) STORED`);
    table.index('search_tsv', 'patients_search_tsv_gin', 'gin');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(TABLE, (table) => {
    table.dropColumn('search_tsv');
  });

  // Guard against silent truncation if ciphertext already exceeds legacy width.
  // @migration-raw-exempt: rollback_safety_check
  const overflow = await knex.raw(
    `
      SELECT COUNT(*)::int AS count
      FROM ${TABLE}
      WHERE
        COALESCE(length(medicare_number), 0) > 30
        OR COALESCE(length(ihi_number), 0) > 30
        OR COALESCE(length(dva_number), 0) > 30
    `,
  );
  const overflowCount = Number(overflow.rows?.[0]?.count ?? 0);
  if (overflowCount > 0) {
    throw new Error(
      `Cannot rollback ${TABLE} ciphertext columns to VARCHAR(30): ${overflowCount} rows exceed width.`,
    );
  }

  await knex.schema.alterTable(TABLE, (table) => {
    table.string('medicare_number', 30).alter();
    table.string('ihi_number', 30).alter();
    table.string('dva_number', 30).alter();
  });

  await knex.schema.alterTable(TABLE, (table) => {
    table.specificType('search_tsv', `tsvector GENERATED ALWAYS AS (${SEARCH_TSV_EXPRESSION}) STORED`);
    table.index('search_tsv', 'patients_search_tsv_gin', 'gin');
  });
}
