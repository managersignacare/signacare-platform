import { Knex } from 'knex';

/**
 * BUG-293 — extend AHPRA-compliant prescriber-discipline barrier
 * (BUG-040 → BUG-292) to the clozapine tables.
 *
 * Clozapine is the highest-safety-risk psychotropic in Signacare's
 * prescribing surface (agranulocytosis / FBC weekly monitoring for
 * the first 18 weeks). A non-prescribing discipline attributed as
 * the clozapine prescriber is a worse failure than BUG-040 because
 * the drug risk profile is worse; the barrier must be at LEAST as
 * strict as patient_medications.
 *
 * Two clozapine tables carry prescriber attribution:
 *
 *   - clozapine_titration_days.prescribed_by_staff_id (canonical,
 *     matches BUG-040 column name) — set when a specific titration
 *     day's mg is entered.
 *   - clozapine_registrations.prescriber_staff_id (clozapine-
 *     specific column name, nullable) — set when a patient is
 *     enrolled on clozapine. Registration IS the prescribing-
 *     initiation moment, so this column is semantically equivalent
 *     to prescribed_by_staff_id and gets the same barrier.
 *
 * Layer A (app, already landed in this commit): clozapineService
 * .createRegistration / .updateRegistration / .upsertTitrationDay
 * call requirePrescribingDiscipline(auth). HTTP 403
 * PRESCRIBING_DISCIPLINE_REQUIRED on fail.
 *
 * Layer B (DB, this migration): BEFORE INSERT + BEFORE UPDATE OF
 * <prescriber-column> triggers call the SSoT SQL function
 * is_prescribing_eligible_discipline(slug) from BUG-040's migration
 * (20260421000003_prescriber_discipline_barrier.ts). Per CLAUDE.md
 * §7.3.1 (BUG-290), every new table with a prescriber column MUST
 * attach a discipline-check trigger.
 *
 * One function per table — keeps future per-table customisation
 * decoupled (e.g. clozapine-specific risk assertions could be added
 * to the clozapine function without touching the prescriptions
 * function). Both raise the canonical message
 * 'prescriber discipline "%" not authorised to prescribe (BUG-040)'
 * so operators see consistent errors across all prescribing
 * surfaces (CLAUDE.md §7.3.1 contract).
 *
 * Both triggers short-circuit when the prescriber column is NULL —
 * legacy / transient paths are permitted; app-layer is authoritative
 * for real attribution. Triggers fire for ALL roles including
 * dbAdmin (no SECURITY DEFINER) — defence against compromised
 * owner-role or direct SQL.
 *
 * Standard: AHPRA registration rules; ACHS Standard 4; HIPAA
 * 164.312(a)(1); APP 11.1. Clozapine-specific: Australian Clozapine
 * Patient Monitoring System (CPMS) equivalent rules.
 */
export async function up(knex: Knex): Promise<void> {
  // ── clozapine_titration_days trigger function ─────────────────────────────
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION clozapine_titration_days_prescriber_discipline_check()
      RETURNS TRIGGER AS $fn$
      DECLARE
        v_discipline TEXT;
      BEGIN
        IF NEW.prescribed_by_staff_id IS NULL THEN
          RETURN NEW;
        END IF;

        SELECT discipline INTO v_discipline
          FROM staff
          WHERE id = NEW.prescribed_by_staff_id;

        IF v_discipline IS NULL THEN
          RAISE EXCEPTION 'prescriber staff.discipline is NULL or unset — not authorised to prescribe (BUG-040)';
        END IF;

        IF NOT is_prescribing_eligible_discipline(v_discipline) THEN
          RAISE EXCEPTION 'prescriber discipline "%" not authorised to prescribe (BUG-040)', v_discipline;
        END IF;

        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS clozapine_titration_days_prescriber_insert ON clozapine_titration_days');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER clozapine_titration_days_prescriber_insert
      BEFORE INSERT ON clozapine_titration_days
      FOR EACH ROW EXECUTE FUNCTION clozapine_titration_days_prescriber_discipline_check()
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS clozapine_titration_days_prescriber_update ON clozapine_titration_days');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER clozapine_titration_days_prescriber_update
      BEFORE UPDATE OF prescribed_by_staff_id ON clozapine_titration_days
      FOR EACH ROW EXECUTE FUNCTION clozapine_titration_days_prescriber_discipline_check()
  `);

  // ── clozapine_registrations trigger function ──────────────────────────────
  // Column name divergence: clozapine_registrations uses
  // `prescriber_staff_id` (pre-BUG-040 convention). Same semantics as
  // prescribed_by_staff_id — enforce identically.
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION clozapine_registrations_prescriber_discipline_check()
      RETURNS TRIGGER AS $fn$
      DECLARE
        v_discipline TEXT;
      BEGIN
        IF NEW.prescriber_staff_id IS NULL THEN
          RETURN NEW;
        END IF;

        SELECT discipline INTO v_discipline
          FROM staff
          WHERE id = NEW.prescriber_staff_id;

        IF v_discipline IS NULL THEN
          RAISE EXCEPTION 'prescriber staff.discipline is NULL or unset — not authorised to prescribe (BUG-040)';
        END IF;

        IF NOT is_prescribing_eligible_discipline(v_discipline) THEN
          RAISE EXCEPTION 'prescriber discipline "%" not authorised to prescribe (BUG-040)', v_discipline;
        END IF;

        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS clozapine_registrations_prescriber_insert ON clozapine_registrations');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER clozapine_registrations_prescriber_insert
      BEFORE INSERT ON clozapine_registrations
      FOR EACH ROW EXECUTE FUNCTION clozapine_registrations_prescriber_discipline_check()
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS clozapine_registrations_prescriber_update ON clozapine_registrations');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER clozapine_registrations_prescriber_update
      BEFORE UPDATE OF prescriber_staff_id ON clozapine_registrations
      FOR EACH ROW EXECUTE FUNCTION clozapine_registrations_prescriber_discipline_check()
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Honest reversal. Do NOT drop is_prescribing_eligible_discipline —
  // BUG-040's migration owns that function.
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS clozapine_registrations_prescriber_update ON clozapine_registrations');
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS clozapine_registrations_prescriber_insert ON clozapine_registrations');
  // @migration-raw-exempt: function_drop
  await knex.raw('DROP FUNCTION IF EXISTS clozapine_registrations_prescriber_discipline_check()');

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS clozapine_titration_days_prescriber_update ON clozapine_titration_days');
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS clozapine_titration_days_prescriber_insert ON clozapine_titration_days');
  // @migration-raw-exempt: function_drop
  await knex.raw('DROP FUNCTION IF EXISTS clozapine_titration_days_prescriber_discipline_check()');
}
