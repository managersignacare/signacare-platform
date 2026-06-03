/**
 * apps/api/scripts/migration-rehearsal.ts
 *
 * A2 Class-M verification helper:
 * - creates an ephemeral database
 * - runs migrations latest (+ SQL overlays)
 * - rolls all migrations back
 * - runs migrations latest again (+ SQL overlays)
 * - drops the ephemeral database
 *
 * This gives deterministic local proof for migration rollback posture
 * without touching the operator's primary development database.
 */

import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { config } from '../src/config/config';
import {
  createMigrationKnex,
  createMigrationSource,
  getScriptLayout,
  runSqlMigrations,
  type MigrationDbConfig,
} from './lib/migrationRunner';

const ADMIN_DB = process.env.MIGRATION_REHEARSAL_ADMIN_DB ?? 'postgres';
const RAW_PREFIX = process.env.MIGRATION_REHEARSAL_DB_PREFIX ?? 'signacare_rehearsal';
const TEMPLATE_DB = (process.env.MIGRATION_REHEARSAL_TEMPLATE_DB ?? config.database.database).trim();
const FORCE_TEMPLATE_DISCONNECT =
  (process.env.MIGRATION_REHEARSAL_FORCE_TEMPLATE_DISCONNECT ?? 'true').toLowerCase() === 'true';
const ACCEPT_APPROVED_FORWARD_FIX_ONLY =
  (process.env.MIGRATION_REHEARSAL_ACCEPT_APPROVED_FORWARD_FIX_ONLY ?? 'true').toLowerCase() === 'true';
const FORWARD_FIX_REGISTER_PATH = path.resolve(
  __dirname,
  'migration-forward-fix-only-register.json',
);

type ForwardFixEntry = {
  migrationFile: string;
  bugId: string;
  status: 'pending_operator_approval' | 'approved';
  expectedErrorPattern: string;
  rationale: string;
  approval: {
    approvedBy: string;
    approvedAt: string;
    ticket: string;
  };
};

type ForwardFixRegister = {
  version: number;
  entries: ForwardFixEntry[];
};

function sanitizeIdentifier(raw: string): string {
  const base = raw.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const collapsed = base.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return collapsed.length > 0 ? collapsed : 'signacare_rehearsal';
}

function makeDatabaseName(): string {
  const prefix = sanitizeIdentifier(RAW_PREFIX);
  const suffix = `${Date.now()}_${process.pid}`;
  const composed = `${prefix}_${suffix}`;
  // PostgreSQL max identifier length is 63 bytes/chars.
  return composed.slice(0, 63);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function terminateSessionsOwnedByCurrentRole(
  client: Client,
  dbName: string,
): Promise<number> {
  const result = await client.query<{ terminated: boolean }>(
    `
      SELECT pg_terminate_backend(pid) AS terminated
      FROM pg_stat_activity
      WHERE datname = $1
        AND usename = current_user
        AND pid <> pg_backend_pid()
    `,
    [dbName],
  );
  return result.rows.filter((row) => row.terminated).length;
}

async function createDatabase(adminClient: Client, dbName: string, templateDb: string): Promise<void> {
  await adminClient.query(
    `CREATE DATABASE ${quoteIdent(dbName)} TEMPLATE ${quoteIdent(templateDb)}`,
  );
}

async function dropDatabase(adminClient: Client, dbName: string): Promise<void> {
  await adminClient.query(
    `
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid()
    `,
    [dbName],
  );
  await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdent(dbName)}`);
}

function loadForwardFixRegister(): ForwardFixRegister {
  const raw = fs.readFileSync(FORWARD_FIX_REGISTER_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as ForwardFixRegister;
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`Invalid forward-fix register shape: ${FORWARD_FIX_REGISTER_PATH}`);
  }
  return parsed;
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.message}\n${error.stack ?? ''}`;
  return String(error);
}

function extractFailedMigrationFile(error: unknown): string | null {
  const raw = error as Record<string, unknown>;
  const direct = raw.migration ?? raw.migrationName ?? raw.file ?? raw.filename;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }

  const text = getErrorText(error);
  const stackPathMatch = text.match(/apps\/api\/migrations\/([A-Za-z0-9_./-]+\.ts)/);
  if (stackPathMatch?.[1]) return stackPathMatch[1];

  const quoteMatch = text.match(/migration file "([^"]+)"/);
  if (quoteMatch?.[1]) return quoteMatch[1];
  return null;
}

function findForwardFixEntry(
  register: ForwardFixRegister,
  migrationFile: string,
): ForwardFixEntry | null {
  const normalized = path.basename(migrationFile);
  return register.entries.find((entry) => entry.migrationFile === normalized) ?? null;
}

function isApproved(entry: ForwardFixEntry): boolean {
  if (entry.status !== 'approved') return false;
  return (
    entry.approval.approvedBy.trim().length > 0 &&
    entry.approval.approvedAt.trim().length > 0 &&
    entry.approval.ticket.trim().length > 0
  );
}

