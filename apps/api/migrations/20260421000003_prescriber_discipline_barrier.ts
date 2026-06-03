// apps/api/migrations/20260421000003_prescriber_discipline_barrier.ts
//
// BUG-040 — AHPRA-compliant prescriber discipline barrier on
// patient_medications (two-layer defence).
//
// Layer A (app): authGuards.requirePrescribingDiscipline checks the
// caller's staff.discipline against the allow-list function BEFORE the
// medicationService persists a prescription. Fails fast with HTTP 403.
//
// Layer B (DB, this migration):
//   - is_prescribing_eligible_discipline(slug text) — STABLE SQL function
//     that is the SINGLE source of truth for the prescriber allow-list.
//     Both the trigger and the app-layer helper call it, so the list
//     cannot drift (L5 review blocker from BUG-039 called this out).
//   - patient_medications_prescriber_discipline_check() — PL/pgSQL
//     trigger function that looks up staff.discipline via
//     NEW.prescribed_by_staff_id and raises if ineligible.
//   - BEFORE INSERT + BEFORE UPDATE OF prescribed_by_staff_id triggers
//     — fires only when the prescriber column is (re)set. Allow NULL
//     (legacy / import / transient). Fires for ALL roles including
//     dbAdmin — a direct SQL bypass or a future buggy DDL tool is
//     still blocked at the engine.
//
// Allow-list rationale (AHPRA / Psychology Board of Australia):
//   psychiatry         — medical specialists, full prescribing
//   general-practice   — GPs prescribe routinely
//   nurse-practitioner — PBS-authorised NP endorsement
// Everything else blocked — including psychology (all variants),
// RN / EN, social work, pharmacy (dispense/review only), allied health.
//
// Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS so a
// partial prior run doesn't wedge. Honest down() drops both triggers,
// the trigger function, and the allow-list function. CAB approval
// required for any prod rollback (plan §10).
//
// Standard: AHPRA / Psychology Board of Australia registration rules;
// ACHS Standard 4 (medication safety); HIPAA 164.312(a)(1) access
// control; APP 11.1 security (integrity + accountability).

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // SSoT allow-list function. STABLE means same input → same output in
  // the same transaction (no clinic-specific logic), so Postgres can
  // short-circuit repeated calls.
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

  // Trigger function — looks up staff.discipline, calls allow-list.
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION patient_medications_prescriber_discipline_check()
      RETURNS TRIGGER AS $fn$
      DECLARE
        v_discipline TEXT;
      BEGIN
        -- NULL prescribed_by_staff_id is allowed (legacy / transient
        -- paths; app-layer covers real attribution).
        IF NEW.prescribed_by_staff_id IS NULL THEN
          RETURN NEW;
        END IF;

        SELECT discipline INTO v_discipline
          FROM staff
          WHERE id = NEW.prescribed_by_staff_id;

        -- Staff row missing is an FK problem, not our concern; let the
        -- FK constraint surface that error. Null discipline on an
        -- existing staff row means "not set" — fail-closed (treat as
        -- ineligible) because a prescription with an unknown-discipline
        -- prescriber is worse than a rejected write.
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

  // BEFORE INSERT trigger.
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS patient_medications_prescriber_insert ON patient_medications');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER patient_medications_prescriber_insert
      BEFORE INSERT ON patient_medications
      FOR EACH ROW EXECUTE FUNCTION patient_medications_prescriber_discipline_check()
  `);

  // BEFORE UPDATE trigger — scoped to the prescriber column so an
  // unrelated status/dose edit doesn't pay the lookup cost.
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS patient_medications_prescriber_update ON patient_medications');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER patient_medications_prescriber_update
      BEFORE UPDATE OF prescribed_by_staff_id ON patient_medications
      FOR EACH ROW EXECUTE FUNCTION patient_medications_prescriber_discipline_check()
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Honest reversal per CLAUDE.md §12. Prod rollback requires CAB
  // approval (plan §10); forward-fix preferred.
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS patient_medications_prescriber_update ON patient_medications');
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS patient_medications_prescriber_insert ON patient_medications');
  // @migration-raw-exempt: function_drop
  await knex.raw('DROP FUNCTION IF EXISTS patient_medications_prescriber_discipline_check()');
  // @migration-raw-exempt: function_drop
  await knex.raw('DROP FUNCTION IF EXISTS is_prescribing_eligible_discipline(TEXT)');
}
