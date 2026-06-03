/**
 * Phase — Bulk import pipeline + re-allocation approval workflow.
 *
 * Adds one new table: `import_jobs` — audit + dry-run state for
 * every bulk CSV upload. One row per upload. Carries the parsed
 * errors, row count, committer, and committed_at timestamp (NULL
 * while the job is in dry-run). An import job belongs to a clinic,
 * a specific kind (patients / mha / lai / clozapine /
 * clinical_notes), and a specific uploader. RLS enforced.
 *
 * Re-allocation approval workflow reuses the columns that already
 * exist on `patient_team_assignments`:
 *
 *   - `referral_status` — carries the approval state. This
 *     migration locks down the allowed values via a CHECK
 *     constraint so the application layer can rely on the four-
 *     value enum: 'active' | 'pending_approval' | 'rejected' |
 *     (the legacy value set already uses these plus occasional
 *      nulls / blanks which we normalise in the migration).
 *   - `referred_by_id` — who requested the re-allocation
 *   - `reviewed_by_id` + `reviewed_at` — who approved/rejected + when
 *   - `rejection_reason` — free text captured on reject
 *
 * No new columns on `patient_team_assignments` — the existing shape
 * is sufficient and duplicating fields would be schema drift.
 *
 * A partial index on `(patient_id) WHERE referral_status =
 * 'pending_approval'` accelerates the "what's waiting for my
 * approval" queue used by the Phase 3 approval routes.
 */
import type { Knex } from 'knex';

const IMPORT_KINDS = [
  'patients',
  'mha',
  'lai',
  'clozapine',
  'clinical_notes',
] as const;

const IMPORT_STATUSES = [
  'pending',        // uploaded, dry-run in progress
  'validated',      // dry-run complete, awaiting commit
  'committed',      // rows applied
  'rejected',       // failed validation, not committed
] as const;

const APPROVAL_STATUSES = [
  'active',
  'pending_approval',
  'rejected',
  'accepted',        // legacy value — preserved to avoid a data rewrite
] as const;

const CHK = (values: readonly string[]) => values.map((s) => `'${s}'`).join(', ');

export async function up(knex: Knex): Promise<void> {
  // ── import_jobs ────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('import_jobs'))) {
    await knex.schema.createTable('import_jobs', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('uploaded_by_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
      t.string('kind', 40).notNullable();
      t.string('status', 20).notNullable().defaultTo('pending');
      t.string('filename', 500).nullable();
      t.integer('row_count').notNullable().defaultTo(0);
      t.integer('error_count').notNullable().defaultTo(0);
      t.integer('committed_count').notNullable().defaultTo(0);
      // { errors: [{ rowIndex, field, message }], warnings: [...] }
      t.jsonb('report').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      t.timestamp('uploaded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('committed_at', { useTz: true }).nullable();
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'kind']);
      t.index(['clinic_id', 'status']);
      t.index(['uploaded_by_id']);
    });

    await knex.raw(`
      ALTER TABLE import_jobs
        ADD CONSTRAINT import_jobs_kind_check CHECK (kind IN (${CHK(IMPORT_KINDS)}))
    `);
    await knex.raw(`
      ALTER TABLE import_jobs
        ADD CONSTRAINT import_jobs_status_check CHECK (status IN (${CHK(IMPORT_STATUSES)}))
    `);
    await knex.raw(`
      ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_import_jobs_tenant ON import_jobs
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // ── patient_team_assignments — lock down referral_status values ─────────
  // The column already exists with default 'active'. We normalise any
  // nulls / blanks to 'active' so the CHECK constraint can apply, then
  // add the CHECK. The constraint accepts 'accepted' as a legacy value
  // the current referral routes still write — they'll migrate to
  // 'active' over time.
  const hasReferralStatus = await knex.schema.hasColumn('patient_team_assignments', 'referral_status');
  if (hasReferralStatus) {
    await knex.raw(`
      UPDATE patient_team_assignments
         SET referral_status = 'active'
       WHERE referral_status IS NULL OR referral_status = ''
    `);
    await knex.raw(`
      ALTER TABLE patient_team_assignments
        DROP CONSTRAINT IF EXISTS patient_team_assignments_referral_status_check
    `);
    await knex.raw(`
      ALTER TABLE patient_team_assignments
        ADD CONSTRAINT patient_team_assignments_referral_status_check
        CHECK (referral_status IN (${CHK(APPROVAL_STATUSES)}))
    `);
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_patient_team_assignments_pending_approval
        ON patient_team_assignments (patient_id)
        WHERE referral_status = 'pending_approval'
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_patient_team_assignments_pending_approval');
  await knex.raw('ALTER TABLE patient_team_assignments DROP CONSTRAINT IF EXISTS patient_team_assignments_referral_status_check');
  await knex.raw('DROP POLICY IF EXISTS rls_import_jobs_tenant ON import_jobs');
  await knex.schema.dropTableIfExists('import_jobs');
}
