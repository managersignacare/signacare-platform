import { Knex } from 'knex';

/**
 * BUG-292 — extend AHPRA-compliant prescriber-discipline barrier
 * (BUG-040) to the `prescriptions` (eScript) table.
 *
 * Layer A (app): prescriptionService.create / runSafeScriptCheck /
 * submitErx / cancel call requirePrescribingDiscipline(auth) from
 * shared/authGuards.ts. HTTP 403 PRESCRIBER_DISCIPLINE_REQUIRED on
 * fail.
 *
 * Layer B (DB, this migration): BEFORE INSERT + BEFORE UPDATE OF
 * prescribed_by_staff_id triggers call the SSoT SQL function
 * is_prescribing_eligible_discipline(slug) from BUG-040's migration
 * (20260421000003_prescriber_discipline_barrier.ts). No duplication
 * of the allow-list — both tables share one function. The function
 * is schema-level and STABLE; reusing it is safe and the documented
 * design (CLAUDE.md §7.3.1 pinned by BUG-290).
 *
 * Trigger function name: prescriptions_prescriber_discipline_check()
 * — matches BUG-290's naming rule (`<table>_prescriber_discipline_check`).
 * Raises `'prescriber discipline "%" not authorised to prescribe
 * (BUG-040)'` — exact same message shape as BUG-040 so operators see
 * consistent errors across prescribing surfaces.
 *
 * Allow NULL prescribed_by_staff_id: the trigger short-circuits
 * when the column is unset (legacy / transient paths; app-layer is
 * authoritative for real attribution). Fires for ALL roles including
 * dbAdmin — defence against compromised owner-role or direct SQL.
 *
 * Standard: AHPRA registration rules; ACHS Standard 4; HIPAA
 * 164.312(a)(1); APP 11.1.
 */
export async function up(knex: Knex): Promise<void> {
  // Trigger function — mirrors patient_medications_prescriber_discipline_check
  // but scoped to the prescriptions table (separate function so a future
  // per-table customisation doesn't force editing the BUG-040 function).
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prescriptions_prescriber_discipline_check()
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
  await knex.raw('DROP TRIGGER IF EXISTS prescriptions_prescriber_insert ON prescriptions');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER prescriptions_prescriber_insert
      BEFORE INSERT ON prescriptions
      FOR EACH ROW EXECUTE FUNCTION prescriptions_prescriber_discipline_check()
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS prescriptions_prescriber_update ON prescriptions');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER prescriptions_prescriber_update
      BEFORE UPDATE OF prescribed_by_staff_id ON prescriptions
      FOR EACH ROW EXECUTE FUNCTION prescriptions_prescriber_discipline_check()
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Honest reversal. Do NOT drop is_prescribing_eligible_discipline —
  // BUG-040's migration owns that function.
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS prescriptions_prescriber_update ON prescriptions');
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS prescriptions_prescriber_insert ON prescriptions');
  // @migration-raw-exempt: function_drop
  await knex.raw('DROP FUNCTION IF EXISTS prescriptions_prescriber_discipline_check()');
}
