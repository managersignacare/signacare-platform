/**
 * BUG-187 + BUG-264 + BUG-366b — DB pool connection-level timeouts
 *
 * Every new app_user connection created by the `appPool` (and the
 * `rawDbRead` replica pool) MUST have these PG session parameters
 * set at `afterCreate` time:
 *
 *   statement_timeout                      =    30 s   (BUG-187)
 *   idle_in_transaction_session_timeout    =    60 s   (BUG-187)
 *   lock_timeout                           =     5 s   (BUG-187 follow-up, this commit)
 *
 * These are the "three timeouts" that bound pool-exhaustion damage
 * from stuck queries / orphaned transactions / deadlock prone
 * transactions. Without them the pool can drain and cascade into a
 * whole-tenant auth outage (the BUG-187 symptom).
 *
 * This suite queries the live `SHOW` response of a fresh connection
 * drawn from the app_user pool — verifies we see the guardrails that
 * `appUserAfterCreate` is supposed to install.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { db, dbAdmin } from '../../src/db/db';
import { isIntegrationReady } from './_helpers';

async function ready(): Promise<boolean> {
  return isIntegrationReady();
}

describe.skipIf(!(await ready()))('BUG-187/264/366b — DB app_user pool timeouts', () => {
  afterAll(async () => {
    // Let other suites reuse the pool; don't close it here.
  });

  it('statement_timeout is 30s on every new app_user connection', async () => {
    const result = await db.raw("SHOW statement_timeout");
    const value = result.rows[0].statement_timeout;
    // PostgreSQL reports durations as `30s`, `30000ms`, etc. Normalise.
    const normalized = value.toLowerCase().replace(/\s+/g, '');
    expect(normalized).toMatch(/^30s$|^30000ms$/);
  });

  it('idle_in_transaction_session_timeout is 60s on every new app_user connection', async () => {
    const result = await db.raw("SHOW idle_in_transaction_session_timeout");
    const value = result.rows[0].idle_in_transaction_session_timeout;
    const normalized = value.toLowerCase().replace(/\s+/g, '');
    expect(normalized).toMatch(/^1min$|^60s$|^60000ms$/);
  });

  it('lock_timeout is 5s on every new app_user connection', async () => {
    const result = await db.raw("SHOW lock_timeout");
    const value = result.rows[0].lock_timeout;
    const normalized = value.toLowerCase().replace(/\s+/g, '');
    // Fails against pre-fix code (Postgres default is `0` = disabled).
    expect(normalized).toMatch(/^5s$|^5000ms$/);
  });

  it('dbAdmin (owner role) pool does NOT have app_user timeouts', async () => {
    // owner-role connections are used for migrations + startup checks
    // and MUST be able to run long DDL without getting cancelled at
    // 30s. Verify the owner pool has the Postgres default (0 = off).
    const result = await dbAdmin.raw("SHOW statement_timeout");
    const value = result.rows[0].statement_timeout;
    const normalized = value.toLowerCase().replace(/\s+/g, '');
    expect(normalized).toMatch(/^0$|^0ms$/);
  });
});
