/**
 * Multi-specialty Phase 5 (revision) — link patient_attachments to an
 * episode and tag it with a specialty.
 *
 * Adds two nullable columns to patient_attachments so every uploaded
 * document can be filtered by specialty on the patient detail Documents
 * tab:
 *
 *   - episode_id      uuid NULL → episodes.id ON DELETE SET NULL
 *   - specialty_code  varchar(40) NULL → specialties.code ON UPDATE CASCADE
 *
 * Both are nullable because the legacy rows that predate this migration
 * have no episode linkage and we don't want to break uploads on
 * clinics with zero open episodes. New uploads can pass episodeId and
 * the route auto-resolves specialty_code from the linked episode.
 *
 * CLAUDE.md §7.1 index checklist: patient_id + clinic_id indexes
 * already exist from 20260322000004; this migration adds the two
 * composite indexes the Documents specialty filter needs.
 *
 * RLS is already enabled on patient_attachments (rls_patient_attachments_
 * tenant). Adding columns leaves the policy untouched.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('patient_attachments');
  if (!hasTable) return;

  const hasEpisode = await knex.schema.hasColumn('patient_attachments', 'episode_id');
  const hasSpecialty = await knex.schema.hasColumn('patient_attachments', 'specialty_code');

  if (!hasEpisode || !hasSpecialty) {
    await knex.schema.alterTable('patient_attachments', (t) => {
      if (!hasEpisode) {
        t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      }
      if (!hasSpecialty) {
        t.string('specialty_code', 40).nullable();
      }
    });
  }

  if (!hasSpecialty) {
    // Separate raw FK to match the ON UPDATE CASCADE used elsewhere for
    // specialty_code references. Knex's schema builder doesn't surface
    // onUpdate, so raw SQL is the cleanest way.
    await knex.raw(`
      ALTER TABLE patient_attachments
        ADD CONSTRAINT patient_attachments_specialty_code_fkey
        FOREIGN KEY (specialty_code) REFERENCES specialties (code)
        ON UPDATE CASCADE ON DELETE RESTRICT
    `);
  }

  // Composite indexes for the two hot paths: "list this patient's
  // attachments filtered by specialty" and "which attachments belong
  // to this episode".
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_patient_attachments_patient_specialty
      ON patient_attachments (patient_id, specialty_code)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_patient_attachments_episode
      ON patient_attachments (episode_id)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS idx_patient_attachments_patient_specialty`);
  await knex.raw(`DROP INDEX IF EXISTS idx_patient_attachments_episode`);
  await knex.raw(`ALTER TABLE patient_attachments DROP CONSTRAINT IF EXISTS patient_attachments_specialty_code_fkey`);
  const hasTable = await knex.schema.hasTable('patient_attachments');
  if (!hasTable) return;
  await knex.schema.alterTable('patient_attachments', (t) => {
    t.dropColumn('specialty_code');
    t.dropColumn('episode_id');
  });
}
