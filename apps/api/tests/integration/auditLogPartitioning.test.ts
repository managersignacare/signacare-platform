/**
 * audit_log table partitioning.
 *
 * KNOWN GAP (it.fails): the v2_baseline migration creates audit_log
 * as a plain table — NO `PARTITION BY` clause, NO monthly child
 * partitions. Over a multi-year clinical deployment the table will
 * grow to hundreds of millions of rows, making:
 *
 *   - Routine queries slow (even with the indexes we do have)
 *   - VACUUM passes expensive and long
 *   - 7-year retention deletes catastrophic (ACHS + APP retention
 *     requires audit rows for 7 years, then deletion)
 *
 * The fix shape is:
 *   1. New migration: ALTER audit_log to be a partitioned table
 *      with PARTITION BY RANGE (created_at)
 *   2. Monthly child partitions created by a nightly job (or
 *      pg_partman extension)
 *   3. 7-year retention implemented by DROP PARTITION on the
 *      oldest monthly child — O(1) instead of O(N) DELETE
 *
 * This test queries pg_partitioned_table to verify the partitioning
 * is in place. It's it.fails today because the migration doesn't
 * exist; it will flip green the day the migration lands.
 *
 * Standard satisfied: Australian Privacy Act 1988 APP 11.2 (7-year
 *                     retention), ACHS Standard 1 (auditable
 *                     clinical record), ISO 27001 A.12.3.
 */

import { describe, it, expect } from 'vitest';
import { isIntegrationReady } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('audit_log table partitioning', () => {
  // BUG-288 — deferred to post-staging hardening wave. The 3 scenarios
  // below mark the intended invariant via `it.fails` (vitest's
  // expected-to-fail marker): pre-implementation the test FAILS and
  // `it.fails` treats that as PASS; post-implementation the test
  // PASSES and `it.fails` inverts to FAIL so a reviewer re-opens.
  //
  // Rationale for deferral (catalogued in docs/quality/bugs-remaining.md):
  // - Converting a live tamper-evident audit_log to a partitioned
  //   table while preserving the BUG-039 append-only trigger, the 2
  //   RLS policies, 5 indexes, and 7-year data retention is a 1-2 day
  //   migration with material operational risk (the fastest
  //   rollback path is a restore from backup).
  // - Current plain-table implementation performs acceptably up to
  //   ~100M rows; staging + early production will be well under that.
  // - Best executed post-staging, after the backup/restore drill
  //   (docs/operations/runbooks/backup-restore-drill.md) is proven
  //   and a partition-management job (e.g. pg_partman) is chosen.
  // - Does NOT block Azure staging cutover.
  it.fails('audit_log is declared as a partitioned table', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const result = await dbAdmin.raw<{ rows: Array<{ partstrat: string }> }>(
      `SELECT partstrat FROM pg_partitioned_table
       WHERE partrelid = 'public.audit_log'::regclass`,
    );
    expect(result.rows.length).toBe(1);
    // 'r' = range partitioning (by created_at); the expected strategy
    expect(result.rows[0].partstrat).toBe('r');
  });

  it.fails('audit_log has at least one monthly child partition for the current month', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const result = await dbAdmin.raw<{ rows: Array<{ inhrelid: string }> }>(
      `SELECT inhrelid::regclass::text AS inhrelid
       FROM pg_inherits
       WHERE inhparent = 'public.audit_log'::regclass`,
    );
    // At least one child partition must exist — the current month
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  it.fails('audit_log retention policy: the oldest partition is ≤ 7 years old', async () => {
    // APP 11.2 + Australian health records legislation require
    // 7-year retention, then deletion. A partitioning strategy
    // drops the oldest partition once it crosses the 7-year mark.
    // This test will flip green when (a) partitioning exists and
    // (b) a retention job drops partitions older than 84 months.
    const { dbAdmin } = await import('../../src/db/db');
    const result = await dbAdmin.raw<{ rows: Array<{ partition_name: string; min_created: Date }> }>(
      `SELECT
         inhrelid::regclass::text AS partition_name,
         (SELECT MIN(created_at) FROM public.audit_log) AS min_created
       FROM pg_inherits
       WHERE inhparent = 'public.audit_log'::regclass
       LIMIT 1`,
    );
    if (result.rows.length === 0) {
      throw new Error('No audit_log partitions exist yet');
    }
    const minCreated = new Date(result.rows[0].min_created);
    const ageYears = (Date.now() - minCreated.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    expect(ageYears).toBeLessThanOrEqual(7);
  });

  // POSITIVE CONTROL: what IS true today — the table exists and
  // has the expected core indexes. This assertion passes and
  // documents the baseline the partitioning migration will build on.
  describe('Baseline (passes today — baseline for future partition migration)', () => {
    it('audit_log has indexes covering clinic_id AND created_at (any combination)', async () => {
      const { dbAdmin } = await import('../../src/db/db');
      const result = await dbAdmin.raw<{ rows: Array<{ indexdef: string }> }>(
        `SELECT indexdef FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'audit_log'`,
      );
      const defs = result.rows.map((r) => r.indexdef);
      // Accept either a combined (clinic_id, created_at) composite
      // OR two separate single-column indexes. Both give the query
      // planner the information needed to efficiently scan recent
      // audit rows per tenant — the combined form is marginally
      // more efficient but both are acceptable for the baseline.
      const hasCombined = defs.some((d) =>
        /\(\s*clinic_id\b[^)]*created_at\b/i.test(d),
      );
      const hasClinicIdx = defs.some((d) => /\(\s*clinic_id\s*\)/i.test(d));
      const hasCreatedIdx = defs.some((d) => /\(\s*created_at\b/i.test(d));
      expect(hasCombined || (hasClinicIdx && hasCreatedIdx)).toBe(true);
    });

    it('audit_log row count is queryable without timing out', async () => {
      const { dbAdmin } = await import('../../src/db/db');
      const r = await dbAdmin('audit_log').count<{ count: string }>('id as count').first();
      expect(Number(r?.count ?? 0)).toBeGreaterThanOrEqual(0);
    });
  });
});
