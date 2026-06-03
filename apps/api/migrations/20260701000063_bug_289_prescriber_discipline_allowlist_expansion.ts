import { Knex } from 'knex';

/**
 * BUG-289 — extend prescriber discipline allow-list for non-mental-health
 * prescribers.
 *
 * Context:
 *   BUG-040 introduced `is_prescribing_eligible_discipline(slug)` with a
 *   tightly-scoped allow-list (`psychiatry`, `general-practice`,
 *   `nurse-practitioner`). That was correct for the initial mental-health
 *   prescribing rollout, but now blocks valid specialist prescribers on
 *   non-mental-health workflows.
 *
 * Design:
 *   Keep DB function as SSoT (all app + trigger paths already call it) and
 *   expand eligibility to include currently supported non-mental-health
 *   medical disciplines:
 *     - internal-medicine
 *     - general-medicine
 *     - endocrinology
 *     - paediatrics
 *     - obstetrics-gynaecology
 *     - general-surgery
 *     - medical-oncology
 *
 *   Normalization hardening:
 *     The pre-existing function normalized only case/spacing. This migration
 *     upgrades normalization to a punctuation-tolerant canonical slug by:
 *       1) lower+trim
 *       2) collapse any non [a-z0-9] run to single '-'
 *       3) trim leading/trailing '-'
 *
 *   This keeps prior behavior intact while handling entries like
 *   "Obstetrics & Gynaecology" deterministically as
 *   "obstetrics-gynaecology".
 */
export async function up(knex: Knex): Promise<void> {
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION is_prescribing_eligible_discipline(slug TEXT)
      RETURNS BOOLEAN
      LANGUAGE sql
      STABLE
      AS $fn$
        WITH normalized AS (
          SELECT regexp_replace(
                   regexp_replace(lower(trim(coalesce(slug, ''))), '[^a-z0-9]+', '-', 'g'),
                   '(^-|-$)',
                   '',
                   'g'
                 ) AS v
        )
        SELECT v IN (
          'psychiatry',
          'general-practice',
          'nurse-practitioner',
          'internal-medicine',
          'general-medicine',
          'endocrinology',
          'paediatrics',
          'obstetrics-gynaecology',
          'general-surgery',
          'medical-oncology'
        )
        FROM normalized
      $fn$
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Restore BUG-040 + BUG-040-follow-up posture (3-discipline allow-list
  // with case/space normalization).
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION is_prescribing_eligible_discipline(slug TEXT)
      RETURNS BOOLEAN
      LANGUAGE sql
      STABLE
      AS $fn$
        SELECT regexp_replace(lower(trim(coalesce(slug, ''))), '\\s+', '-', 'g')
          IN ('psychiatry', 'general-practice', 'nurse-practitioner')
      $fn$
  `);
}
