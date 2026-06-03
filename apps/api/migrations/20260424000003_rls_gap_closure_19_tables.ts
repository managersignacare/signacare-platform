import { Knex } from 'knex';

/**
 * BUG-454 — RLS gap-closure on 19 tenant-scoped tables.
 *
 * Wave 6b F-migrations found 19 tables without `ENABLE ROW LEVEL SECURITY`
 * despite carrying `clinic_id` directly or via FK chain. Without RLS,
 * Layer-2 tenant isolation doesn't exist for these tables — any query
 * that happens to forget the app-layer `clinic_id` filter (see BUG-368 +
 * BUG-430 for the 186 known app-layer gaps) would leak cross-clinic
 * rows.
 *
 * This migration adds one of three policy shapes per table:
 *
 *   1. DIRECT (2 tables): `source_clinic_id` column on the table itself.
 *      Policy: `source_clinic_id = app.clinic_id`.
 *
 *   2. FK-CHAIN (14 tables): tenant scope derived from a parent table's
 *      `clinic_id`. Policy: `EXISTS (SELECT 1 FROM <parent> p WHERE
 *      p.id = <child>.<fk_col> AND p.clinic_id = app.clinic_id)`.
 *      Matches the pattern shipped in 20260701000036_llm_prompts_outputs.ts.
 *
 *   3. SUPERADMIN-ONLY (3 tables — backup_config, model_registry,
 *      evidence_documents): no clinic association; system-wide catalog
 *      or admin-loaded RAG evidence. Policy: superadmin OR owner role
 *      only. evidence_chunks follows its parent.
 *
 * No table has `FORCE ROW LEVEL SECURITY` — dbAdmin connections (audit
 * writes, migrations, ops tools) bypass RLS per the existing project
 * pattern. The policies only apply to `app_user`-shaped connections
 * that set `app.clinic_id` via `rlsMiddleware`.
 *
 * Verified 2026-04-24 against live PG (postgresql@17 / signacaredb):
 * `patient_sync_preferences` was already RLS-enabled by a later
 * migration; the audit's count of 20 drops to 19.
 */

// Tables whose tenant scope is derived from a direct parent FK's clinic_id.
// Format: [childTable, parentTable, childFkColumn]
//
// IMPORTANT: every parent listed here MUST carry `clinic_id` as a direct
// column (verified 2026-04-24 against live PG). `evidence_documents`
// DOES NOT — it's admin-curated RAG content and belongs in the
// superadmin-only bucket along with its child `evidence_chunks`.
const FK_CHAIN_TABLES: Array<[string, string, string]> = [
  // staff-FK chain (parent clinic_id via staff.clinic_id)
  ['staff_role_assignments', 'staff', 'staff_id'],
  ['staff_team_assignments', 'staff', 'staff_id'],
  ['staff_settings', 'staff', 'staff_id'],
  ['staff_permissions', 'staff', 'staff_id'],
  ['mfa_secrets', 'staff', 'staff_id'],
  // patient-FK chain
  ['patient_team_assignments', 'patients', 'patient_id'],
  ['group_session_attendees', 'patients', 'patient_id'],
  ['planned_transition_assignments', 'patients', 'patient_id'],
  // other-parent FK chain
  ['message_thread_participants', 'message_threads', 'thread_id'],
  ['invoice_line_items', 'invoices', 'invoice_id'],
  ['template_sections', 'templates', 'template_id'],
  ['escalation_events', 'escalations', 'escalation_id'],
];

// Tables with a direct clinic-id column.
// Format: [tableName, columnName]
const DIRECT_COLUMN_TABLES: Array<[string, string]> = [
  ['training_corpus_items', 'source_clinic_id'],
  ['model_surveillance_events', 'source_clinic_id'],
];

// Tables with no clinic association — admin-only WRITES, no reads by app_user.
// `backup_history` moved here from FK-chain per L4 absorb: the FK-chain via
// `triggered_by_staff_id` would orphan rows invisible to every tenant if the
// staff row is deleted (ON DELETE SET NULL). Backup provenance is ops data.
const SUPERADMIN_ONLY_TABLES: string[] = [
  'backup_config',
  'model_registry',
  'backup_history',
];

// Tables that hold non-PHI reference data (admin-curated clinical
// guidelines / RAG evidence). Policy: READ is open to all authenticated
// sessions — these rows are the same for every tenant and are required
// by the tenant-scoped AI retrieval pipeline (`evidenceClient.dbRead`).
// WRITE is locked to the owner role (admin curation only). L4 absorb:
// superadmin-only READ would break the RAG pipeline for clinical prompt
// grounding with silent empty-result failure.
const NON_PHI_REFERENCE_TABLES: string[] = [
  'evidence_documents',
  'evidence_chunks',
];

