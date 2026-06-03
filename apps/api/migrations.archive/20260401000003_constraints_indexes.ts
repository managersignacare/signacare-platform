/**
 * Migration: Unique constraints and missing indexes.
 *
 * Phase 0.7.1 rewrite: replaced every `.catch(() => {})` with
 * proper precondition checks (hasTable, hasColumn, constraint
 * existence query). PostgreSQL aborts the entire transaction on
 * ANY error — JS `.catch()` doesn't prevent the transaction from
 * entering the 25P02 (in_failed_sql_transaction) state.
 *
 * Every CREATE INDEX and ALTER TABLE now verifies the target table
 * and column exist before executing.
 */
import type { Knex } from 'knex';

async function hasConstraint(knex: Knex, name: string): Promise<boolean> {
  const r = await knex.raw(
    `SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = ?`,
    [name],
  );
  return (r.rows ?? []).length > 0;
}

async function safeCreateIndex(
  knex: Knex,
  table: string,
  column: string,
  indexName?: string,
  whereClause?: string,
): Promise<void> {
  if (!(await knex.schema.hasTable(table))) return;
  if (!(await knex.schema.hasColumn(table, column))) return;
  const idx = indexName ?? `idx_${table}_${column}`;
  const where = whereClause ? ` WHERE ${whereClause}` : '';
  await knex.raw(`CREATE INDEX IF NOT EXISTS ${idx} ON ${table} (${column})${where}`);
}

export async function up(knex: Knex): Promise<void> {
  // 1. UNIQUE on patient_team_assignments(patient_id, org_unit_id)
  if (await knex.schema.hasTable('patient_team_assignments')) {
    if (!(await hasConstraint(knex, 'uq_patient_team_assignments_patient_org'))) {
      // Deduplicate first
      await knex.raw(`
        DELETE FROM patient_team_assignments
        WHERE id NOT IN (
          SELECT DISTINCT ON (patient_id, org_unit_id) id
          FROM patient_team_assignments
          ORDER BY patient_id, org_unit_id, created_at DESC
        )
      `);
      await knex.raw(`
        ALTER TABLE patient_team_assignments
        ADD CONSTRAINT uq_patient_team_assignments_patient_org
        UNIQUE (patient_id, org_unit_id)
      `);
    }
  }

  // 2. UNIQUE on staff(clinic_id, email)
  if (await knex.schema.hasTable('staff')) {
    if (!(await hasConstraint(knex, 'uq_staff_clinic_email'))) {
      await knex.raw(`
        DELETE FROM staff
        WHERE id NOT IN (
          SELECT DISTINCT ON (clinic_id, email) id
          FROM staff
          ORDER BY clinic_id, email, created_at DESC
        )
      `);
      await knex.raw(`
        ALTER TABLE staff
        ADD CONSTRAINT uq_staff_clinic_email
        UNIQUE (clinic_id, email)
      `);
    }
  }

  // 3. Missing patient_id indexes
  const patientIdTables = [
    'patient_legal_orders', 'patient_legal_attachments',
    'patient_alert_attachments', 'mha_reviews',
    'correspondence_letters', 'invoices', 'payments',
    'outcome_measures', 'structured_observations',
    'treatment_pathways', 'hotspots',
    'restrictive_interventions', 'billing_accounts',
  ];
  for (const table of patientIdTables) {
    await safeCreateIndex(knex, table, 'patient_id');
  }

  // 4. Critical FK column indexes
  await safeCreateIndex(knex, 'appointments', 'clinician_id');
  await safeCreateIndex(knex, 'episodes', 'primary_clinician_id');
  await safeCreateIndex(knex, 'tasks', 'assigned_to_id');
  await safeCreateIndex(knex, 'escalations', 'assigned_to_id');
  await safeCreateIndex(knex, 'escalations', 'raised_by_id');
  await safeCreateIndex(knex, 'clinical_notes', 'author_id');
  await safeCreateIndex(knex, 'clinical_notes', 'episode_id');
  await safeCreateIndex(knex, 'prescriptions', 'prescribed_by_staff_id', 'idx_prescriptions_prescribed_by');
  await safeCreateIndex(knex, 'referrals', 'assigned_to_staff_id', 'idx_referrals_assigned_to');
  await safeCreateIndex(knex, 'contact_records', 'episode_id');
  await safeCreateIndex(knex, 'voice_calls', 'patient_id');
  await safeCreateIndex(knex, 'consultations', 'clinician_id');
  await safeCreateIndex(knex, 'lai_schedules', 'clinician_id', 'idx_lai_schedules_clinician_id', 'clinician_id IS NOT NULL');
  await safeCreateIndex(knex, 'bed_movements', 'bed_id');
  await safeCreateIndex(knex, 'message_thread_participants', 'staff_id', 'idx_msg_participants_staff_id');
  await safeCreateIndex(knex, 'messages', 'thread_id');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE patient_team_assignments DROP CONSTRAINT IF EXISTS uq_patient_team_assignments_patient_org');
  await knex.raw('ALTER TABLE staff DROP CONSTRAINT IF EXISTS uq_staff_clinic_email');

  const indexes = [
    'idx_patient_legal_orders_patient_id', 'idx_patient_legal_attachments_patient_id',
    'idx_patient_alert_attachments_patient_id', 'idx_mha_reviews_patient_id',
    'idx_correspondence_letters_patient_id', 'idx_invoices_patient_id',
    'idx_payments_patient_id', 'idx_outcome_measures_patient_id',
    'idx_structured_observations_patient_id', 'idx_treatment_pathways_patient_id',
    'idx_hotspots_patient_id', 'idx_restrictive_interventions_patient_id',
    'idx_billing_accounts_patient_id', 'idx_appointments_clinician_id',
    'idx_episodes_primary_clinician_id', 'idx_tasks_assigned_to_id',
    'idx_escalations_assigned_to_id', 'idx_escalations_raised_by_id',
    'idx_clinical_notes_author_id', 'idx_clinical_notes_episode_id',
    'idx_prescriptions_prescribed_by', 'idx_referrals_assigned_to',
    'idx_contact_records_episode_id', 'idx_voice_calls_patient_id',
    'idx_consultations_clinician_id', 'idx_lai_schedules_clinician_id',
    'idx_bed_movements_bed_id', 'idx_msg_participants_staff_id',
    'idx_messages_thread_id',
  ];
  for (const idx of indexes) {
    await knex.raw(`DROP INDEX IF EXISTS ${idx}`);
  }
}
