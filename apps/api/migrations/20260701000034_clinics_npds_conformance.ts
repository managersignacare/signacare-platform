// apps/api/migrations/20260701000034_clinics_npds_conformance.ts
//
// BUG-302 — per-clinic NPDS conformance ID + eRx ETP1 site ID.
//
// Pre-fix: NPDS_CONFORMANCE_ID was loaded from a single env var
// (npdsClient.ts:87), so every clinic on a multi-tenant Signacare
// instance submitted eScripts to NPDS under the same identity.
// ADHA conformance requires per-clinic attribution: each clinic
// participating in eRx has its own conformance ID issued by eRx
// and its own ETP1 site ID for the Adapter pathway.
//
// This migration adds two columns to the clinics table; the
// npdsClient change + boot assertion + request-time per-clinic
// lookup land in the same commit.
//
// Both columns NULLABLE — clinics that don't prescribe don't need
// IDs; clinics that do need eRx will fail the request-time check
// with HttpError 503 ERX_NOT_CONFIGURED until ops backfills via
// admin UI (tracked as BUG-339 follow-up). Boot assertion Check
// 7.6 surfaces misconfigured clinics in WARN mode (STRICT_NPDS_
// CONFORMANCE=true flips to fail-boot).
//
// Standard: ADHA eRx Conformance Profile General Prescribing Systems
// v3.0.1 — per-organisation conformance ID required.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinics', (t) => {
    t.string('npds_conformance_id', 64).nullable();
    t.string('erx_etp1_site_id', 64).nullable();
  });

  // Preflight audit — log null-count so ops track backfill progress.
  // @migration-raw-exempt: introspection
  const result = await knex.raw<{ rows: Array<{ count: string }> }>(`
    SELECT COUNT(*)::text AS count FROM clinics WHERE npds_conformance_id IS NULL
  `);
  const nullCount = result.rows?.[0]?.count ?? '0';
  // eslint-disable-next-line no-console
  console.log(`[BUG-302 preflight] clinics with NULL npds_conformance_id after migration: ${nullCount}. Ops must backfill per-clinic before STRICT_NPDS_CONFORMANCE=true.`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinics', (t) => {
    t.dropColumn('erx_etp1_site_id');
    t.dropColumn('npds_conformance_id');
  });
}
