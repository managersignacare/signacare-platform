import { Knex } from 'knex';

/**
 * Audit Tier 1.4 (CRIT-H2 / GAP-B2) — split phone_triage.triage_notes into
 * role-specific columns so the receptionist's intake text and the nurse's
 * clinical-risk findings are no longer commingled in a single free-text
 * field.
 *
 * Before this migration: `phone_triage.triage_notes text NULL` was the
 * only notes column and was written by BOTH receptionist POST/PUT (as
 * "what the caller said + action taken") AND implicitly available for
 * nurse overwrite (as "clinical risk flags"). Because the two data-shapes
 * share one column, (a) a nurse's risk note could be overwritten by a
 * receptionist PUT, (b) receptionist-visible UI leaked nurse-entered risk
 * text to non-clinical staff, and (c) the value couldn't be queried in
 * any structured way.
 *
 * Structural fix (this migration + companion code split in
 * receptionistFeatureRoutes.ts + nurseFeatureRoutes.ts):
 *
 *   (a) Add `receptionist_summary text NULL` — administrative summary
 *       the receptionist enters at intake. Replaces `triage_notes` on
 *       the receptionist write-path.
 *   (b) Add `clinical_risk_flags jsonb NULL` — structured risk data the
 *       nurse records on clinical review (e.g.
 *       `{"suicidality":"low","intoxication":false,"agitation":"mild"}`).
 *       Jsonb so the app can evolve the shape without another migration.
 *   (c) Receptionist POST/PUT writes receptionist_summary only.
 *   (d) Nurse POST/PUT (new `/phone-triage/:id/clinical-triage` route)
 *       writes clinical_risk_flags and may refine receptionist_summary.
 *   (e) GET /phone-triage strips clinical_risk_flags from the response
 *       when the caller is not NURSE_ROLES.
 *   (f) `triage_notes` kept for legacy-row reads (commented deprecated
 *       on the column — see COMMENT below). No new writes target it.
 *
 * Reversible: down() drops the two new columns and the column comment.
 * Legacy triage_notes data is not touched.
 *
 * Idempotency: a partial prior apply may have left the columns in place
 * without a knex_migrations ledger row, so this migration must be no-op-
 * safe when the columns already exist. Phase 0b.1c (2026-05-04) absorb:
 * the JS-level idempotency pattern (`await knex.schema.hasColumn(...)`
 * gate before `knex.schema.alterTable(...)`) is the canonical Knex
 * equivalent of `ADD COLUMN IF NOT EXISTS` — keeps the column declaration
 * inside the builder, where the migration-driven type generator can see
 * it (Phase 0b.1a/b). The pre-Phase-0b.1c shape used raw `ALTER TABLE
 * phone_triage ADD COLUMN IF NOT EXISTS ...` which was invisible to the
 * generator and is now blocked by `check-no-column-ddl-in-raw-sql`.
 *
 * 13-point audit: #5 Confidentiality, #7 Security, #8 DB (reversible),
 * #10 API (DTO split).
 */
export async function up(knex: Knex): Promise<void> {
  // Phase 0b.1c (2026-05-04): JS-level idempotency guard via hasColumn,
  // not raw `ADD COLUMN IF NOT EXISTS` — column DDL must be expressible
  // through the Knex builder so the migration-driven type generator
  // (Phase 0b.1a/b) sees these column adds.
  if (!(await knex.schema.hasColumn('phone_triage', 'receptionist_summary'))) {
    await knex.schema.alterTable('phone_triage', (t) => {
      t.text('receptionist_summary').nullable();
    });
  }
  if (!(await knex.schema.hasColumn('phone_triage', 'clinical_risk_flags'))) {
    await knex.schema.alterTable('phone_triage', (t) => {
      t.jsonb('clinical_risk_flags').nullable();
    });
  }

  // @migration-raw-exempt: column_comment
  await knex.raw(
    "COMMENT ON COLUMN phone_triage.triage_notes IS "
    + "'DEPRECATED (2026-04-19, Tier 1.4): split into receptionist_summary "
    + "(receptionist-entered admin text) + clinical_risk_flags "
    + "(nurse-entered structured clinical risk). Reads still honoured for "
    + "legacy rows; new writes MUST target the split columns.'",
  );
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: column_comment
  await knex.raw('COMMENT ON COLUMN phone_triage.triage_notes IS NULL');
  // Phase 0b.1c (2026-05-04): JS-level idempotency guard.
  if (await knex.schema.hasColumn('phone_triage', 'clinical_risk_flags')) {
    await knex.schema.alterTable('phone_triage', (t) => {
      t.dropColumn('clinical_risk_flags');
    });
  }
  if (await knex.schema.hasColumn('phone_triage', 'receptionist_summary')) {
    await knex.schema.alterTable('phone_triage', (t) => {
      t.dropColumn('receptionist_summary');
    });
  }
}
