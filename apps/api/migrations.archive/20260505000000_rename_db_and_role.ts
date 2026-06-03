/**
 * Phase 0.5 — one-time rename of the Postgres role + database to the
 * canonical names prescribed by
 * docs/gold-standard-reports/08-deployment-guide.md §2 "Postgres role model".
 *
 *   ALTER ROLE     noususer   RENAME TO signacare_owner;
 *   ALTER DATABASE nousdev    RENAME TO signacaredb;
 *   CREATE ROLE    app_user   WITH LOGIN PASSWORD '<from env>';
 *   GRANT CONNECT / USAGE / SELECT+DML / sequence privileges / default
 *     privileges  →  app_user
 *
 * Background — why this migration is structurally different from every
 * other migration in this directory:
 *
 * 1. It runs against a SUPERUSER connection, not the app pool. The app
 *    pool connects AS the role we're about to rename, and ALTER DATABASE
 *    RENAME cannot run from inside the database being renamed. So this
 *    migration ignores the knex handle passed in by the migration runner
 *    and instead opens a second pg.Client from SUPERUSER_DATABASE_URL,
 *    targeted at the 'postgres' maintenance database.
 *
 * 2. It is gated by ALLOW_DB_RENAME=1. Without that flag, up() refuses
 *    to run and returns early with a no-op. This is a one-shot operator
 *    action, not something that should auto-fire on arbitrary deploys.
 *    The standard `npm run migrate:latest` on a fresh clone will skip
 *    this migration entirely until an operator explicitly opts in.
 *
 * 3. It is idempotent. Each DDL statement is wrapped in a DO $$ block
 *    that swallows the "already renamed" / "already exists" exceptions,
 *    so running it twice in a row is a clean no-op. This matters because
 *    Knex records the migration as applied after up() returns, and we
 *    want the bookkeeping to be correct whether the actual rename
 *    happened in this run or a previous run.
 *
 * 4. Zero data movement. ALTER ROLE ... RENAME TO and ALTER DATABASE ...
 *    RENAME TO are metadata-only operations in Postgres — rows, indexes,
 *    sequences, triggers, foreign keys, the knex_migrations bookkeeping
 *    table, extensions, RLS policies, all untouched. Ownership of every
 *    object owned by the renamed role follows the rename automatically.
 *
 * Rollback:
 *   ALTER DATABASE signacaredb RENAME TO nousdev;
 *   ALTER ROLE     signacare_owner RENAME TO noususer;
 *   DROP ROLE      app_user;
 * run as superuser against the 'postgres' database, then flip the
 * relevant .env files back. Same zero-data-loss guarantee as the forward
 * rename. Use docs/phase-0.5-rename-runbook.md for the exact sequence.
 *
 * Required environment variables:
 *   ALLOW_DB_RENAME          — must equal "1" for up() to execute
 *   SUPERUSER_DATABASE_URL   — a libpq URL for a superuser connection to
 *                              the 'postgres' maintenance database, e.g.
 *                              postgres://postgres@localhost:5432/postgres
 *   APP_USER_PASSWORD        — password for the new 'app_user' runtime
 *                              role being created (written into GRANT)
 *
 * This file is whitelisted in .github/scripts/check-no-stray-db-names.sh
 * because it is the only place in the repo where the literal legacy
 * names (noususer, nousdev) may appear.
 */
import type { Knex } from 'knex';
import { Client } from 'pg';

const OLD_ROLE = 'noususer';
const OLD_DB = 'nousdev';
const NEW_OWNER = 'signacare_owner';
const NEW_DB = 'signacaredb';
const RUNTIME_ROLE = 'app_user';

