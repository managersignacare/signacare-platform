import { Knex } from 'knex';

/**
 * Audit Tier 5.3 — AI Chat classifier mode + audio retention.
 *
 * User direction (2026-04-19): BOTH classifier modes must be
 * supported — regex/keyword (fast, deterministic) and local_llm
 * (higher accuracy, slower). The mode is selected in Power Settings.
 *
 * Adds TWO columns to the existing `clinic_settings` table from
 * Tier 4.3:
 *   - ai_chat_classifier_mode  text  ('regex_keyword' | 'local_llm')
 *       DEFAULT 'regex_keyword' — fast path is the safe default.
 *   - scribe_audio_retention   text  enum ('immediate_delete',
 *       '24h', '7d', '30d', '90d') DEFAULT 'immediate_delete'
 *       (Tier 5.13).
 *
 * Both columns get CHECK constraints so clients can't persist invalid
 * enum values. Existing rows pick up the DEFAULT automatically (no
 * backfill needed).
 *
 * Reversible: down() drops both columns and their CHECK constraints.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinic_settings', (t) => {
    t.text('ai_chat_classifier_mode').notNullable().defaultTo('regex_keyword');
    t.text('scribe_audio_retention').notNullable().defaultTo('immediate_delete');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinic_settings
      ADD CONSTRAINT clinic_settings_ai_chat_classifier_mode_check
      CHECK (ai_chat_classifier_mode IN ('regex_keyword', 'local_llm'));
    ALTER TABLE clinic_settings
      ADD CONSTRAINT clinic_settings_scribe_audio_retention_check
      CHECK (scribe_audio_retention IN ('immediate_delete', '24h', '7d', '30d', '90d'));
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`
    ALTER TABLE clinic_settings DROP CONSTRAINT IF EXISTS clinic_settings_scribe_audio_retention_check;
    ALTER TABLE clinic_settings DROP CONSTRAINT IF EXISTS clinic_settings_ai_chat_classifier_mode_check;
  `);
  await knex.schema.alterTable('clinic_settings', (t) => {
    t.dropColumn('scribe_audio_retention');
    t.dropColumn('ai_chat_classifier_mode');
  });
}
