// apps/api/migrations/20260701000036_llm_prompts_outputs.ts
//
// BUG-282 (A-4 re-attempt) — encrypted PHI-isolation table for LLM prompt
// and output text, with tamper-evident triggers, revocation soft-mark,
// machine-checkable encryption_status, and RLS.
//
// A-3 first-attempt history: L3 REJECT + L4 BLOCK (L5 PASS). Blocking
// items absorbed into this spec: plaintext-in-*_encrypted impossible
// (NULLABLE ciphertext + encryption_status tri-state); production
// boot-assertion on PHI_ENCRYPTION_KEY (landed in the same PR);
// AMBIENT_NOTE_RECORDING_REVOKED soft-mark hook wired via helper
// function; transaction-rollback regression test covers atomic write.
//
// Part (1) — Ollama /api/show digest integration — was already shipped
// in A-3 via mcp/ollamaModelRegistry + shared/recordLlmInteraction.
// This migration is Part (2) only: the encrypted prompts/outputs table.
//
// Trigger-carve-out pattern: the base immutability trigger from
// BUG-343's makeImmutable helper unconditionally raises. This
// migration REPLACES the function body (the triggers stay) with a
// variant that PERMITS exactly one UPDATE shape: the revocation
// soft-mark (encryption_status → 'REVOKED' + both ciphertext
// columns → NULL). Every other UPDATE + every DELETE still raises.
// This is the canonical "append-only with a single documented
// exit" pattern; simpler than SECURITY DEFINER + session permits.
//
// SECURITY DEFINER soft-mark function: llm_prompts_outputs_mark_revoked
// runs with owner privileges so the revoke endpoint (which runs as
// app_user with UPDATE revoked) can invoke it. The carve-out trigger
// permits the specific UPDATE shape this function emits.
//
// Standard: HIPAA 164.312(b) integrity; APP 11.1 security; APP 12
// consent-withdrawal (revocation effective in-flight); AI Ethics —
// immutable AI prompt+output record supports post-hoc accountability
// and training-data provenance + consent-gated export.

import type { Knex } from 'knex';
import {
  applyImmutability,
  dropImmutability,
} from '../src/db/migrations-helpers/makeImmutable';

const TABLE = 'llm_prompts_outputs';

