// apps/api/migrations/20260421000002_audit_log_immutability.ts
//
// BUG-039 — audit_log tamper-evidence (two-layer defence).
//
// Layer A — REVOKE UPDATE/DELETE/TRUNCATE from app_user. The runtime
// role must be able to INSERT (via writeAuditLog) and SELECT (for the
// audit-retrieval UI) but never rewrite or delete history.
//
// Layer B — BEFORE UPDATE/DELETE triggers that raise exceptions. This
// fires for ALL roles including the migration owner (app.owner_role),
// so a compromised owner role — or any future buggy DDL tool that
// issues UPDATE/DELETE via the owner — is still blocked. Triggers do
// NOT fire on INSERT or on DDL (DROP PARTITION for retention), so
// operational paths are unaffected.
//
// Why BOTH layers:
//   - REVOKE alone: a future `GRANT ALL ON audit_log TO app_user`
//     silently re-opens the hole. Trigger is the defence-in-depth
//     guarantee that cannot be bypassed by regrant.
//   - Trigger alone: grant layer is the first-line Postgres planner
//     rejection (fast-fail); without REVOKE, every attempted UPDATE
//     walks through planner + trigger (wasted work).
//   - Together: matches the canonical pattern from legacy migrations
//     20260331_audit_log_tamper_protection.sql + 20260412000004
//     (dropped in the v2 baseline squash — this migration restores it).
//
// Idempotent: DROP IF EXISTS + CREATE OR REPLACE so a partial prior
// run doesn't wedge. down() drops triggers + function + re-grants —
// honest reversal per CLAUDE.md §12; production rollback is
// forward-fix preferred per plan §10.
//
// Standard: HIPAA 164.312(b) audit controls (integrity); APP 11.1
// security; Australian Privacy Act breach-reporting evidence chain.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Layer B — function + triggers FIRST so any in-flight UPDATE/DELETE
  // attempt during the migration window hits the exception rather than
  // silently succeeding against the un-revoked grants.

  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION audit_log_prevent_mutation()
      RETURNS TRIGGER AS $fn$
      BEGIN
        RAISE EXCEPTION 'audit_log is append-only (BUG-039 tamper-evident)';
      END;
      $fn$ LANGUAGE plpgsql
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER audit_log_no_update
      BEFORE UPDATE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation()
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER audit_log_no_delete
      BEFORE DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation()
  `);

  // Layer A — revoke grants from the runtime role. Guarded by a check
  // that the role exists (dev DBs may skip creating app_user; CLAUDE.md
  // §7.4 handles that). INSERT + SELECT are explicitly preserved.
  // @migration-raw-exempt: revoke
  await knex.raw(`
    DO $do$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_user;
      END IF;
    END
    $do$
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Honest reversal: drop triggers + function, re-grant UPDATE/DELETE/
  // TRUNCATE. CAB approval is required for any production rollback
  // (plan §10); down() is dev-only — the forward-fix path is preferred.
  // @migration-raw-exempt: grant
  await knex.raw(`
    DO $do$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT UPDATE, DELETE, TRUNCATE ON audit_log TO app_user;
      END IF;
    END
    $do$
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log');
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log');
  // @migration-raw-exempt: function_drop
  await knex.raw('DROP FUNCTION IF EXISTS audit_log_prevent_mutation()');
}
