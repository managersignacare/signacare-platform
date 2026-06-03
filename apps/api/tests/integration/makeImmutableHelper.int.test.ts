/**
 * BUG-343 — integration tests for shared makeImmutable() migration helper.
 *
 * The helper is the parameterised version of the inline SQL used by
 * BUG-039 (audit_log) and BUG-286 (llm_interactions). BUG-282's
 * llm_prompts_outputs is the first consumer. This test suite validates
 * the helper end-to-end against a real probe table so the SQL emission
 * shape is verified, not just mocked.
 *
 * Coverage (7 DB + 1 unit = 8 tests):
 *   T0 — identifier-validator unit: rejects SQL-injection-style tableName.
 *   T1 — applyImmutability then INSERT: row lands.
 *   T2 — applyImmutability then UPDATE: raises with default message.
 *   T3 — applyImmutability then DELETE: raises with default message.
 *   T4 — app_user grants: UPDATE/DELETE/TRUNCATE revoked, SELECT/INSERT preserved.
 *   T5 — custom errorMessage propagates to the RAISE output verbatim.
 *   T6 — idempotent: applyImmutability twice does not error.
 *   T7 — dropImmutability reverses: UPDATE + DELETE succeed on a fresh probe row post-drop.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isIntegrationReady } from './_helpers';
import {
  applyImmutability,
  dropImmutability,
  SAFE_PG_IDENTIFIER,
} from '../../src/db/migrations-helpers/makeImmutable';

const READY = await isIntegrationReady();

// Identifier-validator unit tests run regardless of DB readiness.
describe('BUG-343 makeImmutable identifier validator (unit)', () => {
  it('T0 — accepts valid Postgres identifiers', () => {
    expect(SAFE_PG_IDENTIFIER.test('audit_log')).toBe(true);
    expect(SAFE_PG_IDENTIFIER.test('bug343_probe')).toBe(true);
    expect(SAFE_PG_IDENTIFIER.test('_underscore_lead')).toBe(true);
  });

  it('T0b — rejects SQL-injection-style identifiers', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Any non-matching identifier must refuse before touching the DB.
    await expect(
      applyImmutability(dbAdmin, { tableName: 'foo; DROP TABLE bar' }),
    ).rejects.toThrow(/not a safe Postgres identifier/);
    await expect(
      applyImmutability(dbAdmin, { tableName: 'FooBar' }), // uppercase rejected by regex
    ).rejects.toThrow(/not a safe Postgres identifier/);
    await expect(
      applyImmutability(dbAdmin, { tableName: '' }),
    ).rejects.toThrow(/not a safe Postgres identifier/);
  });
});

describe.skipIf(!READY)('BUG-343 makeImmutable helper (live DB)', () => {
  const PROBE_TABLE = 'bug343_probe';
  const CUSTOM_TABLE = 'bug343_custom_probe';

  beforeAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Drop if leftover from a previous failed run.
    await dbAdmin.raw(
      `DROP TABLE IF EXISTS ${PROBE_TABLE}; DROP TABLE IF EXISTS ${CUSTOM_TABLE};`,
    );
    await dbAdmin.raw(`DROP FUNCTION IF EXISTS ${PROBE_TABLE}_prevent_mutation()`);
    await dbAdmin.raw(`DROP FUNCTION IF EXISTS ${CUSTOM_TABLE}_prevent_mutation()`);

    await dbAdmin.raw(`
      CREATE TABLE ${PROBE_TABLE} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        v text
      )
    `);
    await applyImmutability(dbAdmin, { tableName: PROBE_TABLE });
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Helper restore then table drop. dropImmutability is re-runnable;
    // safe to call even if not previously applied.
    await dropImmutability(dbAdmin, { tableName: PROBE_TABLE }).catch(() => undefined);
    await dbAdmin.raw(`DROP TABLE IF EXISTS ${PROBE_TABLE}`).catch(() => undefined);
    await dropImmutability(dbAdmin, { tableName: CUSTOM_TABLE }).catch(() => undefined);
    await dbAdmin.raw(`DROP TABLE IF EXISTS ${CUSTOM_TABLE}`).catch(() => undefined);
  });

  it('T1 — INSERT succeeds after applyImmutability', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await expect(
      dbAdmin.raw(`INSERT INTO ${PROBE_TABLE} (v) VALUES ('T1-initial')`),
    ).resolves.toBeDefined();
  });

  it('T2 — UPDATE raises with the default message', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    let caught: Error | null = null;
    try {
      await dbAdmin.raw(`UPDATE ${PROBE_TABLE} SET v = 'T2-tampered'`);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect((caught as Error).message).toMatch(
      new RegExp(`${PROBE_TABLE} is append-only`),
    );
  });

  it('T3 — DELETE raises with the default message', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    let caught: Error | null = null;
    try {
      await dbAdmin.raw(`DELETE FROM ${PROBE_TABLE}`);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect((caught as Error).message).toMatch(
      new RegExp(`${PROBE_TABLE} is append-only`),
    );
  });

  it('T4 — app_user grants: UPDATE/DELETE/TRUNCATE revoked, SELECT/INSERT preserved', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const appUser = process.env.DB_APP_USER ?? 'app_user';

    const checkPriv = async (priv: string): Promise<boolean | null> => {
      const r = await dbAdmin.raw<{ rows: Array<{ has: boolean }> }>(
        `SELECT has_table_privilege(?, '${PROBE_TABLE}', ?) AS has`,
        [appUser, priv],
      );
      const v = r.rows?.[0]?.has;
      return typeof v === 'boolean' ? v : null;
    };

    const select = await checkPriv('SELECT');
    const insert = await checkPriv('INSERT');
    const update = await checkPriv('UPDATE');
    const del = await checkPriv('DELETE');
    const trunc = await checkPriv('TRUNCATE');

    // If the role is not provisioned on this dev DB, skip the asserts.
    if (select === null) return;

    expect(select).toBe(true);
    expect(insert).toBe(true);
    expect(update).toBe(false);
    expect(del).toBe(false);
    expect(trunc).toBe(false);
  });

  it('T5 — custom errorMessage propagates to RAISE output verbatim', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin.raw(`
      CREATE TABLE ${CUSTOM_TABLE} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        v text
      )
    `);
    const customMessage = 'BUG-343 T5 custom message — do not mutate';
    await applyImmutability(dbAdmin, {
      tableName: CUSTOM_TABLE,
      errorMessage: customMessage,
    });
    await dbAdmin.raw(`INSERT INTO ${CUSTOM_TABLE} (v) VALUES ('seed')`);

    let caught: Error | null = null;
    try {
      await dbAdmin.raw(`UPDATE ${CUSTOM_TABLE} SET v = 'tampered'`);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect((caught as Error).message).toContain(customMessage);
  });

  it('T6 — applyImmutability is idempotent', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Second call on the already-immutable PROBE_TABLE must not error.
    await expect(
      applyImmutability(dbAdmin, { tableName: PROBE_TABLE }),
    ).resolves.toBeUndefined();

    // Behaviour unchanged: UPDATE still raises.
    let caught: Error | null = null;
    try {
      await dbAdmin.raw(`UPDATE ${PROBE_TABLE} SET v = 'T6-retry-tamper'`);
    } catch (err) {
      caught = err as Error;
    }
    expect((caught as Error).message).toMatch(/is append-only/);
  });

  it('T7 — dropImmutability reverses: UPDATE + DELETE succeed after drop', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Use a fresh throwaway table so T7 doesn't affect T1–T6 ordering
    // invariants. Create → apply → verify immutable → drop → verify mutable.
    const T7_TABLE = 'bug343_t7_probe';
    try {
      await dbAdmin.raw(`DROP TABLE IF EXISTS ${T7_TABLE}`);
      await dbAdmin.raw(`DROP FUNCTION IF EXISTS ${T7_TABLE}_prevent_mutation()`);
      await dbAdmin.raw(`
        CREATE TABLE ${T7_TABLE} (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          v text
        )
      `);
      await applyImmutability(dbAdmin, { tableName: T7_TABLE });
      await dbAdmin.raw(`INSERT INTO ${T7_TABLE} (v) VALUES ('seed')`);

      // Pre-drop: UPDATE raises.
      await expect(
        dbAdmin.raw(`UPDATE ${T7_TABLE} SET v = 'pre-drop-tamper'`),
      ).rejects.toThrow(/is append-only/);

      // Drop the immutability.
      await dropImmutability(dbAdmin, { tableName: T7_TABLE });

      // Post-drop: UPDATE + DELETE succeed.
      await expect(
        dbAdmin.raw(`UPDATE ${T7_TABLE} SET v = 'post-drop-mutated'`),
      ).resolves.toBeDefined();
      await expect(
        dbAdmin.raw(`DELETE FROM ${T7_TABLE}`),
      ).resolves.toBeDefined();
    } finally {
      await dbAdmin.raw(`DROP TABLE IF EXISTS ${T7_TABLE}`).catch(() => undefined);
    }
  });
});
