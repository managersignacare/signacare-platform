import type { Knex } from 'knex';

/**
 * S3.3 — Postgres full-text search
 *
 * Adds a generated `search_tsv` tsvector column + GIN index to three
 * tables:
 *
 *   patients              — searchable on family_name, given_name,
 *                           preferred_name, emr_number
 *   clinical_notes        — searchable on title + content
 *   correspondence_letters — searchable on subject + body + content
 *
 * Why generated columns instead of triggers: a STORED generated column
 * is computed once per row UPDATE/INSERT and is the simplest, most
 * Postgres-native way to maintain a tsvector. No triggers to debug, no
 * ON-CONFLICT-DO-UPDATE quirks, no double-write race in the
 * application layer. Postgres 12+.
 *
 * Search is via `websearch_to_tsquery('english', ?)` so the application
 * can pass user input directly without parsing — Postgres handles
 * `"quoted phrases"`, `or`, `-not`, etc. The repo's existing ILIKE
 * search is kept as a short-query fallback (queries < 3 chars don't
 * play well with FTS stemming).
 *
 * Multi-tenant: the search query MUST still include `where clinic_id
 * = ?` because GIN indexes do not enforce tenancy. The dashboard /
 * patient list / correspondence search routes already do this — the
 * S2.5 dbRead refactor and the S0.2 naming guard both verified the
 * filter is in place.
 *
 * Append-only with hasColumn guards. Down is a no-op.
 */

const COLUMNS_TO_ADD = [
  {
    table: 'patients',
    expression: `
      to_tsvector('english',
        coalesce(family_name, '') || ' ' ||
        coalesce(given_name, '') || ' ' ||
        coalesce(preferred_name, '') || ' ' ||
        coalesce(emr_number, '') || ' ' ||
        coalesce(medicare_number, '')
      )
    `,
  },
  {
    table: 'clinical_notes',
    expression: `
      to_tsvector('english',
        coalesce(title, '') || ' ' || coalesce(content, '')
      )
    `,
  },
  {
    table: 'correspondence_letters',
    expression: `
      to_tsvector('english',
        coalesce(subject, '') || ' ' ||
        coalesce(body, '') || ' ' ||
        coalesce(content, '')
      )
    `,
  },
];

export async function up(knex: Knex): Promise<void> {
  for (const { table, expression } of COLUMNS_TO_ADD) {
    if (!(await knex.schema.hasTable(table))) {
      // Defensive — the v2 baseline creates all three. Skip if absent.
      continue;
    }
    if (!(await knex.schema.hasColumn(table, 'search_tsv'))) {
      // Knex doesn't have a builder for GENERATED ALWAYS AS ... STORED,
      // so we use raw SQL. Postgres 12+ supports this; we are on 16.
      await knex.raw(
        `ALTER TABLE ${table}
         ADD COLUMN search_tsv tsvector
         GENERATED ALWAYS AS (${expression}) STORED`,
      );
    }
    // Create the GIN index. IF NOT EXISTS keeps the migration safe to
    // re-run on environments where the column was added by hand earlier.
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS ${table}_search_tsv_gin
       ON ${table} USING gin(search_tsv)`,
    );
  }
}

export async function down(): Promise<void> {
  // No-op. Dropping a generated column on a populated table on
  // rollback would be a write-amplification bomb.
}
