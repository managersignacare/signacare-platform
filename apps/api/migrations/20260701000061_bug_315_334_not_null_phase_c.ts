import { Knex } from 'knex';

/**
 * BUG-315 + BUG-334 — A2-2 Phase C NOT NULL enforcement.
 *
 * Preconditions (fail-closed):
 * - clinical_notes.consent_id has zero NULL rows
 * - clinics.hpio has zero NULL rows
 *
 * Notes:
 * - FK validation for clinical_notes_consent_id_fk is enforced before
 *   NOT NULL to guarantee every non-null consent_id references an
 *   existing scribe_consents row.
 * - This migration intentionally throws when preconditions are not met;
 *   operators must complete backfill posture first.
 */

export async function up(knex: Knex): Promise<void> {
  const consentNulls = await knex('clinical_notes')
    .whereNull('deleted_at')
    .whereNull('consent_id')
    .count<{ count: string }>('* as count')
    .first();
  if (Number(consentNulls?.count ?? 0) > 0) {
    throw new Error(
      `Cannot enforce clinical_notes.consent_id NOT NULL: ${consentNulls?.count ?? '0'} NULL rows remain.`,
    );
  }

  const hpioNulls = await knex('clinics')
    .whereNull('hpio')
    .count<{ count: string }>('* as count')
    .first();
  if (Number(hpioNulls?.count ?? 0) > 0) {
    throw new Error(
      `Cannot enforce clinics.hpio NOT NULL: ${hpioNulls?.count ?? '0'} NULL rows remain.`,
    );
  }

  // Existing FK was introduced as NOT VALID in BUG-273 zero-downtime path.
  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinical_notes
    VALIDATE CONSTRAINT clinical_notes_consent_id_fk
  `);

  await knex.schema.alterTable('clinical_notes', (t) => {
    t.dropNullable('consent_id');
  });
  await knex.schema.alterTable('clinics', (t) => {
    t.dropNullable('hpio');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinical_notes', (t) => {
    t.setNullable('consent_id');
  });
  await knex.schema.alterTable('clinics', (t) => {
    t.setNullable('hpio');
  });
}
