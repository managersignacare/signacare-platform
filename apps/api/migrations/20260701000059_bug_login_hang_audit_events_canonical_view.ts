// apps/api/migrations/20260701000059_bug_login_hang_audit_events_canonical_view.ts
//
// BUG-LOGIN-HANG / A2 reader-side semantics:
// replay-safe audit writers rely on dedupe_key + ON CONFLICT DO NOTHING.
// Consumers must still read through a canonical surface so retry/replay
// attempts never show duplicate forensic events to operators.
//
// View contract:
//   - One row per dedupe key (`dedupe_key`), newest wins.
//   - Legacy rows without dedupe_key are preserved 1:1 via id fallback.
//   - Shape remains `SELECT *` compatible with existing audit_log readers.
//
// Reader rule: forensic/compliance timelines should query
// `audit_events_canonical` instead of `audit_log` directly.

import type { Knex } from 'knex';

const VIEW_NAME = 'audit_events_canonical';

export async function up(knex: Knex): Promise<void> {
  // @migration-raw-exempt: view_create
  await knex.raw(`
    CREATE OR REPLACE VIEW ${VIEW_NAME} AS
    SELECT DISTINCT ON (COALESCE(dedupe_key, id::text))
      *
    FROM audit_log
    ORDER BY
      COALESCE(dedupe_key, id::text),
      created_at DESC,
      id DESC
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: view_drop
  await knex.raw(`DROP VIEW IF EXISTS ${VIEW_NAME}`);
}