export async function up(knex: Knex): Promise<void> {
  // ── Schema ──────────────────────────────────────────────────────────────
  await knex.schema.createTable(TABLE, (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('llm_interaction_id')
      .notNullable()
      .references('id')
      .inTable('llm_interactions')
      .onDelete('CASCADE');
    // Ciphertext columns NULLABLE so the FAILED and REVOKED paths can
    // write NULL instead of plaintext (L4 absorb from A-3 attempt).
    t.text('prompt_encrypted').nullable();
    t.text('output_encrypted').nullable();
    t.string('encryption_status', 16).notNullable().defaultTo('ENCRYPTED');
    t.uuid('consent_id').nullable().references('id').inTable('scribe_consents').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['llm_interaction_id'], 'llm_prompts_outputs_interaction_idx');
    t.index(['consent_id'], 'llm_prompts_outputs_consent_idx');
    t.index(['encryption_status'], 'llm_prompts_outputs_status_idx');
  });

  // CHECK constraint on encryption_status — machine-checkable, not
  // convention-based. Training-export filter can assert this column
  // without branching on convention.
  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE ${TABLE}
      ADD CONSTRAINT llm_prompts_outputs_encryption_status_check
      CHECK (encryption_status IN ('ENCRYPTED','FAILED','REVOKED'))
  `);

  // ── Immutability layer (via BUG-343 helper) ─────────────────────────────
  await applyImmutability(knex, {
    tableName: TABLE,
    errorMessage: `${TABLE} is append-only (BUG-282 tamper-evident)`,
  });

  // ── Trigger carve-out: permit the single revocation-soft-mark shape ────
  // The helper's trigger body unconditionally raises. BUG-282 requires
  // ONE permitted UPDATE: the revocation soft-mark. Replace the function
  // body (triggers already point at this function name; no trigger DDL
  // needed). Semantics:
  //   * DELETE always raises (DELETE path hits the same function).
  //   * UPDATE from non-REVOKED → REVOKED + NULL ciphertext columns
  //     is permitted (this is the soft-mark shape).
  //   * Every other UPDATE raises.
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${TABLE}_prevent_mutation()
      RETURNS TRIGGER AS $fn$
      BEGIN
        IF TG_OP = 'UPDATE'
           AND NEW.encryption_status = 'REVOKED'
           AND OLD.encryption_status IS DISTINCT FROM 'REVOKED'
           AND NEW.prompt_encrypted IS NULL
           AND NEW.output_encrypted IS NULL
           AND NEW.llm_interaction_id = OLD.llm_interaction_id
           AND NEW.consent_id IS NOT DISTINCT FROM OLD.consent_id
        THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION '${TABLE} is append-only (BUG-282 tamper-evident)';
      END;
      $fn$ LANGUAGE plpgsql
  `);

  // ── Soft-mark helper (SECURITY DEFINER so app_user can invoke) ─────────
  // Called from the consent revoke endpoint (features/llm/scribeRoutes.ts)
  // inside the same transaction that writes AMBIENT_NOTE_RECORDING_REVOKED
  // to audit_log. Updates ALL llm_prompts_outputs rows bound to the
  // revoked consent: status → 'REVOKED' + ciphertext columns → NULL.
  // Idempotent: re-running against an already-revoked consent is a no-op
  // because the trigger carve-out only fires when OLD.encryption_status
  // IS DISTINCT FROM 'REVOKED'; a second call on already-REVOKED rows
  // would raise — so the function's WHERE clause filters those out.
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${TABLE}_mark_revoked(p_consent_id uuid)
      RETURNS integer AS $fn$
      DECLARE
        v_rows integer;
      BEGIN
        UPDATE ${TABLE}
          SET encryption_status = 'REVOKED',
              prompt_encrypted  = NULL,
              output_encrypted  = NULL
          WHERE consent_id = p_consent_id
            AND encryption_status IS DISTINCT FROM 'REVOKED';
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        RETURN v_rows;
      END;
      $fn$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
  `);

  // Grant EXECUTE on the soft-mark helper to app_user so the revoke
  // endpoint (which runs as app_user via RLS context) can invoke it.
  // SECURITY DEFINER means the actual UPDATE runs with owner privs;
  // EXECUTE grant is just for the caller's ability to invoke.
  // @migration-raw-exempt: grant
  await knex.raw(`
    DO $do$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT EXECUTE ON FUNCTION ${TABLE}_mark_revoked(uuid) TO app_user;
      END IF;
    END
    $do$
  `);

  // ── RLS — tenant-scoped via FK chain to llm_interactions.clinic_id ─────
  // No direct clinic_id column on this table (SSoT: the parent
  // llm_interactions row is the tenant anchor; denormalising would
  // create drift potential). Policy joins via EXISTS which the
  // interaction_idx backs.
  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_${TABLE}_tenant ON ${TABLE}
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM llm_interactions li
          WHERE li.id = ${TABLE}.llm_interaction_id
          AND li.clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM llm_interactions li
          WHERE li.id = ${TABLE}.llm_interaction_id
          AND li.clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
        )
      )
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw(`DROP POLICY IF EXISTS rls_${TABLE}_tenant ON ${TABLE}`);
  // @migration-raw-exempt: function_drop
  await knex.raw(`DROP FUNCTION IF EXISTS ${TABLE}_mark_revoked(uuid)`);
  // Drop immutability stack (triggers + base function + GRANT restore)
  // via helper so the reversal matches the helper's applyImmutability
  // emission exactly.
  await dropImmutability(knex, { tableName: TABLE });
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS llm_prompts_outputs_encryption_status_check`);
  await knex.schema.dropTableIfExists(TABLE);
}
