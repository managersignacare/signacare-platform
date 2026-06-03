/**
 * Multi-specialty expansion, Phase 0 — core schema.
 *
 * Introduces the `specialties` lookup table (FHIR CodeableConcept-aligned:
 * code + display + system + snomed_code) and binds episodes, clinics and
 * staff to it via foreign keys. The lookup table's primary key is the
 * human-readable `code` so that queries stay natural (no JOIN needed for
 * the code itself) while still enforcing referential integrity.
 *
 * This is the gold-standard modelling pattern used by Bahmni, OpenMRS
 * (Concept dictionary), and FHIR — specialty is data, not an enum baked
 * into every migration.
 *
 * Safe to run against existing MH-only databases: every default and
 * backfill resolves to `mental_health`, so the existing product keeps
 * working unchanged.
 *
 * Tables created:
 *   - specialties                 (lookup, no clinic_id)
 *   - clinic_enabled_specialties  (junction: clinic × specialty)
 *   - staff_specialties           (junction: staff × specialty, with RLS)
 *
 * Columns added:
 *   - episodes.specialty_code       (NOT NULL, FK specialties.code, default mental_health)
 */
import type { Knex } from 'knex';

const SEED_SPECIALTIES: Array<{
  code: string;
  display: string;
  system: string;
  snomed_code: string;
  sort_order: number;
}> = [
  { code: 'mental_health',          display: 'Mental Health',             system: 'signacare',               snomed_code: '394587001', sort_order: 10 },
  { code: 'general_medicine',       display: 'Internal Medicine',         system: 'http://snomed.info/sct',  snomed_code: '419192003', sort_order: 20 },
  { code: 'endocrinology',          display: 'Endocrinology',             system: 'http://snomed.info/sct',  snomed_code: '394583002', sort_order: 30 },
  { code: 'paediatrics',            display: 'Paediatrics',               system: 'http://snomed.info/sct',  snomed_code: '394537008', sort_order: 40 },
  { code: 'obstetrics_gynaecology', display: 'Obstetrics & Gynaecology',  system: 'http://snomed.info/sct',  snomed_code: '394586005', sort_order: 50 },
  { code: 'surgery',                display: 'Surgery',                   system: 'http://snomed.info/sct',  snomed_code: '394609007', sort_order: 60 },
  { code: 'oncology',               display: 'Oncology',                  system: 'http://snomed.info/sct',  snomed_code: '394593009', sort_order: 70 },
];

export async function up(knex: Knex): Promise<void> {
  // ── 1. specialties lookup ──
  if (!(await knex.schema.hasTable('specialties'))) {
    await knex.schema.createTable('specialties', (t) => {
      t.string('code', 40).primary();
      t.string('display', 120).notNullable();
      t.string('system', 200).notNullable().defaultTo('signacare');
      t.string('snomed_code', 20).nullable();
      t.integer('sort_order').notNullable().defaultTo(100);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex('specialties').insert(SEED_SPECIALTIES).onConflict('code').ignore();
  } else {
    // Upsert seeds even if table already existed (idempotent re-run).
    for (const row of SEED_SPECIALTIES) {
      await knex('specialties').insert(row).onConflict('code').merge(['display', 'system', 'snomed_code', 'sort_order']);
    }
  }

  // ── 2. episodes.specialty_code ──
  const hasEpisodeSpecialty = await knex.schema.hasColumn('episodes', 'specialty_code');
  if (!hasEpisodeSpecialty) {
    // Step 1: add nullable so backfill can complete without a default conflict
    await knex.schema.alterTable('episodes', (t) => {
      t.string('specialty_code', 40).nullable();
    });

    // Step 2: backfill existing rows
    await knex('episodes').whereNull('specialty_code').update({ specialty_code: 'mental_health' });

    // Step 3: enforce NOT NULL, default, and FK
    // @migration-raw-exempt: legacy ALTER COLUMN SET NOT NULL; builder-equivalent pending R2 consolidation
    await knex.raw(`ALTER TABLE episodes ALTER COLUMN specialty_code SET NOT NULL`);
    // @migration-raw-exempt: legacy ALTER COLUMN SET DEFAULT; builder-equivalent pending R2 consolidation
    await knex.raw(`ALTER TABLE episodes ALTER COLUMN specialty_code SET DEFAULT 'mental_health'`);
    await knex.raw(`
      ALTER TABLE episodes
        ADD CONSTRAINT episodes_specialty_code_fkey
        FOREIGN KEY (specialty_code) REFERENCES specialties (code)
        ON UPDATE CASCADE ON DELETE RESTRICT
    `);

    // Query-hot index for cross-specialty summary and specialty queues.
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS episodes_patient_specialty_status_idx
        ON episodes (patient_id, specialty_code, status)`
    );
  }

  // ── 3. clinic_enabled_specialties junction ──
  if (!(await knex.schema.hasTable('clinic_enabled_specialties'))) {
    await knex.schema.createTable('clinic_enabled_specialties', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.string('specialty_code', 40).notNullable().references('code').inTable('specialties').onUpdate('CASCADE').onDelete('RESTRICT');
      t.timestamp('enabled_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.uuid('enabled_by').nullable().references('id').inTable('staff').onDelete('SET NULL');

      t.unique(['clinic_id', 'specialty_code']);
      t.index(['clinic_id']);
    });

    await knex.raw(`
      ALTER TABLE clinic_enabled_specialties ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_clinic_enabled_specialties_tenant ON clinic_enabled_specialties
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);

    // Seed: every existing clinic gets mental_health enabled so the MH
    // product keeps rendering. Subsequent specialties are opt-in per clinic.
    await knex.raw(`
      INSERT INTO clinic_enabled_specialties (clinic_id, specialty_code)
      SELECT c.id, 'mental_health' FROM clinics c
      ON CONFLICT (clinic_id, specialty_code) DO NOTHING
    `);
  }

  // ── 4. staff_specialties junction ──
  if (!(await knex.schema.hasTable('staff_specialties'))) {
    await knex.schema.createTable('staff_specialties', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
      t.string('specialty_code', 40).notNullable().references('code').inTable('specialties').onUpdate('CASCADE').onDelete('RESTRICT');
      t.boolean('is_primary').notNullable().defaultTo(false);
      t.string('credential_ref', 200).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.uuid('created_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.unique(['staff_id', 'specialty_code']);
      t.index(['clinic_id']);
      t.index(['staff_id']);
      t.index(['clinic_id', 'specialty_code']);
    });

    await knex.raw(`
      ALTER TABLE staff_specialties ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_staff_specialties_tenant ON staff_specialties
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);

    // Seed: every existing active staff member is enrolled in mental_health
    // so the current product keeps working. Admins can add more later.
    await knex.raw(`
      INSERT INTO staff_specialties (clinic_id, staff_id, specialty_code, is_primary)
      SELECT s.clinic_id, s.id, 'mental_health', true FROM staff s
      WHERE s.deleted_at IS NULL AND s.is_active = true
      ON CONFLICT (staff_id, specialty_code) DO NOTHING
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('staff_specialties');
  await knex.schema.dropTableIfExists('clinic_enabled_specialties');

  await knex.raw(`DROP INDEX IF EXISTS episodes_patient_specialty_status_idx`);
  await knex.raw(`ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_specialty_code_fkey`);
  const hasEpisodeSpecialty = await knex.schema.hasColumn('episodes', 'specialty_code');
  if (hasEpisodeSpecialty) {
    await knex.schema.alterTable('episodes', (t) => {
      t.dropColumn('specialty_code');
    });
  }

  await knex.schema.dropTableIfExists('specialties');
}
