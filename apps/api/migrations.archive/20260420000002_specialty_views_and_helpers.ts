/**
 * Multi-specialty expansion, Phase 0 — derived views and ABAC helpers.
 *
 * Adds:
 *
 *   - view `patient_active_specialties`
 *       Aggregates the distinct specialty codes across a patient's open
 *       episodes. Used by the frontend ModuleContext to intersect with
 *       clinic.enabled_specialties and staff.specialties when deciding
 *       which module tabs to render on the chart. The view has no cost
 *       to maintain (derived at query time) and zero drift risk.
 *
 *   - function `staff_can_see_specialty(staff_uuid, specialty_code)`
 *       Returns true if the staff member is enrolled in that specialty
 *       AND the clinic has it enabled. Usable from `CREATE POLICY` clauses
 *       in downstream specialty-private tables as a defence-in-depth
 *       gate on top of the existing tenant RLS.
 *
 * Neither object stores data; dropping and re-creating is safe.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── patient_active_specialties view ──
  await knex.raw(`DROP VIEW IF EXISTS patient_active_specialties`);
  await knex.raw(`
    CREATE VIEW patient_active_specialties AS
    SELECT
      e.patient_id,
      e.clinic_id,
      array_agg(DISTINCT e.specialty_code ORDER BY e.specialty_code) AS specialties
    FROM episodes e
    WHERE e.status IN ('open', 'active', 'admitted')
      AND e.deleted_at IS NULL
    GROUP BY e.patient_id, e.clinic_id
  `);

  // ── staff_can_see_specialty helper ──
  // Marked STABLE (not VOLATILE) so Postgres can memoise it within a query.
  // SECURITY INVOKER so it runs with the caller's permissions — it doesn't
  // need to bypass RLS.
  await knex.raw(`DROP FUNCTION IF EXISTS staff_can_see_specialty(uuid, text)`);
  await knex.raw(`
    CREATE FUNCTION staff_can_see_specialty(p_staff_id uuid, p_specialty_code text)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    AS $$
      SELECT EXISTS (
        SELECT 1
        FROM staff_specialties ss
        JOIN clinic_enabled_specialties ces
          ON ces.clinic_id = ss.clinic_id
         AND ces.specialty_code = ss.specialty_code
        WHERE ss.staff_id = p_staff_id
          AND ss.specialty_code = p_specialty_code
          AND ss.deleted_at IS NULL
      );
    $$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP FUNCTION IF EXISTS staff_can_see_specialty(uuid, text)`);
  await knex.raw(`DROP VIEW IF EXISTS patient_active_specialties`);
}
