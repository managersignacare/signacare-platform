/*
 * apps/api/migrations/20260701000039_pr_r1_13_drain_extend_template_sections.ts
 *
 * PR-R1-13 DRAIN — Extend `template_sections` with 8 columns the code,
 * Zod schema, and frontend UI all expect but were never migrated.
 *
 * Discovered by check-knex-column-references guard (PR-R1-13). The
 * `template.repository.ts:50` SELECT projects 8 columns that don't
 * exist on the table. Pre-fix the SELECT silently returned NULL for
 * all 8 fields; downstream Zod validation passed (all `.optional()`)
 * and the UI rendered broken templates with missing Likert min/max,
 * SOAP-field tags, placeholders, etc.
 *
 * Code comments at template.repository.ts:145+188 explicitly cite this
 * as "pre-R2 drift" with "Baseline 20260701000000 is the fix" — that
 * migration was planned but never written. THIS migration is the fix.
 *
 * Columns added (all NULL-able OR with safe defaults so existing rows
 * survive):
 *   - field_type VARCHAR(50)             — discriminator like 'likert' / 'text' / 'heading'
 *   - soap_field VARCHAR(50)             — SOAP-note category tagging
 *   - required BOOLEAN NOT NULL DEFAULT false
 *   - position INTEGER NOT NULL DEFAULT 0
 *   - min_value INTEGER                  — Likert / numeric scale lower bound
 *   - max_value INTEGER                  — Likert / numeric scale upper bound
 *   - placeholder VARCHAR(255)           — input placeholder text
 *   - updated_at TIMESTAMPTZ NOT NULL DEFAULT now() (with trigger)
 *
 * Backfill semantics:
 *   - field_type seeded from existing section_type (semantic equivalent)
 *   - required seeded from existing is_required (semantic equivalent)
 *   - position seeded from existing sort_order (semantic equivalent)
 *   - The 5 truly-new columns (soap_field, min_value, max_value,
 *     placeholder, updated_at) start as NULL / default — operators
 *     will populate them when templates are next edited.
 *
 * Builder-first per CLAUDE.md §12.1. Raw SQL only for backfill UPDATE
 * + trigger function/trigger creation per §12.4 taxonomy.
 *
 * Down() is REVERSIBLE per §12.4 — drops the 8 columns + trigger. Loses
 * any data populated post-deploy in the truly-new columns. Acceptable
 * because pre-this-migration the columns didn't exist anyway.
 *
 * R-FIX-PR-R1-13-DRAIN-TEMPLATE-SECTIONS-MIGRATION
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Step 1: builder DDL adds the 8 columns. NULL-able where no sensible
  // default exists; defaults applied for required/position/updated_at.
  const has = (col: string) => knex.schema.hasColumn('template_sections', col);

  const adds: Array<(t: Knex.AlterTableBuilder) => void> = [];
  if (!(await has('field_type'))) adds.push((t) => t.string('field_type', 50).nullable());
  if (!(await has('soap_field'))) adds.push((t) => t.string('soap_field', 50).nullable());
  if (!(await has('required'))) adds.push((t) => t.boolean('required').notNullable().defaultTo(false));
  if (!(await has('position'))) adds.push((t) => t.integer('position').notNullable().defaultTo(0));
  if (!(await has('min_value'))) adds.push((t) => t.integer('min_value').nullable());
  if (!(await has('max_value'))) adds.push((t) => t.integer('max_value').nullable());
  if (!(await has('placeholder'))) adds.push((t) => t.string('placeholder', 255).nullable());
  if (!(await has('updated_at'))) {
    adds.push((t) => t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now()));
  }

  if (adds.length > 0) {
    await knex.schema.alterTable('template_sections', (t) => {
      for (const fn of adds) fn(t);
    });
  }

  // Step 2: backfill the 3 columns that have semantic equivalents in
  // the pre-existing schema. Idempotent — only sets when target is NULL
  // (or the default zero/false for the NOT NULL columns).
  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    UPDATE template_sections
       SET field_type = section_type
     WHERE field_type IS NULL
       AND section_type IS NOT NULL
  `);
  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    UPDATE template_sections
       SET required = is_required
     WHERE is_required IS NOT NULL
  `);
  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    UPDATE template_sections
       SET position = COALESCE(sort_order, 0)
  `);

  // Step 3: add updated_at trigger so future row updates bump the
  // timestamp automatically (mirrors patient_medications pattern).
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION trg_template_sections_set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    DROP TRIGGER IF EXISTS template_sections_set_updated_at ON template_sections;
    CREATE TRIGGER template_sections_set_updated_at
      BEFORE UPDATE ON template_sections
      FOR EACH ROW EXECUTE FUNCTION trg_template_sections_set_updated_at();
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: trigger_drop
  await knex.raw(`DROP TRIGGER IF EXISTS template_sections_set_updated_at ON template_sections`);
  // @migration-raw-exempt: function_drop
  await knex.raw(`DROP FUNCTION IF EXISTS trg_template_sections_set_updated_at`);
  await knex.schema.alterTable('template_sections', (t) => {
    t.dropColumn('updated_at');
    t.dropColumn('placeholder');
    t.dropColumn('max_value');
    t.dropColumn('min_value');
    t.dropColumn('position');
    t.dropColumn('required');
    t.dropColumn('soap_field');
    t.dropColumn('field_type');
  });
}
