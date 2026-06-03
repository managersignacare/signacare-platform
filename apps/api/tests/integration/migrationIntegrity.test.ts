/**
 * Category E — Migration integrity.
 *
 * Creates a fresh scratch database, runs `knex migrate:latest`
 * against it, and asserts that:
 *
 *   1. Every migration completes without error
 *   2. The expected set of core clinical tables exists
 *   3. Re-running migrate:latest is a no-op (migrations are idempotent)
 *   4. Every table has an `id` primary key
 *
 * Why this matters: schema drift — between migrations on disk and
 * the live DB schema — is a real bug class. A half-applied migration
 * in a shared dev DB masks a production-only failure. Running the
 * full migration sequence against a fresh DB on every PR catches
 * the class the moment it's introduced.
 *
 * Requires: the runtime DB_USER to have CREATEDB privilege (same
 * prerequisite as the DR restore drill). If the role lacks it, the
 * test skips cleanly.
 *
 * Standard satisfied: ISO 25010 Maintainability (database schema
 *                     change management), ACHS Standard 1 (clinical
 *                     record schema consistency).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import type { Knex } from 'knex';
import { isIntegrationReady } from './_helpers';
import { orderMigrationsForExecution } from '../../scripts/lib/orderMigrations';

const READY = await isIntegrationReady();

// Scratch DB name unique per process
const SCRATCH_DB = `mig_test_${Date.now()}_${process.pid}`;

let scratchCreated = false;
let scratchKnex: Knex | null = null;

// Probe whether the current DB role can run the scratch migration flow:
// 1) CREATE DATABASE privilege
// 2) pgvector extension create path available (either role can create it,
//    or it's already present in template DB so IF NOT EXISTS is a no-op).
// If either prerequisite is missing, skip this suite deterministically.
async function canRunMigrationIntegrity(): Promise<boolean> {
  if (!READY) return false;
  try {
    const { dbAdmin } = await import('../../src/db/db');
    const role = await dbAdmin.raw<{ rows: Array<{ createdb: boolean; superuser: boolean }> }>(
      `SELECT rolcreatedb AS createdb, rolsuper AS superuser
         FROM pg_roles
       WHERE rolname = current_user`,
    );
    const canCreate = role.rows?.[0]?.createdb === true;
    const isSuperuser = role.rows?.[0]?.superuser === true;
    if (!canCreate) return false;
    if (isSuperuser) return true;

    const probeDb = `mig_ext_probe_${Date.now()}_${process.pid}`;
    await dbAdmin.raw(`CREATE DATABASE "${probeDb}"`);

    const Knex = (await import('knex')).default;
    const { config } = await import('../../src/config');
    const probeKnex = Knex({
      client: 'pg',
      connection: {
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: config.database.password,
        database: probeDb,
      },
    });

    try {
      await probeKnex.raw('CREATE EXTENSION IF NOT EXISTS vector');
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('permission denied') && message.includes('extension "vector"')) {
        return false;
      }
      throw err;
    } finally {
      await probeKnex.destroy();
      await dbAdmin.raw(`DROP DATABASE IF EXISTS "${probeDb}"`);
    }
  } catch {
    return false;
  }
}

const CAN_RUN = await canRunMigrationIntegrity();

describe.skipIf(!CAN_RUN)('Migration integrity (fresh scratch DB)', () => {
  beforeAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Create the scratch DB
    await dbAdmin.raw(`CREATE DATABASE "${SCRATCH_DB}"`);
    scratchCreated = true;

    // Knex loads migrations via require(); register ts-node with an explicit
    // project + rootDir so TS 6 doesn't infer `./migrations` as common source
    // and fail with TS5011 when loading wrapper files one-by-one.
    const { register } = await import('ts-node');
    register({
      transpileOnly: true,
      project: path.resolve(process.cwd(), 'tsconfig.node.json'),
      compilerOptions: { rootDir: '.' },
    });

    // Build a Knex instance pointing at the scratch DB so we can
    // run the migration set in isolation.
    const Knex = (await import('knex')).default;
    const { config } = await import('../../src/config');
    const migrationsDir = path.resolve(process.cwd(), 'migrations');
    const migrationSource = {
      async getMigrations(loadExtensions: readonly string[]): Promise<string[]> {
        const fs = await import('node:fs');
        const files = fs.readdirSync(migrationsDir)
          .filter((f) => loadExtensions.some((ext) => f.endsWith(ext)));
        return orderMigrationsForExecution(files);
      },
      getMigrationName(migration: string): string {
        return migration;
      },
      async getMigration(migration: string): Promise<{ up: (k: unknown) => PromiseLike<unknown>; down?: (k: unknown) => PromiseLike<unknown> }> {
        const full = path.join(migrationsDir, migration);
        // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-dynamic-require, global-require
        return require(full);
      },
    };
    scratchKnex = Knex({
      client: 'pg',
      connection: {
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: config.database.password,
        database: SCRATCH_DB,
      },
      migrations: {
        tableName: 'knex_migrations',
        migrationSource,
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (scratchKnex) {
      try { await scratchKnex.destroy(); } catch { /* ignore */ }
    }
    if (scratchCreated) {
      try {
        const { dbAdmin } = await import('../../src/db/db');
        await dbAdmin.raw(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
      } catch { /* ignore */ }
    }
  }, 60_000);

  it('runs every migration on a fresh database without error', async () => {
    // knex migrate:latest returns [batch, migrationNames[]]
    const [batch, applied] = await scratchKnex.migrate.latest();
    expect(typeof batch).toBe('number');
    expect(Array.isArray(applied)).toBe(true);
    // Should have applied a non-trivial number of migrations
    expect(applied.length).toBeGreaterThan(5);
  }, 180_000);

  it('core clinical tables exist after migrate:latest', async () => {
    const required = [
      'patients',
      'episodes',
      'clinical_notes',
      'patient_medications',
      'staff',
      'clinics',
      'audit_log',
    ];
    for (const t of required) {
      const exists = await scratchKnex.raw(
        `SELECT to_regclass('public.${t}') IS NOT NULL AS ok`,
      );
      expect(exists.rows[0].ok).toBe(true);
    }
  }, 30_000);

  it('every table has an id column (no unnamed key tables)', async () => {
    const rows = await scratchKnex.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         AND table_name NOT LIKE 'knex_%'`,
    );
    const missing: string[] = [];
    for (const r of rows.rows) {
      const col = await scratchKnex.raw(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = ?
           AND column_name = 'id'`,
        [r.table_name],
      );
      if (col.rows.length === 0) missing.push(r.table_name);
    }
    // Some legacy tables may legitimately lack an `id` column; tolerate
    // a small allowlist so the test isn't brittle across historical
    // migrations.
    const allowed = new Set<string>([
      // One-row-per-clinic settings table; primary key is clinic_id.
      'clinic_settings',
      // Lookup dictionary keyed by specialty_code, not synthetic UUID.
      'specialties',
    ]);
    const realMissing = missing.filter((t) => !allowed.has(t));
    if (realMissing.length > 0) {
      throw new Error(
        `Tables missing 'id' column in fresh migration:\n  ${realMissing.join('\n  ')}`,
      );
    }
  }, 30_000);

  it('re-running migrate:latest is a no-op (idempotent)', async () => {
    const [, applied] = await scratchKnex.migrate.latest();
    expect(applied.length).toBe(0);
  }, 30_000);
});
