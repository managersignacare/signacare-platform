/**
 * Multi-specialty expansion, Phase 0 — medication specialty tagging.
 *
 * Generalises `patient_medications` so it works for every specialty, not
 * just mental health. Adds:
 *
 *   - prescribed_by_specialty_code   — the specialty the prescriber was
 *                                      acting in when this order was created.
 *                                      FK to specialties.code.
 *   - category                       — extensible drug category
 *                                      (insulin, cancer_related, anticoagulant,
 *                                      antipsychotic_lai, clozapine, …).
 *                                      New code should read this field;
 *                                      the legacy is_lai / is_clozapine
 *                                      flags stay as convenience.
 *
 * The unified medications page and cross-specialty interaction checks
 * (Phase 9) rely on these columns to tag every active medication with
 * its prescriber specialty and to run interaction checks across the
 * entire list regardless of the viewing clinician's specialty.
 *
 * `episode_id` already exists on `patient_medications` so we don't add
 * a separate `prescribed_in_episode_id` — queries join via `episode_id`
 * and inherit the episode's own `specialty_code`.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasSpecialtyCode = await knex.schema.hasColumn('patient_medications', 'prescribed_by_specialty_code');
  const hasCategory = await knex.schema.hasColumn('patient_medications', 'category');
  const hasIsLai = await knex.schema.hasColumn('patient_medications', 'is_lai');
  const hasIsClozapine = await knex.schema.hasColumn('patient_medications', 'is_clozapine');
  const hasEpisodeId = await knex.schema.hasColumn('patient_medications', 'episode_id');

  if (!hasSpecialtyCode || !hasCategory) {
    await knex.schema.alterTable('patient_medications', (t) => {
      if (!hasSpecialtyCode) {
        t.string('prescribed_by_specialty_code', 40).nullable();
      }
      if (!hasCategory) {
        t.string('category', 60).nullable();
      }
    });
  }

  if (!hasSpecialtyCode) {
    // FK — nullable because legacy rows have no prescriber specialty; new
    // rows must set it.
    await knex.raw(`
      ALTER TABLE patient_medications
        ADD CONSTRAINT patient_medications_prescribed_by_specialty_fkey
        FOREIGN KEY (prescribed_by_specialty_code) REFERENCES specialties (code)
        ON UPDATE CASCADE ON DELETE SET NULL
    `);

    // Backfill: LAI and clozapine rows belong to mental health. Guarded
    // on column existence because v2_baseline didn't include is_clozapine
    // (added by a later mental-health migration that may or may not have
    // landed before this one depending on the environment).
    if (hasIsLai || hasIsClozapine) {
      await knex('patient_medications')
        .whereNull('prescribed_by_specialty_code')
        .andWhere((q) => {
          if (hasIsLai) q.orWhere('is_lai', true);
          if (hasIsClozapine) q.orWhere('is_clozapine', true);
        })
        .update({ prescribed_by_specialty_code: 'mental_health' });
    }

    // Backfill: any row whose episode has a specialty inherits it.
    // Skipped when episode_id isn't on the table yet (the column is
    // added by a later Phase 3 migration on some deploy paths).
    if (hasEpisodeId) {
      await knex.raw(`
        UPDATE patient_medications pm
        SET prescribed_by_specialty_code = e.specialty_code
        FROM episodes e
        WHERE pm.episode_id = e.id
          AND pm.prescribed_by_specialty_code IS NULL
          AND e.specialty_code IS NOT NULL
      `);
    }

    // Index for the cross-specialty medication list filter chips.
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS patient_medications_specialty_idx
        ON patient_medications (clinic_id, prescribed_by_specialty_code)
        WHERE deleted_at IS NULL`
    );
  }

  if (!hasCategory) {
    // Backfill category from legacy flags for parity — guarded.
    if (hasIsLai) {
      await knex('patient_medications').where({ is_lai: true }).whereNull('category').update({ category: 'antipsychotic_lai' });
    }
    if (hasIsClozapine) {
      await knex('patient_medications').where({ is_clozapine: true }).whereNull('category').update({ category: 'clozapine' });
    }

    await knex.raw(
      `CREATE INDEX IF NOT EXISTS patient_medications_category_idx
        ON patient_medications (clinic_id, category)
        WHERE deleted_at IS NULL`
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS patient_medications_category_idx`);
  await knex.raw(`DROP INDEX IF EXISTS patient_medications_specialty_idx`);
  await knex.raw(`ALTER TABLE patient_medications DROP CONSTRAINT IF EXISTS patient_medications_prescribed_by_specialty_fkey`);

  const hasCategory = await knex.schema.hasColumn('patient_medications', 'category');
  const hasSpecialtyCode = await knex.schema.hasColumn('patient_medications', 'prescribed_by_specialty_code');
  await knex.schema.alterTable('patient_medications', (t) => {
    if (hasCategory) t.dropColumn('category');
    if (hasSpecialtyCode) t.dropColumn('prescribed_by_specialty_code');
  });
}
