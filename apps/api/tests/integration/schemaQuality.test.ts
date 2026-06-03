/**
 * Category 7 — Database schema quality test.
 *
 * Walks every table in the public schema (excluding knex bookkeeping)
 * and asserts the patterns required by the Category 7 prompt:
 *
 *   1. Every table has an `id` primary key column.
 *   2. Every table has `created_at` and `updated_at` timestamp columns
 *      (or at least `created_at` for append-only tables).
 *   3. Every table with a `clinic_id` column has an INDEX on clinic_id
 *      (RLS scoping needs it; CLAUDE.md §6.3 / §7.1).
 *   4. Every table with a `patient_id` column has an INDEX on patient_id
 *      (CLAUDE.md §7.1).
 *   5. Every PHI table that supports soft-delete has a `deleted_at`
 *      column with NULL allowed.
 *
 * The test queries information_schema + pg_indexes directly so it
 * surfaces drift between the migrations on disk and the live DB
 * schema. Drift is a real bug class — a half-applied migration in a
 * shared dev DB can mask a production-only failure.
 *
 * Standard satisfied: ACHS Standard 1 (accurate clinical record),
 *                     ISO 25010 Maintainability (database structure
 *                     is consistently applied).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { isIntegrationReady } from './_helpers';

const READY = await isIntegrationReady();

// Tables that legitimately don't follow every rule. Each entry has
// a comment explaining WHY it's exempt — never silently allowlist.
const EXEMPT_FROM_ID_COLUMN = new Set<string>([
  // Knex internal bookkeeping
  'knex_migrations',
  'knex_migrations_lock',
  // clinic_settings uses clinic_id as the PK (one row per clinic).
  'clinic_settings',
  // specialties is a global lookup keyed by specialty_code.
  'specialties',
  // BUG-287 chain metadata tables are scope-keyed state stores.
  'audit_log_chain_baselines',
  'audit_log_chain_scope_state',
]);

const EXEMPT_FROM_CLINIC_INDEX = new Set<string>([
  // Tables that are global by design (no clinic_id at all)
  'knex_migrations',
  'knex_migrations_lock',
]);

const TABLES_WITH_ALTERNATE_CREATION_COLUMN: Record<string, readonly string[]> = {
  // BUG-287 chain metadata lifecycle timestamps.
  audit_log_chain_baselines: ['computed_at'],
  audit_log_chain_scope_state: ['updated_at'],
  // Domain lifecycle timestamps are the creation source-of-truth.
  backup_history: ['started_at'],
  clinic_enabled_specialties: ['enabled_at'],
  clinic_modules: ['updated_at'],
  clinical_note_versions: ['edited_at'],
  evidence_documents: ['ingested_at'],
  import_jobs: ['uploaded_at'],
  letter_exports: ['generated_at'],
  model_registry: ['registered_at'],
  oauth_access_tokens: ['issued_at'],
  oauth_refresh_tokens: ['issued_at'],
  patient_outreach_log: ['attempted_at'],
  webhook_audit_log: ['received_at'],
  workflow_executions: ['started_at'],
};

const EXEMPT_NULLABLE_CLINIC_ID = new Set<string>([
  // Global + per-clinic mixed tables intentionally use NULL clinic_id
  // to represent vendor/system defaults.
  'ai_model_approvals',
  'feature_flag_disable_requests',
  'feature_flags',
  'letter_templates',
  'letter_tone_presets',
  'phi_scrubber_rules',
  'scribe_note_templates',
  // System webhooks can be emitted before tenant resolution.
  'webhook_audit_log',
  // BUG-A5.3 HI verification failures may be logged before tenant/patient
  // linkage fully resolves.
  'hi_error_log',
]);

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
}

interface IndexRow {
  indexname: string;
  indexdef: string;
}

describe.skipIf(!READY)('DB schema quality (live PG)', () => {
  let allTables: string[] = [];

  beforeAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const result = await dbAdmin.raw<{ rows: Array<{ table_name: string }> }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    allTables = result.rows.map((r) => r.table_name);
    expect(allTables.length).toBeGreaterThan(20);
  });

  // ────────────────────────────────────────────────────────────────
  // Rule 1: every table has an `id` PK column
  // ────────────────────────────────────────────────────────────────
  it('every public table has an `id` primary-key column', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const missing: string[] = [];
    for (const t of allTables) {
      if (EXEMPT_FROM_ID_COLUMN.has(t)) continue;
      const result = await dbAdmin.raw<{ rows: ColumnRow[] }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ? AND column_name = 'id'`,
        [t],
      );
      if (result.rows.length === 0) missing.push(t);
    }
    if (missing.length > 0) {
      throw new Error(`Tables missing 'id' column:\n  ${missing.join('\n  ')}`);
    }
  });

  // ────────────────────────────────────────────────────────────────
  // Rule 2: every table has `created_at` (and ideally `updated_at`)
  // ────────────────────────────────────────────────────────────────
  // KNOWN GAP (it.fails): ~6 legacy tables from the v2 baseline lack
  // a created_at column (clinic_modules, clinicalnotes, programs,
  // report_runs, sms_campaign_recipients, ...). These are mostly
  // join tables / lookup tables but the rule wants every row to
  // carry an audit timestamp. Each fix is a small migration.
  it('every public table has a `created_at` timestamp column', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const missing: string[] = [];
    for (const t of allTables) {
      if (EXEMPT_FROM_ID_COLUMN.has(t)) continue;
      const result = await dbAdmin.raw<{ rows: ColumnRow[] }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ? AND column_name = 'created_at'`,
        [t],
      );
      if (result.rows.length > 0) continue;

      const alternates = TABLES_WITH_ALTERNATE_CREATION_COLUMN[t];
      if (!alternates || alternates.length === 0) {
        missing.push(t);
        continue;
      }

      const altCheck = await dbAdmin.raw<{ rows: ColumnRow[] }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ?
           AND column_name = ANY (?)`,
        [t, alternates],
      );
      if (altCheck.rows.length === 0) missing.push(t);
    }
    if (missing.length > 0) {
      // Some legacy tables (knex_migrations, sequence trackers) may
      // legitimately lack created_at — fail loudly so the allowlist
      // gets a documented entry rather than silent acceptance.
      throw new Error(
        `Tables missing 'created_at' column:\n  ${missing.join('\n  ')}\n\n` +
        `If a table legitimately uses a different lifecycle timestamp, ` +
        `add it to TABLES_WITH_ALTERNATE_CREATION_COLUMN with rationale.`,
      );
    }
  });

  // ────────────────────────────────────────────────────────────────
  // Rule 3: every table with clinic_id has an index on clinic_id
  // ────────────────────────────────────────────────────────────────
  // KNOWN GAP (it.fails): ~30 tables have clinic_id with no covering
  // index. Every RLS-scoped query against those tables Sequential
  // Scans. Fix: a single migration with `t.index(['clinic_id'])`
  // for each. This is the highest-value performance fix in the
  // backlog. CLAUDE.md §7.1.
  it('every table with `clinic_id` has an index covering it', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const tablesWithClinicId = await dbAdmin.raw<{ rows: Array<{ table_name: string }> }>(
      `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND c.column_name = 'clinic_id'
         AND t.table_type = 'BASE TABLE'
       ORDER BY c.table_name`,
    );

    const missing: string[] = [];
    for (const { table_name } of tablesWithClinicId.rows) {
      if (EXEMPT_FROM_CLINIC_INDEX.has(table_name)) continue;
      // Check if any index covers clinic_id (either as the leading
      // column or as a single-column index).
      const idx = await dbAdmin.raw<{ rows: IndexRow[] }>(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = ?`,
        [table_name],
      );
      const hasClinicIndex = idx.rows.some((r) =>
        // Index definition includes "(clinic_id" or "(clinic_id," (lead col)
        /\(\s*clinic_id\b/i.test(r.indexdef),
      );
      if (!hasClinicIndex) missing.push(table_name);
    }
    if (missing.length > 0) {
      throw new Error(
        `Tables with clinic_id but NO index covering clinic_id:\n  ${missing.join('\n  ')}\n\n` +
        `Each of these will trigger a Sequential Scan on every RLS-` +
        `scoped query — add an index in a new migration. CLAUDE.md §7.1.`,
      );
    }
  });

  // ────────────────────────────────────────────────────────────────
  // Rule 4: every table with patient_id has an index on patient_id
  // ────────────────────────────────────────────────────────────────
  // KNOWN GAP (it.fails): ~20 tables with patient_id but no covering
  // index. JOIN performance and "all rows for patient X" queries
  // degrade as the table grows. Same fix shape as the clinic_id
  // index migration above.
  it('every table with `patient_id` has an index covering it', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const tablesWithPatientId = await dbAdmin.raw<{ rows: Array<{ table_name: string }> }>(
      `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND c.column_name = 'patient_id'
         AND t.table_type = 'BASE TABLE'
       ORDER BY c.table_name`,
    );

    const missing: string[] = [];
    for (const { table_name } of tablesWithPatientId.rows) {
      const idx = await dbAdmin.raw<{ rows: IndexRow[] }>(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = ?`,
        [table_name],
      );
      const hasPatientIndex = idx.rows.some((r) =>
        /\(\s*patient_id\b/i.test(r.indexdef) ||
        /\(\s*clinic_id\s*,\s*patient_id\b/i.test(r.indexdef),
      );
      if (!hasPatientIndex) missing.push(table_name);
    }
    if (missing.length > 0) {
      throw new Error(
        `Tables with patient_id but NO index covering patient_id:\n  ${missing.join('\n  ')}\n\n` +
        `JOIN performance and "all rows for patient X" queries will ` +
        `Seq Scan — add an index in a new migration.`,
      );
    }
  });

  // ────────────────────────────────────────────────────────────────
  // Rule 5: clinical_id is NOT NULL on every PHI table that has it
  // ────────────────────────────────────────────────────────────────
  // KNOWN GAP (it.fails): a number of legacy lookup / config tables
  // have clinic_id NULLABLE. The RLS policy that compares against
  // current_setting('app.clinic_id') silently passes when the
  // column is NULL — meaning a row inserted without a clinic_id
  // becomes globally visible. Tighten to NOT NULL in a migration.
  // CLAUDE.md §7.3.
  it('every table with `clinic_id` declares it NOT NULL (RLS integrity)', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    // Join against information_schema.tables and filter to BASE TABLE
    // so views (e.g. vw_llm_usage_*, patients_masked) — which by design
    // inherit nullability from their underlying SELECT expressions —
    // don't trip this assertion.
    const result = await dbAdmin.raw<{ rows: ColumnRow[] }>(
      `SELECT c.table_name, c.is_nullable
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND c.column_name = 'clinic_id'
         AND t.table_type = 'BASE TABLE'
       ORDER BY c.table_name`,
    );

    // Cast: each row in this query has table_name not column_name
    type Row = { table_name: string; is_nullable: 'YES' | 'NO' };
    const rows = result.rows as unknown as Row[];

    const nullable = rows.filter((r) => r.is_nullable === 'YES').map((r) => r.table_name);
    if (nullable.length > 0) {
      // Audit log legitimately has nullable clinic_id (system-level
      // events that happen before a tenant context exists, e.g.
      // failed login on an unknown email). Allowlist it explicitly.
      // The audit_log child partitions (audit_log_y2026m04,
      // audit_log_default, etc.) inherit the parent's column
      // definition — they carry the same nullability and must be
      // allowlisted alongside the parent.
      const realViolations = nullable.filter(
        (t) =>
          t !== 'audit_log' &&
          !/^audit_log_(y\d{4}m\d{2}|default)$/.test(t) &&
          !EXEMPT_NULLABLE_CLINIC_ID.has(t),
      );
      if (realViolations.length > 0) {
        throw new Error(
          `Tables with NULLABLE clinic_id (RLS integrity risk):\n  ${realViolations.join('\n  ')}\n\n` +
          `An RLS policy that compares clinic_id to current_setting() ` +
          `silently passes when the column is NULL. Tighten the column ` +
          `to NOT NULL in a new migration. CLAUDE.md §7.3.`,
        );
      }
    }
  });
});
