import type { Knex } from 'knex';

/**
 * Schema-quality cleanup (Category 7 — DB hygiene).
 *
 * Fills three gaps surfaced by tests/integration/schemaQuality.test.ts:
 *
 *   1. Missing `clinic_id` indexes (RLS scoping → seq scan risk).
 *      CLAUDE.md §7.1 requires an index on every clinic_id column.
 *
 *   2. Missing `patient_id` indexes (JOIN + cohort queries → seq scan).
 *      CLAUDE.md §7.1 requires an index on every patient_id column.
 *
 *   3. Missing `created_at` columns (audit trail gap) — 6 legacy
 *      tables that lost the column during the v2 migration. Every
 *      row needs a server-side timestamp so the audit window is
 *      complete. CLAUDE.md §7.3.
 *
 *   4. Nullable `clinic_id` columns (RLS integrity risk) — when
 *      clinic_id is NULL, RLS policies comparing against
 *      current_setting('app.clinic_id') silently pass, which makes
 *      the row globally visible. We tightened to NOT NULL wherever
 *      the column currently has zero NULL values (verified on
 *      2026-04-11 against the dev DB). audit_log is allowlisted:
 *      pre-auth events (e.g. failed login on unknown email) do not
 *      yet have a tenant context and must be permitted to land
 *      with clinic_id IS NULL.
 *
 * This migration is append-only and idempotent:
 *   - every index uses CREATE INDEX IF NOT EXISTS (via hasIndex)
 *   - every column add uses hasColumn guard
 *   - every NOT NULL is guarded by an is_nullable check
 *
 * The down() is intentionally a no-op. Rolling back indexes or
 * NOT-NULL tightenings mid-production would re-introduce the
 * exact bugs this migration fixes; there is no "safe rollback".
 *
 * Standard satisfied: CLAUDE.md §7.1 + §7.3, ACHS Standard 1
 * (accurate clinical record), ISO 25010 Maintainability.
 */

// Tables needing a clinic_id index. Verified 2026-04-11 against dev DB.
const CLINIC_INDEX_TABLES = [
  'ai_context_files',
  'ai_provenance',
  'fhir_subscriptions',
  'group_session_attendees',
  'patient_attachments',
  'patient_legal_attachments',
  'patient_team_assignments',
  'planned_transition_assignments',
  'smart_apps',
  'sms_campaign_recipients',
];

// Tables needing a patient_id index. Verified 2026-04-11 against dev DB.
const PATIENT_INDEX_TABLES = [
  'aims_assessments',
  'appointments',
  'care_plan_goals',
  'clinical_formulations',
  'clozapine_blood_results',
  'clozapine_registrations',
  'consultations',
  'contact_records',
  'correspondence_letters',
  'engagement_scores',
  'key_issues',
  'lai_given',
  'lai_schedules',
  'legal_orders',
  'message_threads',
  'outcome_measures',
  'pathology_orders',
  'pathology_results',
  'patient_allergies',
  'patient_flags',
  'prescriptions',
  'restrictive_interventions',
  'review_plans',
  'side_effect_schedules',
  'sms_campaign_recipients',
  'voice_patient_preferences',
  'waitlist_entries',
];

// Tables needing a created_at column. Each gets a default of now()
// so existing rows get a stamp (best-effort — this is a legacy fill).
const CREATED_AT_TABLES = [
  'clinic_modules',
  'clinicalnotes',
  'programs',
  'report_runs',
  'sms_campaign_recipients',
  'staff_permissions',
];

// Tables where clinic_id must be tightened to NOT NULL. Verified
// on 2026-04-11 that every table in this list has zero rows with
// NULL clinic_id. audit_log is deliberately excluded (see header).
const NOT_NULL_CLINIC_TABLES = [
  'ai_provenance',
  'ai_training_feedback',
  'assessment_responses',
  'correspondence_letters',
  'drug_products',
  'group_session_attendees',
  'message_thread_participants',
  'messages',
  'patient_attachments',
  'patient_contacts',
  'patient_legal_attachments',
  'patient_providers',
  'patient_team_assignments',
  'payments',
  'planned_transition_assignments',
  'programs',
  'sms_campaign_recipients',
  'treatment_plans',
];

async function hasIndexOnColumn(
  knex: Knex,
  table: string,
  column: string,
): Promise<boolean> {
  const r = await knex.raw<{ rows: Array<{ indexdef: string }> }>(
    `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=?`,
    [table],
  );
  const re = new RegExp(`\\(\\s*${column}\\b`, 'i');
  return r.rows.some((row) => re.test(row.indexdef));
}

async function tableExists(knex: Knex, table: string): Promise<boolean> {
  const r = await knex.raw<{ rows: Array<unknown> }>(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name=?`,
    [table],
  );
  return r.rows.length > 0;
}

export async function up(knex: Knex): Promise<void> {
  // 1. clinic_id indexes
  for (const table of CLINIC_INDEX_TABLES) {
    if (!(await tableExists(knex, table))) continue;
    if (!(await knex.schema.hasColumn(table, 'clinic_id'))) continue;
    if (await hasIndexOnColumn(knex, table, 'clinic_id')) continue;
    // Use CREATE INDEX IF NOT EXISTS as a second safety net.
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS ${table}_clinic_id_idx ON "${table}" (clinic_id)`,
    );
  }

  // 2. patient_id indexes
  for (const table of PATIENT_INDEX_TABLES) {
    if (!(await tableExists(knex, table))) continue;
    if (!(await knex.schema.hasColumn(table, 'patient_id'))) continue;
    if (await hasIndexOnColumn(knex, table, 'patient_id')) continue;
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS ${table}_patient_id_idx ON "${table}" (patient_id)`,
    );
  }

  // 3. created_at columns
  for (const table of CREATED_AT_TABLES) {
    if (!(await tableExists(knex, table))) continue;
    if (!(await knex.schema.hasColumn(table, 'created_at'))) {
      await knex.schema.alterTable(table, (t) => {
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      });
    }
  }

  // 4. Tighten clinic_id to NOT NULL on verified-clean tables.
  for (const table of NOT_NULL_CLINIC_TABLES) {
    if (!(await tableExists(knex, table))) continue;
    const col = await knex.raw<{ rows: Array<{ is_nullable: 'YES' | 'NO' }> }>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name=? AND column_name='clinic_id'`,
      [table],
    );
    if (col.rows[0]?.is_nullable !== 'YES') continue;
    // Defensive: refuse to tighten if any row is currently NULL,
    // even though we verified on 2026-04-11. Migrations run
    // against production at a later date and row state drifts.
    const nullCount = await knex.raw<{ rows: Array<{ n: string }> }>(
      `SELECT count(*)::text AS n FROM "${table}" WHERE clinic_id IS NULL`,
    );
    if (Number(nullCount.rows[0]?.n ?? 0) > 0) continue;
    await knex.raw(`ALTER TABLE "${table}" ALTER COLUMN clinic_id SET NOT NULL`);
  }
}

export async function down(): Promise<void> {
  // No-op. Reverting indexes + NOT NULL constraints mid-production
  // would re-introduce the seq-scan and RLS-integrity bugs this
  // migration exists to fix. Schema hygiene migrations are
  // append-only. See migration header for the ACHS / CLAUDE.md
  // trail.
}
