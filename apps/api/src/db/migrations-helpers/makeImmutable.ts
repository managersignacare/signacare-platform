// apps/api/src/db/migrations-helpers/makeImmutable.ts
//
// BUG-343 — shared helper for applying the append-only / tamper-evident
// migration pattern to a new table. Earned at rule-of-three: the two
// existing immutable-class tables (audit_log via BUG-039 and
// llm_interactions via BUG-286) ship with inline SQL; BUG-282's
// llm_prompts_outputs is the third, triggering this consolidation.
//
// Contract mirrors BUG-286's migration exactly (see
// apps/api/migrations/20260701000031_llm_interactions_immutability.ts):
//
//   Layer A — REVOKE UPDATE/DELETE/TRUNCATE from the runtime app_user
//   role. Guarded by role-existence check (dev DBs may skip creating
//   app_user per CLAUDE.md §7.4).
//
//   Layer B — CREATE OR REPLACE FUNCTION <tableName>_<fnNameSuffix>()
//   that unconditionally RAISEs + BEFORE UPDATE + BEFORE DELETE
//   triggers on the table. Fires for ALL roles including the
//   migration owner — a compromised owner role or future DDL tool
//   issuing UPDATE/DELETE via the owner is still blocked.
//
// Why per-table function name (not a shared one): ops debugging a
// RAISE must see the correct table in the error to reduce MTTI.
// Rule inherited verbatim from BUG-286's design decision.
//
// Call order inside up(): Layer B first so any in-flight UPDATE/DELETE
// during the migration window hits the exception rather than silently
// succeeding against the un-revoked grants.
//
// Identifier safety: tableName / appUserRole / fnNameSuffix are
// interpolated directly into SQL (Postgres doesn't parameterise
// identifiers). All three are validated against a strict regex that
// matches Postgres unquoted identifier rules. A caller passing user
// input by mistake fails fast rather than executing injected DDL.
//
// Deliberately NOT refactoring the two existing immutable migrations
// (audit_log + llm_interactions) to call this helper — they already
// ran in prod; rewriting inline SQL to call the helper is cosmetic
// and carries non-zero risk of SQL-shape drift.

import type { Knex } from 'knex';

export interface MakeImmutableOptions {
  /** Target table (e.g. 'llm_prompts_outputs'). */
  tableName: string;
  /** App-user role whose UPDATE/DELETE/TRUNCATE grants get revoked. Default 'app_user'. */
  appUserRole?: string;
  /** Error message raised by trigger. Default: `<tableName> is append-only`. */
  errorMessage?: string;
  /** Function-name suffix; full name is `<tableName>_<fnNameSuffix>`. Default 'prevent_mutation'. */
  fnNameSuffix?: string;
}

/**
 * Unquoted Postgres identifier regex. Must start with a letter or
 * underscore, followed by letters, digits, or underscores. Matches
 * Postgres's SQL standard definition closely enough for our callers
 * (all of which pass compile-time-constant strings).
 *
 * Exported so tests can exercise it directly.
 */
export const SAFE_PG_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertSafeIdentifier(value: string, argName: string): void {
  if (!SAFE_PG_IDENTIFIER.test(value)) {
    throw new Error(
      `[makeImmutable] ${argName} '${value}' is not a safe Postgres identifier. ` +
        `Must match ${SAFE_PG_IDENTIFIER}. Refusing to interpolate into SQL.`,
    );
  }
}

/**
 * Escape a single-quoted string literal for Postgres. Doubles any
 * embedded single quotes. Used for errorMessage (which is a string
 * literal in the RAISE statement, NOT an identifier).
 */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Apply append-only / tamper-evident semantics to an existing table.
 *
 * Emits, in order:
 *   1. CREATE OR REPLACE FUNCTION <tableName>_<fnNameSuffix>()
 *      RETURNS TRIGGER that RAISEs with errorMessage.
 *   2. DROP TRIGGER IF EXISTS + CREATE TRIGGER <tableName>_no_update
 *      BEFORE UPDATE.
 *   3. DROP TRIGGER IF EXISTS + CREATE TRIGGER <tableName>_no_delete
 *      BEFORE DELETE.
 *   4. Guarded REVOKE UPDATE, DELETE, TRUNCATE on <tableName> from
 *      <appUserRole>.
 *
 * Idempotent — safe to re-run against a partially- or fully-immutable
 * table.
 */
export async function applyImmutability(
  knex: Knex,
  opts: MakeImmutableOptions,
): Promise<void> {
  const tableName = opts.tableName;
  const appUserRole = opts.appUserRole ?? 'app_user';
  const fnNameSuffix = opts.fnNameSuffix ?? 'prevent_mutation';
  const errorMessage = opts.errorMessage ?? `${tableName} is append-only`;

  assertSafeIdentifier(tableName, 'tableName');
  assertSafeIdentifier(appUserRole, 'appUserRole');
  assertSafeIdentifier(fnNameSuffix, 'fnNameSuffix');
  const fnName = `${tableName}_${fnNameSuffix}`;
  const updateTrigger = `${tableName}_no_update`;
  const deleteTrigger = `${tableName}_no_delete`;
  const safeMessage = escapeSqlString(errorMessage);

  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${fnName}()
      RETURNS TRIGGER AS $fn$
      BEGIN
        RAISE EXCEPTION '${safeMessage}';
      END;
      $fn$ LANGUAGE plpgsql
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw(`DROP TRIGGER IF EXISTS ${updateTrigger} ON ${tableName}`);
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER ${updateTrigger}
      BEFORE UPDATE ON ${tableName}
      FOR EACH ROW EXECUTE FUNCTION ${fnName}()
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw(`DROP TRIGGER IF EXISTS ${deleteTrigger} ON ${tableName}`);
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER ${deleteTrigger}
      BEFORE DELETE ON ${tableName}
      FOR EACH ROW EXECUTE FUNCTION ${fnName}()
  `);

  // @migration-raw-exempt: revoke
  await knex.raw(`
    DO $do$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appUserRole}') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON ${tableName} FROM ${appUserRole};
      END IF;
    END
    $do$
  `);
}

/**
 * Reverse applyImmutability — drop triggers + function + re-GRANT.
 * Used from migration down() handlers. Honest reversal per CLAUDE.md
 * §12 (production rollback requires CAB; forward-fix preferred).
 */
export async function dropImmutability(
  knex: Knex,
  opts: MakeImmutableOptions,
): Promise<void> {
  const tableName = opts.tableName;
  const appUserRole = opts.appUserRole ?? 'app_user';
  const fnNameSuffix = opts.fnNameSuffix ?? 'prevent_mutation';

  assertSafeIdentifier(tableName, 'tableName');
  assertSafeIdentifier(appUserRole, 'appUserRole');
  assertSafeIdentifier(fnNameSuffix, 'fnNameSuffix');
  const fnName = `${tableName}_${fnNameSuffix}`;
  const updateTrigger = `${tableName}_no_update`;
  const deleteTrigger = `${tableName}_no_delete`;

  // @migration-raw-exempt: grant
  await knex.raw(`
    DO $do$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appUserRole}') THEN
        GRANT UPDATE, DELETE, TRUNCATE ON ${tableName} TO ${appUserRole};
      END IF;
    END
    $do$
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw(`DROP TRIGGER IF EXISTS ${deleteTrigger} ON ${tableName}`);
  // @migration-raw-exempt: trigger_drop
  await knex.raw(`DROP TRIGGER IF EXISTS ${updateTrigger} ON ${tableName}`);
  // @migration-raw-exempt: function_drop
  await knex.raw(`DROP FUNCTION IF EXISTS ${fnName}()`);
}
