// apps/api/migrations/20260701000031_llm_interactions_immutability.ts
//
// BUG-286 — llm_interactions tamper-evidence (two-layer defence).
// Mirrors BUG-039 (audit_log) shape.
//
// llm_interactions is audit-class: BUG-037's recordLlmInteraction is the
// single writer and only INSERTs. But DB grants still allow app_user to
// UPDATE/DELETE rows — a compromised application process or a future
// regression introducing an UPDATE call could rewrite or delete AI-
// interaction history. BUG-286 closes the gap with the canonical two-
// layer pattern:
//
// Layer A — REVOKE UPDATE/DELETE/TRUNCATE from app_user. Runtime role
// retains INSERT (writeLlmInteraction) and SELECT (forensic retrieval,
// training-export audit, BUG-280 contamination scan).
//
// Layer B — BEFORE UPDATE/DELETE triggers that RAISE EXCEPTION. Fires
// for ALL roles including the migration owner — a compromised owner
// role, or a future DDL tool issuing UPDATE/DELETE via the owner, is
// still blocked. Triggers do NOT fire on INSERT or DDL, so operational
// paths (retention sweeps via partition drop, if ever added) are
// unaffected.
//
// Separate function name `llm_interactions_prevent_mutation` (NOT
// reusing audit_log_prevent_mutation) per catalogue-level design
// decision: ops debugging an llm_interactions RAISE should see the
// table name in the error, not `audit_log` — reduces MTTI for the
// on-call.
//
// Why BOTH layers: the same reasoning as BUG-039. REVOKE alone can be
// silently undone by a future `GRANT ALL`; trigger alone wastes planner
// cycles on every UPDATE attempt. Together they form defence-in-depth.
//
// Idempotent: CREATE OR REPLACE + DROP IF EXISTS + guarded REVOKE.
//
// Standard: HIPAA 164.312(b) audit controls (integrity); APP 11.1
// security; AI Ethics — immutable AI interaction history supports
// post-hoc accountability and training-data provenance.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Layer B first — any in-flight UPDATE/DELETE during the migration
  // window hits the exception rather than silently succeeding.

  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION llm_interactions_prevent_mutation()
      RETURNS TRIGGER AS $fn$
      BEGIN
        RAISE EXCEPTION 'llm_interactions is append-only (BUG-286 tamper-evident)';
      END;
      $fn$ LANGUAGE plpgsql
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS llm_interactions_no_update ON llm_interactions');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER llm_interactions_no_update
      BEFORE UPDATE ON llm_interactions
      FOR EACH ROW EXECUTE FUNCTION llm_interactions_prevent_mutation()
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS llm_interactions_no_delete ON llm_interactions');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER llm_interactions_no_delete
      BEFORE DELETE ON llm_interactions
      FOR EACH ROW EXECUTE FUNCTION llm_interactions_prevent_mutation()
  `);

  // Layer A — revoke UPDATE/DELETE/TRUNCATE from app_user. Guard by role
  // existence check (dev DBs may skip creating app_user per §7.4).
  // @migration-raw-exempt: revoke
  await knex.raw(`
    DO $do$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON llm_interactions FROM app_user;
      END IF;
    END
    $do$
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Honest reversal. CAB approval required for any production rollback.
  // @migration-raw-exempt: grant
  await knex.raw(`
    DO $do$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT UPDATE, DELETE, TRUNCATE ON llm_interactions TO app_user;
      END IF;
    END
    $do$
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS llm_interactions_no_delete ON llm_interactions');
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS llm_interactions_no_update ON llm_interactions');
  // @migration-raw-exempt: function_drop
  await knex.raw('DROP FUNCTION IF EXISTS llm_interactions_prevent_mutation()');
}
