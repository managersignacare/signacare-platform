import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add digital_signature column to staff table (base64 PNG data URL)
  const hasCol = await knex.schema.hasColumn('staff', 'digital_signature');
  if (!hasCol) {
    await knex.schema.alterTable('staff', (t) => {
      t.text('digital_signature').nullable();
    });
  }

  // Add signature_data column to correspondence_letters for signed letters
  const hasLetterSig = await knex.schema.hasColumn('correspondence_letters', 'signature_data');
  if (!hasLetterSig) {
    await knex.schema.alterTable('correspondence_letters', (t) => {
      t.text('signature_data').nullable();
      t.uuid('signed_by_id').nullable();
      t.timestamp('signed_at', { useTz: true }).nullable();
    });
  }

  // Add signature fields to episodes for discharge summary signing
  const hasEpSig = await knex.schema.hasColumn('episodes', 'discharge_signature_data');
  if (!hasEpSig) {
    await knex.schema.alterTable('episodes', (t) => {
      t.text('discharge_signature_data').nullable();
      t.uuid('discharge_signed_by_id').nullable();
      t.timestamp('discharge_signed_at', { useTz: true }).nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('staff', (t) => { t.dropColumn('digital_signature'); });
  await knex.schema.alterTable('correspondence_letters', (t) => {
    t.dropColumn('signature_data'); t.dropColumn('signed_by_id'); t.dropColumn('signed_at');
  });
  await knex.schema.alterTable('episodes', (t) => {
    t.dropColumn('discharge_signature_data'); t.dropColumn('discharge_signed_by_id'); t.dropColumn('discharge_signed_at');
  });
}
