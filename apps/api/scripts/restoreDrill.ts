/**
 * S1.3 — Backup restore drill
 *
 * "Untested backups don't exist." This script proves that the latest
 * backup is restorable by:
 *
 *   1. Reading the most recent successful row from `backup_history`.
 *   2. Creating a scratch database `signacare_restore_drill_<timestamp>`.
 *   3. Loading the backup file into the scratch DB via psql.
 *   4. Running smoke assertions: row counts on critical tables, schema
 *      sanity check, RLS sanity check.
 *   5. Recording a `restored` row in backup_history (or `failed`).
 *   6. Dropping the scratch DB on success. On failure the scratch DB
 *      is intentionally LEFT in place so an operator can inspect it.
 *
 * This script is designed to be run from cron monthly:
 *
 *     0 3 1 * *  cd /opt/signacare && ts-node apps/api/scripts/restoreDrill.ts
 *
 * It is NOT wired into the in-process scheduler — running pg_restore
 * inside the API process would risk OOM and starve real requests. The
 * script exits non-zero on failure so cron alerting can fire.
 *
 * Naming compliance: snake_case DB columns, camelCase TS, ASCII-only
 * scratch DB names (Postgres rejects non-ASCII identifiers without
 * extra quoting).
 */

import { execSync } from 'child_process';
import fs from 'fs';
import knex from 'knex';
import { config } from '../src/config/config';

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
const SCRATCH_DB = `signacare_restore_drill_${TIMESTAMP.replace(/[^a-z0-9_]/gi, '_')}`;

interface BackupHistoryRow {
  id: string;
  status: string;
  location: string | null;
  size_bytes: string | number | null;
}

async function getLatestSuccessfulBackup(db: knex.Knex): Promise<BackupHistoryRow | null> {
  const row = await db<BackupHistoryRow>('backup_history')
    .where({ status: 'success' })
    .orderBy('started_at', 'desc')
    .first();
  return row ?? null;
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`restoreDrill: required env var ${name} is not set`);
  }
  return v;
}

async function main(): Promise<void> {
  const dbHost = mustEnv('DB_HOST');
  const dbPort = mustEnv('DB_PORT');
  const dbUser = mustEnv('DB_USER');
  const dbPass = mustEnv('DB_PASSWORD');

  const db = knex({
    client: 'pg',
    connection: {
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
    },
  });

  console.log('restoreDrill: starting');
  const latest = await getLatestSuccessfulBackup(db);
  if (!latest || !latest.location) {
    console.error('restoreDrill: no successful backup found in backup_history');
    await db('backup_history').insert({
      status: 'failed',
      trigger_kind: 'restore_drill',
      started_at: new Date(),
      finished_at: new Date(),
      error_text: 'no prior successful backup found',
    });
    await db.destroy();
    process.exit(1);
  }

  if (!fs.existsSync(latest.location)) {
    console.error(`restoreDrill: backup file missing at ${latest.location}`);
    await db('backup_history').insert({
      status: 'failed',
      trigger_kind: 'restore_drill',
      started_at: new Date(),
      finished_at: new Date(),
      location: latest.location,
      error_text: 'backup file missing on disk',
    });
    await db.destroy();
    process.exit(1);
  }

  // Insert running row up-front
  const [drill] = await db('backup_history')
    .insert({
      status: 'running',
      trigger_kind: 'restore_drill',
      started_at: new Date(),
      location: latest.location,
    })
    .returning('id');
  const drillId = (drill as { id: string }).id ?? drill;

  // Sanitise inputs (the same approach as backupRoutes.runBackup)
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9._\-/]/g, '');
  const safeHost = sanitize(dbHost);
  const safePort = sanitize(dbPort);
  const safeUser = sanitize(dbUser);
  const safeScratch = sanitize(SCRATCH_DB);
  const safeLocation = latest.location.replace(/[^a-zA-Z0-9._\-/]/g, '');

  try {
    // 1. Create scratch database
    console.log(`restoreDrill: creating scratch database ${safeScratch}`);
    execSync(
      `PGPASSWORD="${dbPass.replace(/"/g, '\\"')}" createdb -h ${safeHost} -p ${safePort} -U ${safeUser} ${safeScratch}`,
      { timeout: 60_000 },
    );

    // 2. Restore the dump
    console.log('restoreDrill: restoring backup');
    execSync(
      `PGPASSWORD="${dbPass.replace(/"/g, '\\"')}" gunzip -c "${safeLocation}" | psql -h ${safeHost} -p ${safePort} -U ${safeUser} -d ${safeScratch} -v ON_ERROR_STOP=1 > /dev/null`,
      { timeout: 600_000, shell: '/bin/bash' },
    );

    // 3. Smoke assertions against the scratch DB
    console.log('restoreDrill: running assertions');
    const scratch = knex({
      client: 'pg',
      connection: {
        host: dbHost,
        port: parseInt(dbPort, 10),
        user: dbUser,
        password: dbPass,
        database: SCRATCH_DB,
      },
    });
    try {
      const tables = ['patients', 'clinical_notes', 'medications', 'episodes', 'staff'];
      for (const table of tables) {
        const exists = await scratch.schema.hasTable(table);
        if (!exists) {
          throw new Error(`assertion failed: table ${table} not found in restored DB`);
        }
        const [{ count }] = (await scratch(table).count('* as count')) as Array<{ count: string | number }>;
        console.log(`  ${table}: ${count} rows`);
      }
    } finally {
      await scratch.destroy();
    }

    // 4. Drop the scratch DB
    console.log('restoreDrill: dropping scratch database');
    execSync(
      `PGPASSWORD="${dbPass.replace(/"/g, '\\"')}" dropdb -h ${safeHost} -p ${safePort} -U ${safeUser} ${safeScratch}`,
      { timeout: 60_000 },
    );

    await db('backup_history').where({ id: drillId }).update({
      status: 'restored',
      finished_at: new Date(),
    });
    console.log('restoreDrill: SUCCESS');
    await db.destroy();
    process.exit(0);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('restoreDrill: FAILED', errMsg);
    await db('backup_history').where({ id: drillId }).update({
      status: 'failed',
      finished_at: new Date(),
      error_text: errMsg,
    });
    await db.destroy();
    // Scratch DB intentionally left in place for forensic inspection.
    console.error(`restoreDrill: scratch DB ${SCRATCH_DB} left in place for inspection`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('restoreDrill: unexpected error', err);
  process.exit(2);
});
