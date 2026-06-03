import { Knex } from 'knex';

/**
 * BUG-SCHEMA-QUALITY follow-up:
 * 1) Add missing clinic/patient index coverage on high-traffic auth + AI tables.
 * 2) Tighten nullable clinic_id on tenant-bound tables where NULL has no
 *    legitimate business meaning.
 */

export async function up(knex: Knex): Promise<void> {
  // Index coverage — clinic-scoped lookups.
  await knex.schema.alterTable('phi_scrubber_rules', (t) => {
    t.index(['clinic_id'], 'idx_phi_scrubber_rules_clinic_id');
  });

  // Index coverage — patient-scoped lookups under tenant context.
  await knex.schema.alterTable('oauth_access_tokens', (t) => {
    t.index(['clinic_id', 'patient_id'], 'idx_oauth_access_tokens_clinic_patient_id');
  });
  await knex.schema.alterTable('oauth_authorization_codes', (t) => {
    t.index(['clinic_id', 'patient_id'], 'idx_oauth_authorization_codes_clinic_patient_id');
  });
  await knex.schema.alterTable('oauth_refresh_tokens', (t) => {
    t.index(['clinic_id', 'patient_id'], 'idx_oauth_refresh_tokens_clinic_patient_id');
  });
  await knex.schema.alterTable('smart_launch_contexts', (t) => {
    t.index(['clinic_id', 'patient_id'], 'idx_smart_launch_contexts_clinic_patient_id');
  });

  // Backfill attachment clinic_id from parent alert before NOT NULL tighten.
  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    UPDATE patient_alert_attachments paa
    SET clinic_id = pa.clinic_id
    FROM patient_alerts pa
    WHERE paa.patient_alert_id = pa.id
      AND paa.clinic_id IS NULL
  `);

  const thresholdNullCount = await knex('clinic_thresholds')
    .whereNull('clinic_id')
    .count<{ count: string }>('* as count')
    .first();
  if (Number(thresholdNullCount?.count ?? 0) > 0) {
    throw new Error(
      'Cannot enforce clinic_thresholds.clinic_id NOT NULL: NULL rows exist. Backfill required.',
    );
  }

  const attachmentNullCount = await knex('patient_alert_attachments')
    .whereNull('clinic_id')
    .count<{ count: string }>('* as count')
    .first();
  if (Number(attachmentNullCount?.count ?? 0) > 0) {
    throw new Error(
      'Cannot enforce patient_alert_attachments.clinic_id NOT NULL: NULL rows remain after backfill.',
    );
  }

  // FK shape must not attempt SET NULL once clinic_id becomes NOT NULL.
  await knex.schema.alterTable('patient_alert_attachments', (t) => {
    t.dropForeign('clinic_id', 'fk_patient_alert_attachments_clinic_id');
  });

  await knex.schema.alterTable('clinic_thresholds', (t) => {
    t.dropNullable('clinic_id');
  });
  await knex.schema.alterTable('patient_alert_attachments', (t) => {
    t.dropNullable('clinic_id');
  });

  await knex.schema.alterTable('patient_alert_attachments', (t) => {
    t
      .foreign('clinic_id', 'fk_patient_alert_attachments_clinic_id')
      .references('clinics.id')
      .onDelete('RESTRICT');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('patient_alert_attachments', (t) => {
    t.dropForeign('clinic_id', 'fk_patient_alert_attachments_clinic_id');
  });

  await knex.schema.alterTable('clinic_thresholds', (t) => {
    t.setNullable('clinic_id');
  });
  await knex.schema.alterTable('patient_alert_attachments', (t) => {
    t.setNullable('clinic_id');
  });

  await knex.schema.alterTable('patient_alert_attachments', (t) => {
    t
      .foreign('clinic_id', 'fk_patient_alert_attachments_clinic_id')
      .references('clinics.id')
      .onDelete('SET NULL');
  });

  await knex.schema.alterTable('smart_launch_contexts', (t) => {
    t.dropIndex(['clinic_id', 'patient_id'], 'idx_smart_launch_contexts_clinic_patient_id');
  });
  await knex.schema.alterTable('oauth_refresh_tokens', (t) => {
    t.dropIndex(['clinic_id', 'patient_id'], 'idx_oauth_refresh_tokens_clinic_patient_id');
  });
  await knex.schema.alterTable('oauth_authorization_codes', (t) => {
    t.dropIndex(['clinic_id', 'patient_id'], 'idx_oauth_authorization_codes_clinic_patient_id');
  });
  await knex.schema.alterTable('oauth_access_tokens', (t) => {
    t.dropIndex(['clinic_id', 'patient_id'], 'idx_oauth_access_tokens_clinic_patient_id');
  });
  await knex.schema.alterTable('phi_scrubber_rules', (t) => {
    t.dropIndex(['clinic_id'], 'idx_phi_scrubber_rules_clinic_id');
  });
}