async function connectSuperuser(): Promise<Client> {
  const url = process.env.SUPERUSER_DATABASE_URL;
  if (!url) {
    throw new Error(
      'SUPERUSER_DATABASE_URL is not set. Phase 0.5 rename migration ' +
        'requires a superuser connection to the postgres maintenance database. ' +
        'See docs/phase-0.5-rename-runbook.md for the exact value to use.',
    );
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

export async function up(_knex: Knex): Promise<void> {
  if (process.env.ALLOW_DB_RENAME !== '1') {
    // eslint-disable-next-line no-console
    console.log(
      '[20260505000000_rename_db_and_role] ALLOW_DB_RENAME is not "1" — ' +
        'skipping the rename. This is a gated one-shot migration. Set ' +
        'ALLOW_DB_RENAME=1 and SUPERUSER_DATABASE_URL=<postgres superuser url> ' +
        'to execute. See docs/phase-0.5-rename-runbook.md.',
    );
    return;
  }

  const appPw = process.env.APP_USER_PASSWORD;
  if (!appPw || appPw.trim().length < 12) {
    throw new Error(
      'APP_USER_PASSWORD must be set to a non-empty password of at least ' +
        '12 characters before running the rename migration. This is the ' +
        'password the new runtime role will use.',
    );
  }

  const client = await connectSuperuser();
  try {
    // ─── 1. Rename the owner role (idempotent). ────────────────────────────
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${OLD_ROLE}') THEN
          EXECUTE 'ALTER ROLE ${OLD_ROLE} RENAME TO ${NEW_OWNER}';
        ELSIF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${NEW_OWNER}') THEN
          RAISE NOTICE 'Neither ${OLD_ROLE} nor ${NEW_OWNER} exists — nothing to rename';
        END IF;
      END
      $$;
    `);

    // ─── 2. Rename the database (idempotent). ──────────────────────────────
    // ALTER DATABASE ... RENAME TO cannot run inside a DO block because
    // it's not allowed in a transaction. So we probe pg_database and
    // only issue the ALTER when the old name still exists.
    const dbRow = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname = $1 OR datname = $2`,
      [OLD_DB, NEW_DB],
    );
    const existingDbs = new Set(dbRow.rows.map((r) => r.datname));
    if (existingDbs.has(OLD_DB)) {
      await client.query(`ALTER DATABASE ${OLD_DB} RENAME TO ${NEW_DB}`);
    } else if (!existingDbs.has(NEW_DB)) {
      throw new Error(
        `Neither database "${OLD_DB}" nor "${NEW_DB}" exists. Refusing to ` +
          `proceed — the target environment is not what this migration expects.`,
      );
    }

    // ─── 3. Create the app_user runtime role (idempotent). ─────────────────
    // Escape any single quotes in the password to survive the SQL string.
    const escapedPw = appPw.replace(/'/g, "''");
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RUNTIME_ROLE}') THEN
          EXECUTE format('CREATE ROLE ${RUNTIME_ROLE} WITH LOGIN PASSWORD %L', '${escapedPw}');
        ELSE
          EXECUTE format('ALTER ROLE ${RUNTIME_ROLE} WITH LOGIN PASSWORD %L', '${escapedPw}');
        END IF;
      END
      $$;
    `);

    // ─── 4. Grant runtime privileges to app_user on the renamed database. ──
    // We must switch connection to the renamed database to run GRANT USAGE
    // on its schema and GRANT on its tables — those are per-database
    // catalog operations. Close the superuser-to-postgres client and open
    // a new superuser-to-NEW_DB client using the same superuser URL but
    // with the database component overridden.
    await client.end();

    const superUrl = new URL(process.env.SUPERUSER_DATABASE_URL ?? '');
    superUrl.pathname = `/${NEW_DB}`;
    const dbClient = new Client({ connectionString: superUrl.toString() });
    await dbClient.connect();
    try {
      await dbClient.query(`GRANT CONNECT ON DATABASE ${NEW_DB} TO ${RUNTIME_ROLE}`);
      await dbClient.query(`GRANT USAGE ON SCHEMA public TO ${RUNTIME_ROLE}`);
      await dbClient.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RUNTIME_ROLE}`,
      );
      await dbClient.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${RUNTIME_ROLE}`);
      await dbClient.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${NEW_OWNER} IN SCHEMA public
           GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${RUNTIME_ROLE}`,
      );
      await dbClient.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${NEW_OWNER} IN SCHEMA public
           GRANT USAGE, SELECT ON SEQUENCES TO ${RUNTIME_ROLE}`,
      );
    } finally {
      await dbClient.end();
    }
  } catch (err) {
    if ((client as { _connected?: boolean })._connected !== false) {
      // Best-effort cleanup; if we already closed it above, .end() on a
      // closed client throws and we don't care.
      try {
        await client.end();
      } catch {
        /* already closed */
      }
    }
    throw err;
  }
}

export async function down(_knex: Knex): Promise<void> {
  if (process.env.ALLOW_DB_RENAME !== '1') {
    // eslint-disable-next-line no-console
    console.log(
      '[20260505000000_rename_db_and_role] ALLOW_DB_RENAME is not "1" — ' +
        'skipping the rollback. See docs/phase-0.5-rename-runbook.md for the ' +
        'manual rollback sequence.',
    );
    return;
  }

  const client = await connectSuperuser();
  try {
    // Drop app_user first (revoking privileges implicitly) so the
    // database rename below doesn't trip on an owned grant.
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RUNTIME_ROLE}') THEN
          EXECUTE 'REASSIGN OWNED BY ${RUNTIME_ROLE} TO ${NEW_OWNER}';
          EXECUTE 'DROP OWNED BY ${RUNTIME_ROLE}';
          EXECUTE 'DROP ROLE ${RUNTIME_ROLE}';
        END IF;
      END
      $$;
    `);

    const dbRow = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname = $1 OR datname = $2`,
      [OLD_DB, NEW_DB],
    );
    const existingDbs = new Set(dbRow.rows.map((r) => r.datname));
    if (existingDbs.has(NEW_DB)) {
      await client.query(`ALTER DATABASE ${NEW_DB} RENAME TO ${OLD_DB}`);
    }

    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${NEW_OWNER}') THEN
          EXECUTE 'ALTER ROLE ${NEW_OWNER} RENAME TO ${OLD_ROLE}';
        END IF;
      END
      $$;
    `);
  } finally {
    try {
      await client.end();
    } catch {
      /* already closed */
    }
  }
}