function matchesExpectedForwardFixError(entry: ForwardFixEntry, error: unknown): boolean {
  const pattern = new RegExp(entry.expectedErrorPattern);
  return pattern.test(getErrorText(error));
}

async function runRehearsal(targetDbName: string): Promise<void> {
  const layout = getScriptLayout(__filename);
  const migrationSource = createMigrationSource(layout.migrationsDir, layout.loadExtensions);
  const rehearsalDbConfig: MigrationDbConfig = {
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: targetDbName,
  };

  const db = createMigrationKnex(rehearsalDbConfig, migrationSource);
  try {
    const [firstBatch, firstApplied] = await db.migrate.latest();
    await runSqlMigrations(rehearsalDbConfig, layout.sqlMigrationsDir);
    console.log(
      `step=up-1 batch=${firstBatch} files=${firstApplied.length > 0 ? firstApplied.join(',') : 'none'}`,
    );

    try {
      const [rollbackBatch, rollbackFiles] = await db.migrate.rollback(undefined, true);
      console.log(
        `step=down-all batch=${rollbackBatch} files=${rollbackFiles.length > 0 ? rollbackFiles.join(',') : 'none'}`,
      );
    } catch (error) {
      const failedMigration = extractFailedMigrationFile(error);
      if (!ACCEPT_APPROVED_FORWARD_FIX_ONLY || !failedMigration) throw error;

      const register = loadForwardFixRegister();
      const entry = findForwardFixEntry(register, failedMigration);
      if (!entry) throw error;
      if (!isApproved(entry)) {
        throw new Error(
          [
            `Forward-fix-only migration is not approved yet: ${entry.migrationFile} (${entry.bugId}).`,
            'Required: status=approved with non-empty approval.approvedBy/approvedAt/ticket',
            `register=${FORWARD_FIX_REGISTER_PATH}`,
          ].join(' '),
        );
      }
      if (!matchesExpectedForwardFixError(entry, error)) {
        throw new Error(
          `Forward-fix-only entry matched ${entry.migrationFile} but rollback error did not match expectedErrorPattern.`,
        );
      }

      console.log(
        [
          'step=down-all',
          'status=approved-forward-fix-only',
          `migration=${entry.migrationFile}`,
          `bug=${entry.bugId}`,
          `ticket=${entry.approval.ticket}`,
        ].join(' '),
      );
      return;
    }

    const [secondBatch, secondApplied] = await db.migrate.latest();
    await runSqlMigrations(rehearsalDbConfig, layout.sqlMigrationsDir);
    console.log(
      `step=up-2 batch=${secondBatch} files=${secondApplied.length > 0 ? secondApplied.join(',') : 'none'}`,
    );
  } finally {
    await db.destroy();
  }
}

async function main(): Promise<void> {
  const dbName = makeDatabaseName();
  const adminConfig: MigrationDbConfig = {
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: ADMIN_DB,
  };

  const adminClient = new Client(adminConfig);
  await adminClient.connect();
  try {
    console.log(
      `creating_ephemeral_db=${dbName} template=${TEMPLATE_DB} force_disconnect_template=${FORCE_TEMPLATE_DISCONNECT}`,
    );
    if (FORCE_TEMPLATE_DISCONNECT) {
      const ownerTerminated = await terminateSessionsOwnedByCurrentRole(adminClient, TEMPLATE_DB);
      console.log(`terminated_sessions role=${config.database.user} count=${ownerTerminated}`);

      const hasDistinctAppRole = config.database.appUser !== config.database.user;
      if (hasDistinctAppRole) {
        const appRoleClient = new Client({
          host: config.database.host,
          port: config.database.port,
          user: config.database.appUser,
          password: config.database.appPassword,
          database: TEMPLATE_DB,
        });
        try {
          await appRoleClient.connect();
          const appTerminated = await terminateSessionsOwnedByCurrentRole(appRoleClient, TEMPLATE_DB);
          console.log(`terminated_sessions role=${config.database.appUser} count=${appTerminated}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `template_disconnect_warning role=${config.database.appUser} message=${message}`,
          );
        } finally {
          await appRoleClient.end().catch(() => undefined);
        }
      }
    }

    await createDatabase(adminClient, dbName, TEMPLATE_DB);

    try {
      await runRehearsal(dbName);
      console.log(`rehearsal_status=PASS db=${dbName}`);
    } finally {
      await dropDatabase(adminClient, dbName);
      console.log(`ephemeral_db_dropped=${dbName}`);
    }
  } finally {
    await adminClient.end();
  }
}

main().catch((error: unknown) => {
  const message = getErrorText(error);
  if (String(message).includes('permission denied to create extension "vector"')) {
    console.error(
      [
        'hint=extension-permission',
        'Vector extension install is blocked for current role.',
        'Set MIGRATION_REHEARSAL_TEMPLATE_DB to a DB where vector is already installed',
        '(default now uses DB_NAME), or run with a role that can CREATE EXTENSION.',
      ].join(' '),
    );
  }
  console.error(`rehearsal_status=FAIL error=${message}`);
  process.exit(1);
});
