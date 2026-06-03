import { Knex } from 'knex';

/**
 * BUG-040 follow-up — normalize staff.discipline before checking
 * prescribing eligibility.
 *
 * Why:
 *   The original is_prescribing_eligible_discipline(slug) function
 *   compared exact literals (`'psychiatry'`, `'general-practice'`,
 *   `'nurse-practitioner'`). Real data contains common variants like
 *   `Psychiatry` and `General Practice`, which caused false-negative
 *   403s and DB-trigger rejections despite clinically valid roles.
 *
 * Design:
 *   Normalize to a canonical slug at the DB SSoT boundary:
 *     - trim
 *     - lower-case
 *     - collapse whitespace to hyphen
 *
 * This preserves strict allow-listing while removing fragile
 * case/spacing coupling between staff profile data and safety gates.
 */
export async function up(knex: Knex): Promise<void> {
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

export async function down(knex: Knex): Promise<void> {
  // Restore pre-fix exact-match behavior.
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION is_prescribing_eligible_discipline(slug TEXT)
      RETURNS BOOLEAN
      LANGUAGE sql
      STABLE
      AS $fn$
        SELECT slug IN ('psychiatry', 'general-practice', 'nurse-practitioner')
      $fn$
  `);
}

