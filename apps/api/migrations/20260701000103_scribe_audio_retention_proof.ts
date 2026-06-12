import type { Knex } from 'knex';

const CONSTRAINT = 'clinic_settings_scribe_audio_retention_proof_check';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinic_settings', (t) => {
    t.text('scribe_audio_retention_adr').nullable();
    t.text('scribe_audio_retention_clinical_review').nullable();
    t.uuid('scribe_audio_retention_approved_by_staff_id')
      .nullable()
      .references('id')
      .inTable('staff')
      .onDelete('RESTRICT');
    t.timestamp('scribe_audio_retention_approved_at', { useTz: true }).nullable();
  });

  await knex('clinic_settings')
    .whereNot({ scribe_audio_retention: 'immediate_delete' })
    .update({
      scribe_audio_retention: 'immediate_delete',
      scribe_audio_retention_adr: null,
      scribe_audio_retention_clinical_review: null,
      scribe_audio_retention_approved_by_staff_id: null,
      scribe_audio_retention_approved_at: null,
      updated_at: knex.fn.now(),
    });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinic_settings
      ADD CONSTRAINT ${CONSTRAINT}
      CHECK (
        scribe_audio_retention = 'immediate_delete'
        OR (
          scribe_audio_retention_adr IS NOT NULL
          AND length(trim(scribe_audio_retention_adr)) >= 6
          AND scribe_audio_retention_clinical_review IS NOT NULL
          AND length(trim(scribe_audio_retention_clinical_review)) >= 10
          AND scribe_audio_retention_approved_by_staff_id IS NOT NULL
          AND scribe_audio_retention_approved_at IS NOT NULL
        )
      );
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`ALTER TABLE clinic_settings DROP CONSTRAINT IF EXISTS ${CONSTRAINT};`);
  await knex.schema.alterTable('clinic_settings', (t) => {
    t.dropColumn('scribe_audio_retention_approved_at');
    t.dropColumn('scribe_audio_retention_approved_by_staff_id');
    t.dropColumn('scribe_audio_retention_clinical_review');
    t.dropColumn('scribe_audio_retention_adr');
  });
}