export async function up(knex: Knex): Promise<void> {
  // Each block is idempotent — DROP POLICY IF EXISTS then CREATE. This
  // matters because a partial migration run might leave policies on
  // some tables but not others; re-running must converge cleanly.
  //
  // Some tables in these lists may be introduced by later migrations in
  // today's consolidated ledger. Guard each policy block with hasTable()
  // so fresh-bootstrap runs never fail on forward-declared tables.

  // FK-chain policies (14 tables)
  for (const [child, parent, fkCol] of FK_CHAIN_TABLES) {
    const childExists = await knex.schema.hasTable(child);
    const parentExists = await knex.schema.hasTable(parent);
    if (!childExists || !parentExists) continue;

    // @migration-raw-exempt: drop_policy_if_exists
    await knex.raw(`DROP POLICY IF EXISTS rls_${child}_tenant ON ${child}`);
    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE ${child} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_${child}_tenant ON ${child}
        FOR ALL
        USING (EXISTS (
          SELECT 1 FROM ${parent} p
          WHERE p.id = ${child}.${fkCol}
            AND p.clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM ${parent} p
          WHERE p.id = ${child}.${fkCol}
            AND p.clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
        ))
    `);
  }

  // Direct-column policies (2 tables)
  for (const [tbl, col] of DIRECT_COLUMN_TABLES) {
    const tableExists = await knex.schema.hasTable(tbl);
    if (!tableExists) continue;

    // @migration-raw-exempt: drop_policy_if_exists
    await knex.raw(`DROP POLICY IF EXISTS rls_${tbl}_tenant ON ${tbl}`);
    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_${tbl}_tenant ON ${tbl}
        FOR ALL
        USING (${col} = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
        WITH CHECK (${col} = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
    `);
  }

  // Superadmin-only policies (3 tables)
  // Uses current_user = 'signacare_owner' because `app_user` sessions
  // hit the policy USING clause; the owner role runs migrations / ops
  // tooling and should bypass the clinic filter. Policy returns rows
  // ONLY to the owner; `app_user` sees nothing on these tables which
  // is the intended behaviour (system-catalog tables should never be
  // visible to tenant-scoped connections).
  for (const tbl of SUPERADMIN_ONLY_TABLES) {
    const tableExists = await knex.schema.hasTable(tbl);
    if (!tableExists) continue;

    // @migration-raw-exempt: drop_policy_if_exists
    await knex.raw(`DROP POLICY IF EXISTS rls_${tbl}_admin_only ON ${tbl}`);
    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_${tbl}_admin_only ON ${tbl}
        FOR ALL
        USING (current_user = 'signacare_owner')
        WITH CHECK (current_user = 'signacare_owner')
    `);
  }

  // Non-PHI reference tables — READ open to all authenticated sessions,
  // WRITE locked to owner. See the rationale comment on the
  // NON_PHI_REFERENCE_TABLES array.
  for (const tbl of NON_PHI_REFERENCE_TABLES) {
    const tableExists = await knex.schema.hasTable(tbl);
    if (!tableExists) continue;

    // @migration-raw-exempt: drop_policy_if_exists
    await knex.raw(`DROP POLICY IF EXISTS rls_${tbl}_read_all ON ${tbl}`);
    // @migration-raw-exempt: drop_policy_if_exists
    await knex.raw(`DROP POLICY IF EXISTS rls_${tbl}_write_admin ON ${tbl}`);
    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_${tbl}_read_all ON ${tbl}
        FOR SELECT
        USING (true);
      CREATE POLICY rls_${tbl}_write_admin ON ${tbl}
        FOR ALL
        USING (current_user = 'signacare_owner')
        WITH CHECK (current_user = 'signacare_owner')
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const [child] of FK_CHAIN_TABLES) {
    const tableExists = await knex.schema.hasTable(child);
    if (!tableExists) continue;

    // @migration-raw-exempt: drop_policy_if_exists
    await knex.raw(`DROP POLICY IF EXISTS rls_${child}_tenant ON ${child}`);
    // @migration-raw-exempt: rls_policy
    await knex.raw(`ALTER TABLE ${child} DISABLE ROW LEVEL SECURITY`);
  }
  for (const [tbl] of DIRECT_COLUMN_TABLES) {
    const tableExists = await knex.schema.hasTable(tbl);
    if (!tableExists) continue;

    // @migration-raw-exempt: drop_policy_if_exists
    await knex.raw(`DROP POLICY IF EXISTS rls_${tbl}_tenant ON ${tbl}`);
    // @migration-raw-exempt: rls_policy
    await knex.raw(`ALTER TABLE ${tbl} DISABLE ROW LEVEL SECURITY`);
  }
  for (const tbl of SUPERADMIN_ONLY_TABLES) {
    const tableExists = await knex.schema.hasTable(tbl);
    if (!tableExists) continue;

    // @migration-raw-exempt: drop_policy_if_exists
    await knex.raw(`DROP POLICY IF EXISTS rls_${tbl}_admin_only ON ${tbl}`);
    // @migration-raw-exempt: rls_policy
    await knex.raw(`ALTER TABLE ${tbl} DISABLE ROW LEVEL SECURITY`);
  }
  for (const tbl of NON_PHI_REFERENCE_TABLES) {
    const tableExists = await knex.schema.hasTable(tbl);
    if (!tableExists) continue;

    // @migration-raw-exempt: drop_policy_if_exists
    await knex.raw(`DROP POLICY IF EXISTS rls_${tbl}_read_all ON ${tbl}`);
    // @migration-raw-exempt: drop_policy_if_exists
    await knex.raw(`DROP POLICY IF EXISTS rls_${tbl}_write_admin ON ${tbl}`);
    // @migration-raw-exempt: rls_policy
    await knex.raw(`ALTER TABLE ${tbl} DISABLE ROW LEVEL SECURITY`);
  }
}
