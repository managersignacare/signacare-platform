import { Knex } from 'knex';

/**
 * Phase R R4+ follow-up — the `patient_active_specialties` view was
 * referenced by `GET /api/v1/patients/:id/active-specialties` since
 * Phase 0 (multi-specialty expansion) but never made it into the
 * consolidated baseline. The route crashed on every patient-chart load
 * with `relation "patient_active_specialties" does not exist`.
 *
 * The view derives the distinct set of specialty codes a patient is
 * currently active in, from open episodes. Used by the frontend
 * ModuleContext + Sara's module tab visibility logic.
 */
export async function up(knex: Knex): Promise<void> {
  // Note: the episodes column is `specialty_code` (varchar(40)), NOT
  // `specialty` — the pre-R2 multi-specialty plan used a different
  // schema draft which never shipped.
  // @migration-raw-exempt: view_create
  await knex.raw(`
    CREATE OR REPLACE VIEW patient_active_specialties AS
    SELECT
      patient_id,
      clinic_id,
      array_agg(DISTINCT specialty_code) AS specialties
    FROM episodes
    WHERE status IN ('active', 'open', 'admitted')
      AND deleted_at IS NULL
    GROUP BY patient_id, clinic_id;
  `);
  // @migration-raw-exempt: grant
  await knex.raw(`GRANT SELECT ON patient_active_specialties TO app_user`);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: view_drop
  await knex.raw('DROP VIEW IF EXISTS patient_active_specialties');
}
