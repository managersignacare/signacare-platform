import type { Knex } from 'knex';

/**
 * BUG-A5.3 + BUG-N4
 *
 * A5.3 foundation:
 * - patient_ihis append-only history table for IHI verification/search outcomes.
 * - patients-level status snapshot columns for fast prescribe-time gating.
 *
 * N4 foundation:
 * - hi_error_log table for deterministic HI Service failure forensics.
 */

const IHI_RECORD_STATUSES = ['verified', 'unverified', 'provisional'] as const;
const IHI_NUMBER_STATUSES = ['active', 'deceased', 'retired', 'expired', 'resolved'] as const;
const IHI_SOURCES = ['hi_search', 'hi_verify', 'manual', 'fhir_ingest'] as const;

export async function up(knex: Knex): Promise<void> {
  const hasPatientIhis = await knex.schema.hasTable('patient_ihis');
  if (!hasPatientIhis) {
    await knex.schema.createTable('patient_ihis', (t) => {
      t.uuid('id').primary();
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.text('ihi_value').notNullable();
      t.text('ihi_lookup').notNullable();
      t.text('record_status').notNullable();
      t.text('number_status').notNullable();
      t.text('source').notNullable();
      t.timestamp('hi_verified_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.text('hi_display_name_original');
      t.text('hi_display_name_40');
      t.boolean('hi_name_was_truncated').notNullable().defaultTo(false);
      t.uuid('created_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
      t.index(['clinic_id'], 'idx_patient_ihis_clinic_id');
      t.index(['patient_id'], 'idx_patient_ihis_patient_id');
      t.index(['created_by_staff_id'], 'idx_patient_ihis_created_by_staff_id');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.schema.alterTable('patient_ihis', (t) => {
      t.index(['clinic_id', 'patient_id', 'created_at'], 'idx_patient_ihis_patient_latest');
      t.index(['clinic_id', 'ihi_lookup', 'created_at'], 'idx_patient_ihis_lookup_latest');
    });

    // @migration-raw-exempt: check_constraint
    await knex.raw(`
      ALTER TABLE patient_ihis
      ADD CONSTRAINT patient_ihis_record_status_check
      CHECK (record_status IN (${IHI_RECORD_STATUSES.map((s) => `'${s}'`).join(', ')}))
    `);
    // @migration-raw-exempt: check_constraint
    await knex.raw(`
      ALTER TABLE patient_ihis
      ADD CONSTRAINT patient_ihis_number_status_check
      CHECK (number_status IN (${IHI_NUMBER_STATUSES.map((s) => `'${s}'`).join(', ')}))
    `);
    // @migration-raw-exempt: check_constraint
    await knex.raw(`
      ALTER TABLE patient_ihis
      ADD CONSTRAINT patient_ihis_source_check
      CHECK (source IN (${IHI_SOURCES.map((s) => `'${s}'`).join(', ')}))
    `);
    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE patient_ihis ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_patient_ihis_tenant ON patient_ihis
        FOR ALL
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
        WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    `);
  }

  const hasPatientsIhiRecordStatus = await knex.schema.hasColumn('patients', 'ihi_record_status');
  if (!hasPatientsIhiRecordStatus) {
    await knex.schema.alterTable('patients', (t) => {
      t.text('ihi_record_status');
    });
    // @migration-raw-exempt: check_constraint
    await knex.raw(`
      ALTER TABLE patients
      ADD CONSTRAINT patients_ihi_record_status_check
      CHECK (
        ihi_record_status IS NULL
        OR ihi_record_status IN (${IHI_RECORD_STATUSES.map((s) => `'${s}'`).join(', ')})
      )
    `);
  }

  const hasPatientsIhiNumberStatus = await knex.schema.hasColumn('patients', 'ihi_number_status');
  if (!hasPatientsIhiNumberStatus) {
    await knex.schema.alterTable('patients', (t) => {
      t.text('ihi_number_status');
    });
    // @migration-raw-exempt: check_constraint
    await knex.raw(`
      ALTER TABLE patients
      ADD CONSTRAINT patients_ihi_number_status_check
      CHECK (
        ihi_number_status IS NULL
        OR ihi_number_status IN (${IHI_NUMBER_STATUSES.map((s) => `'${s}'`).join(', ')})
      )
    `);
  }

  const hasPatientsIhiVerifiedAt = await knex.schema.hasColumn('patients', 'ihi_verified_at');
  if (!hasPatientsIhiVerifiedAt) {
    await knex.schema.alterTable('patients', (t) => {
      t.timestamp('ihi_verified_at', { useTz: true });
    });
  }

  const hasHiErrorLog = await knex.schema.hasTable('hi_error_log');
  if (!hasHiErrorLog) {
    await knex.schema.createTable('hi_error_log', (t) => {
      t.uuid('id').primary();
      t.uuid('clinic_id').references('id').inTable('clinics').onDelete('SET NULL');
      t.uuid('patient_id').references('id').inTable('patients').onDelete('SET NULL');
      t.text('operation').notNullable();
      t.integer('status_code');
      t.text('error_code');
      t.text('error_message').notNullable();
      t.text('request_ref');
      t.jsonb('context');
      t.uuid('created_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
      t.index(['clinic_id'], 'idx_hi_error_log_clinic_id');
      t.index(['patient_id'], 'idx_hi_error_log_patient_id');
      t.index(['created_by_staff_id'], 'idx_hi_error_log_created_by_staff_id');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    await knex.schema.alterTable('hi_error_log', (t) => {
      t.index(['clinic_id', 'created_at'], 'idx_hi_error_log_clinic_created');
      t.index(['operation', 'created_at'], 'idx_hi_error_log_operation_created');
    });
    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE hi_error_log ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_hi_error_log_tenant ON hi_error_log
        FOR ALL
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
        WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasHiErrorLog = await knex.schema.hasTable('hi_error_log');
  if (hasHiErrorLog) {
    // @migration-raw-exempt: drop_policy_if_exists
    await knex.raw('DROP POLICY IF EXISTS rls_hi_error_log_tenant ON hi_error_log');
    await knex.schema.dropTableIfExists('hi_error_log');
  }

  const hasPatientsIhiVerifiedAt = await knex.schema.hasColumn('patients', 'ihi_verified_at');
  if (hasPatientsIhiVerifiedAt) {
    await knex.schema.alterTable('patients', (t) => {
      t.dropColumn('ihi_verified_at');
    });
  }

  const hasPatientsIhiNumberStatus = await knex.schema.hasColumn('patients', 'ihi_number_status');
  if (hasPatientsIhiNumberStatus) {
    // @migration-raw-exempt: check_constraint
    await knex.raw('ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_ihi_number_status_check');
    await knex.schema.alterTable('patients', (t) => {
      t.dropColumn('ihi_number_status');
    });
  }

  const hasPatientsIhiRecordStatus = await knex.schema.hasColumn('patients', 'ihi_record_status');
  if (hasPatientsIhiRecordStatus) {
    // @migration-raw-exempt: check_constraint
    await knex.raw('ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_ihi_record_status_check');
    await knex.schema.alterTable('patients', (t) => {
      t.dropColumn('ihi_record_status');
    });
  }

  const hasPatientIhis = await knex.schema.hasTable('patient_ihis');
  if (hasPatientIhis) {
    // @migration-raw-exempt: drop_policy_if_exists
    await knex.raw('DROP POLICY IF EXISTS rls_patient_ihis_tenant ON patient_ihis');
    await knex.schema.dropTableIfExists('patient_ihis');
  }
}
