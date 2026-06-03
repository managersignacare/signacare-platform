/**
 * BUG-287 regression — audit_log SHA-256 hash-chain restoration.
 *
 * Contract after A2-3:
 * 1) audit_log rows carry non-null prev_hash + row_hash.
 * 2) per-scope baseline signatures exist (`system_reconciliation_baseline`).
 * 3) the stored chain validates end-to-end (expected prev + expected row hash).
 * 4) new inserts append to the current tail hash for the scope.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const SYSTEM_SCOPE = '__system__';

describe.skipIf(!READY)('BUG-287 — audit_log hash chain', () => {
  let clinicId = '';

  beforeAll(async () => {
    const session = await loginAsAdmin();
    clinicId = session.clinicId;
  });

  it('F1 — hash columns and chain_ordinal exist and are NOT NULL', async () => {
    const result = await dbAdmin.raw<{
      rows: Array<{ column_name: string; is_nullable: string }>;
    }>(
      `
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'audit_log'
        AND column_name IN ('prev_hash', 'row_hash', 'chain_ordinal')
      ORDER BY column_name
    `,
    );

    expect(result.rows.map((r) => r.column_name)).toEqual([
      'chain_ordinal',
      'prev_hash',
      'row_hash',
    ]);
    for (const row of result.rows) {
      expect(row.is_nullable).toBe('NO');
    }
  });

  it('F2 — baseline signatures exist for every active chain scope', async () => {
    const result = await dbAdmin.raw<{ rows: Array<{ missing_count: string }> }>(
      `
      WITH active_scopes AS (
        SELECT DISTINCT COALESCE(clinic_id::text, '${SYSTEM_SCOPE}') AS scope_key
        FROM audit_log
      )
      SELECT COUNT(*)::text AS missing_count
      FROM active_scopes s
      LEFT JOIN audit_log_chain_baselines b
        ON b.scope_key = s.scope_key
      WHERE b.scope_key IS NULL
    `,
    );

    expect(Number.parseInt(result.rows[0]?.missing_count ?? '0', 10)).toBe(0);
  });

  it('F3 — stored chain validates end-to-end', async () => {
    const result = await dbAdmin.raw<{ rows: Array<{ mismatch_count: string }> }>(
      `
      WITH ordered AS (
        SELECT
          a.id,
          COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}') AS scope_key,
          a.prev_hash,
          a.row_hash,
          COALESCE(
            LAG(a.row_hash) OVER (
              PARTITION BY COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}')
              ORDER BY a.chain_ordinal
            ),
            b.marker_signature
          ) AS expected_prev_hash,
          (to_jsonb(a) - ARRAY['prev_hash', 'row_hash']) AS payload
        FROM audit_log a
        JOIN audit_log_chain_baselines b
          ON b.scope_key = COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}')
      ),
      evaluated AS (
        SELECT
          id,
          prev_hash,
          row_hash,
          expected_prev_hash,
          encode(digest(convert_to(expected_prev_hash || '|' || payload::text, 'UTF8'), 'sha256'), 'hex') AS expected_row_hash
        FROM ordered
      )
      SELECT COUNT(*)::text AS mismatch_count
      FROM evaluated
      WHERE prev_hash IS DISTINCT FROM expected_prev_hash
         OR row_hash IS DISTINCT FROM expected_row_hash
    `,
    );

    expect(Number.parseInt(result.rows[0]?.mismatch_count ?? '0', 10)).toBe(0);
  });

  it('F4 — new insert appends from current tail hash', async () => {
    const scope = clinicId || SYSTEM_SCOPE;

    const tail = await dbAdmin.raw<{ rows: Array<{ tail_hash: string | null }> }>(
      `
      SELECT row_hash AS tail_hash
      FROM audit_log
      WHERE COALESCE(clinic_id::text, '${SYSTEM_SCOPE}') = ?
      ORDER BY chain_ordinal DESC
      LIMIT 1
    `,
      [scope],
    );

    const baseline = await dbAdmin.raw<{ rows: Array<{ marker_signature: string }> }>(
      `
      SELECT marker_signature
      FROM audit_log_chain_baselines
      WHERE scope_key = ?
    `,
      [scope],
    );
    expect(baseline.rows.length).toBe(1);

    const expectedPrev = tail.rows[0]?.tail_hash ?? baseline.rows[0]!.marker_signature;
    const testOperation = `b287_${randomUUID()}`;

    await dbAdmin('audit_log').insert({
      clinic_id: clinicId || null,
      staff_id: null,
      user_id: null,
      username: 'system_reconciliation_baseline',
      action: 'BUG_287_HASH_PROBE',
      operation: testOperation,
      module: 'a2',
      entity_type: 'audit_log',
      entity_id: randomUUID(),
      table_name: 'audit_log',
      record_id: randomUUID(),
      details: JSON.stringify({ bug: 'BUG-287', probe: true }),
      new_data: JSON.stringify({ bug: 'BUG-287', probe: true }),
      old_data: null,
      ip_address: null,
      user_agent: null,
      created_at: new Date(),
    });

    const inserted = await dbAdmin.raw<{
      rows: Array<{
        prev_hash: string;
        row_hash: string;
        recomputed_row_hash: string;
      }>;
    }>(
      `
      SELECT
        a.prev_hash,
        a.row_hash,
        encode(digest(convert_to(a.prev_hash || '|' || (to_jsonb(a) - ARRAY['prev_hash', 'row_hash'])::text, 'UTF8'), 'sha256'), 'hex') AS recomputed_row_hash
      FROM audit_log a
      WHERE a.operation = ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 1
    `,
      [testOperation],
    );

    expect(inserted.rows.length).toBe(1);
    expect(inserted.rows[0]!.prev_hash).toBe(expectedPrev);
    expect(inserted.rows[0]!.row_hash).toBe(inserted.rows[0]!.recomputed_row_hash);
  });

  it('F5 — same-batch inserts for one scope remain a single linear chain', async () => {
    const opA = `b287_batch_a_${randomUUID()}`;
    const opB = `b287_batch_b_${randomUUID()}`;

    await dbAdmin('audit_log').insert([
      {
        clinic_id: clinicId || null,
        staff_id: null,
        user_id: null,
        username: 'system_reconciliation_baseline',
        action: 'BUG_287_HASH_BATCH_PROBE',
        operation: opA,
        module: 'a2',
        entity_type: 'audit_log',
        entity_id: randomUUID(),
        table_name: 'audit_log',
        record_id: randomUUID(),
        details: JSON.stringify({ bug: 'BUG-287', probe: 'batch-a' }),
        new_data: JSON.stringify({ bug: 'BUG-287', probe: 'batch-a' }),
        old_data: null,
        ip_address: null,
        user_agent: null,
        created_at: new Date(),
      },
      {
        clinic_id: clinicId || null,
        staff_id: null,
        user_id: null,
        username: 'system_reconciliation_baseline',
        action: 'BUG_287_HASH_BATCH_PROBE',
        operation: opB,
        module: 'a2',
        entity_type: 'audit_log',
        entity_id: randomUUID(),
        table_name: 'audit_log',
        record_id: randomUUID(),
        details: JSON.stringify({ bug: 'BUG-287', probe: 'batch-b' }),
        new_data: JSON.stringify({ bug: 'BUG-287', probe: 'batch-b' }),
        old_data: null,
        ip_address: null,
        user_agent: null,
        created_at: new Date(),
      },
    ]);

    const rows = await dbAdmin.raw<{
      rows: Array<{
        operation: string;
        chain_ordinal: string;
        prev_hash: string;
        row_hash: string;
      }>;
    }>(
      `
      SELECT operation, chain_ordinal::text, prev_hash, row_hash
      FROM audit_log
      WHERE operation IN (?, ?)
      ORDER BY chain_ordinal ASC
    `,
      [opA, opB],
    );

    expect(rows.rows.length).toBe(2);
    expect(rows.rows[1]!.prev_hash).toBe(rows.rows[0]!.row_hash);
  });
});
