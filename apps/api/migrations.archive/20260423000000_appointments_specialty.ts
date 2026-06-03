/**
 * Multi-specialty Phase 4 prep — appointments.specialty_code.
 *
 * Tags every appointment with its target clinical specialty so the
 * appointments page can filter by specialty and so future cross-
 * specialty reporting (e.g. "all oncology consults this month") is
 * a single index-backed query.
 *
 * The column is nullable + defaults to mental_health for backwards
 * compatibility with the existing MH workflow. The appointment
 * service auto-resolves the value using the same priority chain as
 * prescriberSpecialtyResolver:
 *   1. Explicit DTO field (cross-specialty liaison override).
 *   2. The linked episode's specialty_code.
 *   3. The clinician's primary staff_specialties enrolment.
 *   4. mental_health fallback.
 *
 * FK to specialties.code; ON DELETE RESTRICT (a specialty cannot be
 * deleted while appointments still reference it).
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('appointments', 'specialty_code');
  if (has) return;

  await knex.schema.alterTable('appointments', (t) => {
    t.string('specialty_code', 40).nullable();
  });

  // Backfill existing rows to mental_health so legacy data is routable.
  await knex('appointments').whereNull('specialty_code').update({ specialty_code: 'mental_health' });

  // @migration-raw-exempt: legacy ALTER COLUMN SET NOT NULL; builder-equivalent pending R2 consolidation
  await knex.raw(`ALTER TABLE appointments ALTER COLUMN specialty_code SET NOT NULL`);
  // @migration-raw-exempt: legacy ALTER COLUMN SET DEFAULT; builder-equivalent pending R2 consolidation
  await knex.raw(`ALTER TABLE appointments ALTER COLUMN specialty_code SET DEFAULT 'mental_health'`);
  await knex.raw(`
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_specialty_code_fkey
      FOREIGN KEY (specialty_code) REFERENCES specialties (code)
      ON UPDATE CASCADE ON DELETE RESTRICT
  `);

  // Composite index for the appointments-by-specialty filter on the page.
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS appointments_specialty_idx
      ON appointments (clinic_id, specialty_code, appointment_start)
      WHERE deleted_at IS NULL`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS appointments_specialty_idx`);
  await knex.raw(`ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_specialty_code_fkey`);
  const has = await knex.schema.hasColumn('appointments', 'specialty_code');
  if (has) {
    await knex.schema.alterTable('appointments', (t) => {
      t.dropColumn('specialty_code');
    });
  }
}
