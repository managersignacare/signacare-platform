// @migration-squashed-baseline  — this file is a consolidated checkpoint of
// 82 pre-R2 migrations. Per-call `@migration-raw-exempt` annotations are not
// required on the ~400 raw() blocks; every block must still match an
// ALLOWED_TOKENS category (RLS / CHECK / CREATE TABLE / CREATE TRIGGER /
// CREATE INDEX / etc.). The `check-migration-convention` guard honours this
// directive at the file level — see CLAUDE.md §12.4.

/**
 * Phase R R2b — Consolidated baseline migration.
 *
 * This file replaces all 82 historical .ts migrations (now archived under
 * apps/api/migrations.archive/) with one canonical schema definition. It
 * applies cleanly to an empty database and leaves the schema in the exact
 * state the pre-R2 tree produced via its chronological migrations — with
 * every SD39-62 + the 53 R1 ghost-column drifts resolved structurally at
 * the baseline rather than patched after the fact.
 *
 * **Rebuild path** (R2c, executed manually by the operator):
 *   psql -U postgres -c "DROP DATABASE signacaredb WITH (FORCE)"
 *   psql -U postgres -c "CREATE DATABASE signacaredb OWNER signacare_owner ENCODING 'UTF8'"
 *   npm run migrate:dev --workspace=apps/api   # this file runs
 *   npm run db:snapshot --workspace=apps/api   # regenerate snapshot
 *   npm run seed:good-health --workspace=apps/api
 *
 * **Rollback**: not via `npm run migrate:rollback` — the baseline is a
 * one-way rename of the migration ecosystem. To rollback, use the git tag
 * `pre-baseline-rebuild` (placed on 2026-04-18 before R2a):
 *   git reset --hard pre-baseline-rebuild
 *   git mv apps/api/migrations.archive/*.ts apps/api/migrations/
 *   (drop + recreate DB + run from scratch)
 *
 * **Scope** (per `docs/plans/master-plan-20260418.md`):
 *   - 191 tables grouped by domain into Sections A–M below
 *   - 1 extension (pg_trgm)
 *   - 3 custom functions (set_updated_at, audit_trigger_fn, staff_can_see_specialty)
 *   - ~162 updated_at + audit triggers
 *   - ~183 RLS policies (one per tenant table)
 *   - ~1039 indexes (PKs + FK indexes + partial + functional + unique)
 *
 * **Convention** (CLAUDE.md §12.1):
 *   - Schema builder for simple DDL (CREATE TABLE, ALTER TABLE ADD COLUMN,
 *     simple CREATE INDEX, foreign keys, unique constraints).
 *   - knex.raw() only for: RLS policies, triggers, functions, views,
 *     partial indexes, functional indexes, CHECK with expressions,
 *     dynamic identifiers, data DML (backfills), partitioning,
 *     GRANT/REVOKE/ALTER DEFAULT PRIVILEGES.
 *
 * **Verification protocol** (applied section-by-section during authoring):
 *   For every table section: `psql -c "\d <table>"` output pasted as a
 *   JSDoc block above the section; Knex builder calls transcribed from
 *   the psql output; raw SQL only for non-builder-expressible primitives.
 *
 * This file lands in multiple commits. Sections are marked with
 * ════════════════ SECTION <letter>: <title> ════════════════ dividers.
 * A section marked "PENDING" means it hasn't been authored yet; running
 * this migration against an empty DB will succeed up to the last
 * completed section + throw on the PENDING marker.
 */

import type { Knex } from 'knex';

export const config = { transaction: false as const };

export async function up(knex: Knex): Promise<void> {
  // ════════════════════════════════════════════════════════════════════
  // SECTION A — extensions + functions + clinics root
  // ════════════════════════════════════════════════════════════════════

  // ── Extensions ──
  // pg_trgm provides trigram-based ILIKE indexes on patient/staff searches.
  // Not expressible via Knex builder → raw is the canonical form.
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  // ── Functions ──
  // set_updated_at: trigger function that stamps NEW.updated_at = now()
  // on every UPDATE. Used by every table with an updated_at column. The
  // trigger itself is attached per-table in Section N.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.set_updated_at()
      RETURNS trigger
      LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$
  `);

  // audit_trigger_fn: inserts a row into audit_log for every INSERT /
  // UPDATE / DELETE on the attached table. SECURITY DEFINER so the
  // row-owning role isn't required to have audit_log INSERT privilege.
  // Swallows exceptions so audit failure never blocks the primary
  // operation (clinical data writes must always succeed).
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
    AS $$
    BEGIN
      INSERT INTO audit_log (id, clinic_id, user_id, action, table_name, record_id, old_data, new_data, created_at)
      VALUES (
        gen_random_uuid(),
        COALESCE(current_setting('app.clinic_id', true)::uuid, NULL),
        COALESCE(current_setting('app.user_id', true)::uuid, NULL),
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
        now()
      );
      RETURN COALESCE(NEW, OLD);
    EXCEPTION WHEN OTHERS THEN
      -- Don't let audit failures block the operation
      RETURN COALESCE(NEW, OLD);
    END;
    $$
  `);

  // staff_can_see_specialty: RLS helper used by episode/referral/appointment
  // policies. DEFINITION DEFERRED to immediately after staff_specialties +
  // clinic_enabled_specialties are created (Section C2). LANGUAGE sql
  // functions are parse-validated at CREATE time, so the function body
  // must be created AFTER its referenced tables exist.
  // Source: 20260420000000_specialties_core.ts — preserved verbatim there.

  // ── clinics — the tenant root ──
  //
  // Verified against psql \\d clinics (2026-04-18):
  //   id            uuid PK, default gen_random_uuid()
  //   name          varchar(255) NOT NULL
  //   legal_name    varchar(255)
  //   abn           varchar(20)
  //   phone         varchar(30)
  //   email         varchar(255)
  //   address_line1 varchar(255)
  //   address_line2 varchar(255)
  //   suburb        varchar(100)
  //   state         varchar(20)
  //   postcode      varchar(10)
  //   country       varchar(10)  default 'AU'
  //   timezone      varchar(100) default 'Australia/Melbourne'
  //   time_zone     varchar(100) default 'Australia/Melbourne'   -- duplicate of timezone (see NOTE)
  //   is_active     boolean      NOT NULL default true
  //   created_at    timestamptz  NOT NULL default now()
  //   updated_at    timestamptz  NOT NULL default now()
  //   deleted_at    timestamptz
  //
  //   idx_clinics_deleted_at partial index on (deleted_at) WHERE deleted_at IS NULL
  //
  // NOTE — timezone vs time_zone duplicate: both columns exist in the
  // current DB. Historical migrations added `timezone` first, then
  // `time_zone` was added in 20260401000002_add_health_fund_and_nursing.
  // Both are kept here to preserve byte-compat with existing code; a
  // future migration can collapse them once every read site is confirmed
  // to use a single canonical column.
  await knex.schema.createTable('clinics', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 255).notNullable();
    t.string('legal_name', 255);
    t.string('abn', 20);
    t.string('phone', 30);
    t.string('email', 255);
    t.string('address_line1', 255);
    t.string('address_line2', 255);
    t.string('suburb', 100);
    t.string('state', 20);
    t.string('postcode', 10);
    t.string('country', 10).defaultTo('AU');
    t.string('timezone', 100).defaultTo('Australia/Melbourne');
    t.string('time_zone', 100).defaultTo('Australia/Melbourne');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
  });

  // Partial index on active rows (hot path — list clinics for login
  // picker, clinic admin dashboards).
  await knex.raw(`
    CREATE INDEX idx_clinics_deleted_at
      ON clinics (deleted_at)
      WHERE deleted_at IS NULL
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION B — reference / lookup tables
  // ════════════════════════════════════════════════════════════════════
  //
  // 12 tables, all per-clinic taxonomy except specialties (global).
  // Each table follows a consistent shape: { id uuid PK, clinic_id (when
  // tenant-scoped), name varchar, is_active bool, sort_order int (when
  // ordered), created_at + updated_at }. Every table has:
  //   - PK on id
  //   - FK clinic_id → clinics(id) ON DELETE RESTRICT
  //   - btree index on clinic_id (FK index — required per CLAUDE.md §7.1)
  //   - RLS policy `rls_<table>_tenant` enforcing clinic_id isolation
  //   - BEFORE UPDATE trigger calling set_updated_at()
  //
  // Each block transcribed from `psql \\d <table>` against signacaredb
  // (2026-04-18). Trigger + RLS inlined per table for self-containment.

  // ── specialties (GLOBAL — no clinic_id; PK on code not id) ──
  // Verified: code, display, system ('signacare' default), snomed_code,
  // sort_order (default 100), is_active, created_at, updated_at.
  // Referenced by appointments, clinic_enabled_specialties, episodes,
  // patient_attachments, patient_medications.prescribed_by_specialty_code,
  // referrals.target_specialty_code, staff_specialties.
  await knex.schema.createTable('specialties', (t) => {
    t.string('code', 40).primary();
    t.string('display', 120).notNullable();
    t.string('system', 200).notNullable().defaultTo('signacare');
    t.string('snomed_code', 20);
    t.integer('sort_order').notNullable().defaultTo(100);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    CREATE TRIGGER trg_specialties_updated_at
    BEFORE UPDATE ON specialties
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);

  // Seed the 7 canonical specialty codes. Source:
  // 20260420000000_specialties_core.ts (preserved verbatim). Without
  // these rows, every staff_specialties + clinic_enabled_specialties +
  // episodes/appointments/etc INSERT crashes with FK violation.
  await knex('specialties').insert([
    { code: 'mental_health',          display: 'Mental Health',             system: 'signacare',              snomed_code: '394587001', sort_order: 10 },
    { code: 'general_medicine',       display: 'Internal Medicine',         system: 'http://snomed.info/sct', snomed_code: '419192003', sort_order: 20 },
    { code: 'endocrinology',          display: 'Endocrinology',             system: 'http://snomed.info/sct', snomed_code: '394583002', sort_order: 30 },
    { code: 'paediatrics',            display: 'Paediatrics',               system: 'http://snomed.info/sct', snomed_code: '394537008', sort_order: 40 },
    { code: 'obstetrics_gynaecology', display: 'Obstetrics & Gynaecology',  system: 'http://snomed.info/sct', snomed_code: '394586005', sort_order: 50 },
    { code: 'surgery',                display: 'Surgery',                   system: 'http://snomed.info/sct', snomed_code: '394609007', sort_order: 60 },
    { code: 'oncology',               display: 'Oncology',                  system: 'http://snomed.info/sct', snomed_code: '394593009', sort_order: 70 },
  ]);

  // ── clinic_enabled_specialties (junction; per-clinic) ──
  // Verified: id PK, clinic_id FK, specialty_code FK, enabled_at,
  // enabled_by (FK staff — DEFERRED to Section C since staff doesn't
  // exist yet; the column is declared without the FK here, FK added
  // in Section N).
  // Unique constraint: (clinic_id, specialty_code).
  await knex.schema.createTable('clinic_enabled_specialties', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.string('specialty_code', 40).notNullable().references('code').inTable('specialties').onUpdate('CASCADE').onDelete('RESTRICT');
    t.timestamp('enabled_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('enabled_by'); // FK to staff(id) deferred to Section N (forward reference)
    t.unique(['clinic_id', 'specialty_code']);
    t.index(['clinic_id'], 'idx_clinic_enabled_specialties_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE clinic_enabled_specialties ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinic_enabled_specialties_tenant ON clinic_enabled_specialties
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  `);

  // ── alert_types ──
  // Verified: id, clinic_id, name (max 200), severity (default 'medium'),
  // color (max 20), plan_template (text), is_active, sort_order,
  // created_at, updated_at.
  await knex.schema.createTable('alert_types', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 200).notNullable();
    t.string('severity', 30).notNullable().defaultTo('medium');
    t.string('color', 20);
    t.text('plan_template');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'alert_types_clinic_id_index');
    t.index(['clinic_id'], 'idx_alert_types_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE alert_types ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_alert_types_tenant ON alert_types
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_alert_types_updated_at
      BEFORE UPDATE ON alert_types
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── appointment_modes ──
  // Verified: id, clinic_id, name (max 100), is_active, sort_order, +ts.
  // SD-PROV gap fix: this table was MISSING from provisioningService —
  // R2 baseline + R3's seed-good-health both populate the standard 6
  // modes (Initial, Follow-up, Assessment, Telehealth, Group, Clinical
  // Review) so dropdowns no longer render empty.
  await knex.schema.createTable('appointment_modes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 100).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'appointment_modes_clinic_id_index');
    t.index(['clinic_id'], 'idx_appointment_modes_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE appointment_modes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_appointment_modes_tenant ON appointment_modes
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_appointment_modes_updated_at
      BEFORE UPDATE ON appointment_modes
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── clinical_roles ──
  // Verified: id, clinic_id, name (max 200), is_active, sort_order, +ts.
  // Referenced by staff_role_assignments.clinical_role_id.
  // SD15 resolution: code wrote `role_id` historically (caught in
  // Phase 0.7.5 c24-c8); the canonical column is `clinical_role_id`.
  await knex.schema.createTable('clinical_roles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 200).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'clinical_roles_clinic_id_index');
    t.index(['clinic_id'], 'idx_clinical_roles_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE clinical_roles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinical_roles_tenant ON clinical_roles
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_clinical_roles_updated_at
      BEFORE UPDATE ON clinical_roles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── episode_types ──
  // Verified: id, clinic_id, name (max 100), is_active, sort_order, +ts.
  // SD49 resolution: this table was previously missing entirely (added
  // in 20260603000001_episode_types.ts, archived). Includes a partial
  // index on active rows + functional unique on (clinic_id, lower(name)).
  // FK uses CASCADE (not RESTRICT — note the difference from siblings;
  // matches the archived migration's choice).
  await knex.schema.createTable('episode_types', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.string('name', 100).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_episode_types_clinic_id');
  });
  await knex.raw(`
    -- Partial index on active rows for the dropdown hot path
    CREATE INDEX idx_episode_types_clinic_active_sort
      ON episode_types (clinic_id, sort_order, name) WHERE is_active = true;
    -- Functional unique: case-insensitive name uniqueness per clinic
    CREATE UNIQUE INDEX unq_episode_types_clinic_name_lower
      ON episode_types (clinic_id, lower(name::text));
    ALTER TABLE episode_types ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_episode_types_tenant ON episode_types
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_episode_types_updated_at
      BEFORE UPDATE ON episode_types
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── investigation_types ──
  // Verified: id, clinic_id, name (max 200), is_active, sort_order, +ts.
  await knex.schema.createTable('investigation_types', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 200).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'investigation_types_clinic_id_index');
    t.index(['clinic_id'], 'idx_investigation_types_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE investigation_types ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_investigation_types_tenant ON investigation_types
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_investigation_types_updated_at
      BEFORE UPDATE ON investigation_types
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── legal_order_type_configs ──
  // Verified: id, clinic_id, name (max 200), category (max 100, NOT NULL),
  // is_active, sort_order, +ts. Category groups MHA forms by jurisdiction.
  await knex.schema.createTable('legal_order_type_configs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 200).notNullable();
    t.string('category', 100).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'legal_order_type_configs_clinic_id_index');
    t.index(['clinic_id'], 'idx_legal_order_type_configs_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE legal_order_type_configs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_legal_order_type_configs_tenant ON legal_order_type_configs
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_legal_order_type_configs_updated_at
      BEFORE UPDATE ON legal_order_type_configs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── professional_disciplines ──
  // Verified: id, clinic_id, name (max 200), is_active, sort_order, +ts.
  await knex.schema.createTable('professional_disciplines', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 200).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'professional_disciplines_clinic_id_index');
    t.index(['clinic_id'], 'idx_professional_disciplines_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE professional_disciplines ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_professional_disciplines_tenant ON professional_disciplines
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_professional_disciplines_updated_at
      BEFORE UPDATE ON professional_disciplines
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── programs ──
  // Verified: id, clinic_id, name (max 200), description (text),
  // is_active, +ts. NO sort_order (programs are not displayed
  // alphabetically by default).
  await knex.schema.createTable('programs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 200).notNullable();
    t.text('description');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'programs_clinic_id_index');
    t.index(['clinic_id'], 'idx_programs_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_programs_tenant ON programs
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_programs_updated_at
      BEFORE UPDATE ON programs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── referral_sources ──
  // Verified: id, clinic_id, category (max 100, NOT NULL), name (max 200),
  // is_active, sort_order, +ts. Category groups source types
  // (e.g. 'gp', 'specialist', 'hospital', 'community').
  await knex.schema.createTable('referral_sources', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('category', 100).notNullable();
    t.string('name', 200).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'referral_sources_clinic_id_index');
    t.index(['clinic_id'], 'idx_referral_sources_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE referral_sources ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_referral_sources_tenant ON referral_sources
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_referral_sources_updated_at
      BEFORE UPDATE ON referral_sources
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── template_categories ──
  // Verified: id, clinic_id, name (max 200), is_active, sort_order,
  // created_at NOT NULL, updated_at NULLABLE (default now()).
  // NOTE on updated_at nullability: this table is unique among Section B
  // — its updated_at column is nullable in the current schema. Preserved
  // for byte-compat; future migration could enforce NOT NULL.
  await knex.schema.createTable('template_categories', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 200).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()); // nullable in current schema
    t.index(['clinic_id'], 'template_categories_clinic_id_index');
    t.index(['clinic_id'], 'idx_template_categories_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE template_categories ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_template_categories_tenant ON template_categories
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_template_categories_updated_at
      BEFORE UPDATE ON template_categories
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION C1 — org hierarchy + staff foundation
  // ════════════════════════════════════════════════════════════════════
  //
  // 3 tables. Foundational for everything that depends on staff or
  // org_units (which is most of the schema). C2 (remaining staff
  // cluster) and C3 (patient cluster) follow.

  // ── org_units (self-referencing tree) ──
  // Verified: id, clinic_id, name (max 200), level (default 'team'),
  // parent_id (self-FK), sort_order, is_active, +ts.
  // Self-FK uses ON DELETE CASCADE to support deleting an entire subtree
  // (verified against archived 20260401000000_v2_baseline.ts).
  await knex.schema.createTable('org_units', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 200).notNullable();
    t.string('level', 50).notNullable().defaultTo('team');
    t.uuid('parent_id').references('id').inTable('org_units').onDelete('CASCADE');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'org_units_clinic_id_index');
    t.index(['clinic_id'], 'idx_org_units_clinic_id');
    t.index(['clinic_id', 'level'], 'org_units_clinic_id_level_index');
    t.index(['parent_id'], 'org_units_parent_id_index');
  });
  await knex.raw(`
    ALTER TABLE org_units ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_org_units_tenant ON org_units
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_org_units_updated_at
      BEFORE UPDATE ON org_units
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── staff (40 columns) ──
  // Verified via psql \\d staff (2026-04-18). The most-referenced table
  // in the schema (40+ FKs from other tables). Foundational columns
  // grouped by purpose:
  //
  //   Identity        : id, clinic_id, given_name, family_name, preferred_name, email
  //   Auth            : password_hash, role, must_change_password, failed_login_attempts,
  //                     locked_until, last_login_at
  //   MFA             : require_mfa, has_mfa_configured, mfa_enabled, mfa_secret, recovery_codes
  //   Contact         : phone_mobile, phone_work
  //   Professional    : discipline, discipline_id, ahpra_number, prescriber_number,
  //                     provider_number, hpii, qualifications, specialisation
  //   Employment      : employment_type, worker_type, is_active
  //   Outlook OAuth   : outlook_email, outlook_refresh_token, outlook_token_expires_at,
  //                     outlook_calendar_id
  //   Audit           : created_at, updated_at, deleted_at
  //   Misc            : digital_signature, max_concurrent_sessions
  //
  // Two unique constraints:
  //   - staff_email_unique: email globally unique (legacy from v1)
  //   - uq_staff_clinic_email: (clinic_id, email) — current canonical
  // Both preserved for byte-compat; future migration can collapse to one.
  await knex.schema.createTable('staff', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('given_name', 100).notNullable();
    t.string('family_name', 100).notNullable();
    t.string('preferred_name', 100);
    t.string('email', 255).notNullable();
    t.string('password_hash', 255).notNullable();
    t.string('role', 50).notNullable().defaultTo('clinician');
    t.string('discipline', 100);
    t.string('discipline_id', 100);
    t.string('phone_mobile', 30);
    t.string('phone_work', 30);
    t.string('ahpra_number', 50);
    t.string('prescriber_number', 50);
    t.string('provider_number', 50);
    t.string('hpii', 50);
    t.text('qualifications');
    t.string('specialisation', 200);
    t.string('employment_type', 50);
    t.string('worker_type', 50);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('require_mfa').notNullable().defaultTo(false);
    t.boolean('has_mfa_configured').notNullable().defaultTo(false);
    t.boolean('mfa_enabled').defaultTo(false);
    t.string('mfa_secret', 255);
    t.jsonb('recovery_codes');
    t.boolean('must_change_password').defaultTo(false);
    t.integer('failed_login_attempts').notNullable().defaultTo(0);
    t.timestamp('locked_until', { useTz: true });
    t.timestamp('last_login_at', { useTz: true });
    t.string('outlook_email', 255);
    t.string('outlook_refresh_token', 1000);
    t.bigInteger('outlook_token_expires_at');
    t.string('outlook_calendar_id', 255);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.text('digital_signature');
    t.integer('max_concurrent_sessions').notNullable().defaultTo(3);
    t.unique(['email'], { indexName: 'staff_email_unique' });
    t.unique(['clinic_id', 'email'], { indexName: 'uq_staff_clinic_email' });
    t.index(['clinic_id'], 'staff_clinic_id_index');
    t.index(['clinic_id'], 'idx_staff_clinic_id');
    t.index(['clinic_id', 'is_active'], 'staff_clinic_id_is_active_index');
    t.index(['email'], 'staff_email_index');
  });
  await knex.raw(`
    -- Partial soft-delete index (CLAUDE.md §1.4 — soft-delete hot path)
    CREATE INDEX idx_staff_deleted_at ON staff (deleted_at) WHERE deleted_at IS NULL;
    ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_staff_tenant ON staff
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_staff_updated_at
      BEFORE UPDATE ON staff
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── staff_specialties (junction; needed by staff_can_see_specialty fn) ──
  // Verified: id, clinic_id, staff_id, specialty_code (FK to specialties),
  // is_primary, credential_ref, created_at, created_by (FK staff
  // self-ref — added inline since staff exists at this point), updated_at,
  // deleted_at.
  // Unique: (staff_id, specialty_code) prevents duplicate specialty rows
  // per staff.
  await knex.schema.createTable('staff_specialties', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.string('specialty_code', 40).notNullable().references('code').inTable('specialties').onUpdate('CASCADE').onDelete('RESTRICT');
    t.boolean('is_primary').notNullable().defaultTo(false);
    t.string('credential_ref', 200);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('created_by').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.unique(['staff_id', 'specialty_code'], { indexName: 'staff_specialties_staff_id_specialty_code_unique' });
    t.index(['clinic_id'], 'staff_specialties_clinic_id_index');
    t.index(['clinic_id'], 'idx_staff_specialties_clinic_id');
    t.index(['clinic_id', 'specialty_code'], 'staff_specialties_clinic_id_specialty_code_index');
    t.index(['staff_id'], 'staff_specialties_staff_id_index');
  });
  await knex.raw(`
    -- Partial soft-delete index (CLAUDE.md §1.4)
    CREATE INDEX idx_staff_specialties_deleted_at
      ON staff_specialties (deleted_at) WHERE deleted_at IS NULL;
    ALTER TABLE staff_specialties ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_staff_specialties_tenant ON staff_specialties
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_staff_specialties_updated_at
      BEFORE UPDATE ON staff_specialties
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // staff_can_see_specialty: RLS helper used by episode/referral/appointment
  // policies. Returns true if the staff member has an active specialty
  // assignment AND the clinic has that specialty enabled. Source:
  // 20260420000000_specialties_core.ts — preserved verbatim.
  // Definition placed AFTER both staff_specialties (line ~644) and
  // clinic_enabled_specialties (line ~226) are created — LANGUAGE sql
  // functions parse-validate at CREATE time.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.staff_can_see_specialty(p_staff_id uuid, p_specialty_code text)
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
    $$
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION C2 — remaining staff cluster
  // ════════════════════════════════════════════════════════════════════
  //
  // 8 tables. Most are NON-tenant (no clinic_id, no RLS) because they
  // either inherit tenancy through their FK to staff (staff_id ON DELETE
  // CASCADE), or are global lookups (permissions). The 3 tenant-scoped
  // tables (staff_module_access, staff_sessions, active_sessions) get
  // their own RLS policies.

  // ── permissions (GLOBAL — no clinic_id; name-keyed) ──
  // Verified: id, name (UNIQUE, max 200), description (max 500), +ts.
  // Referenced only by staff_permissions.permission_id.
  await knex.schema.createTable('permissions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 200).notNullable();
    t.string('description', 500);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['name'], { indexName: 'permissions_name_unique' });
  });
  await knex.raw(`
    CREATE TRIGGER trg_permissions_updated_at
      BEFORE UPDATE ON permissions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);

  // ── staff_role_assignments (junction; NO clinic_id, NO RLS) ──
  // Verified: id, staff_id (FK CASCADE), org_unit_id (FK CASCADE),
  // clinical_role_id (FK CASCADE), role_type (max 50), start_date,
  // end_date, is_active, +ts. No clinic_id, no RLS — tenancy inherited
  // via staff_id → staff(id) → clinic_id and org_unit_id → org_units(id)
  // → clinic_id.
  await knex.schema.createTable('staff_role_assignments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.uuid('org_unit_id').notNullable().references('id').inTable('org_units').onDelete('CASCADE');
    t.uuid('clinical_role_id').notNullable().references('id').inTable('clinical_roles').onDelete('CASCADE');
    t.string('role_type', 50).notNullable();
    t.date('start_date').notNullable();
    t.date('end_date');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinical_role_id'], 'idx_staff_role_assignments_clinical_role_id');
    t.index(['org_unit_id'], 'staff_role_assignments_org_unit_id_index');
    t.index(['staff_id'], 'staff_role_assignments_staff_id_index');
  });
  await knex.raw(`
    CREATE TRIGGER trg_staff_role_assignments_updated_at
      BEFORE UPDATE ON staff_role_assignments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);

  // ── staff_team_assignments (junction; NO clinic_id, NO RLS) ──
  // Verified: id, staff_id (FK CASCADE), org_unit_id (FK CASCADE),
  // start_date, end_date, is_active, +ts.
  await knex.schema.createTable('staff_team_assignments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.uuid('org_unit_id').notNullable().references('id').inTable('org_units').onDelete('CASCADE');
    t.date('start_date').notNullable();
    t.date('end_date');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['org_unit_id'], 'staff_team_assignments_org_unit_id_index');
    t.index(['staff_id'], 'staff_team_assignments_staff_id_index');
  });
  await knex.raw(`
    CREATE TRIGGER trg_staff_team_assignments_updated_at
      BEFORE UPDATE ON staff_team_assignments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);

  // ── staff_module_access (per-staff RBAC; HAS clinic_id + RLS) ──
  // Verified: id, staff_id, clinic_id, module (max 100), access_level
  // (default 'read'), granted_by_id (FK staff SET NULL), can_delegate_this,
  // +ts. The granted_by_id FK is the audit trail for "who gave this
  // staff member access to this module".
  await knex.schema.createTable('staff_module_access', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('module', 100).notNullable();
    t.string('access_level', 30).notNullable().defaultTo('read');
    t.uuid('granted_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.boolean('can_delegate_this').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_staff_module_access_clinic_id');
    t.index(['granted_by_id'], 'idx_staff_module_access_granted_by_id');
    t.index(['clinic_id', 'module'], 'staff_module_access_clinic_id_module_index');
    t.index(['staff_id', 'clinic_id'], 'staff_module_access_staff_id_clinic_id_index');
  });
  await knex.raw(`
    ALTER TABLE staff_module_access ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_staff_module_access_tenant ON staff_module_access
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_staff_module_access_updated_at
      BEFORE UPDATE ON staff_module_access
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── staff_settings (key/value per-staff prefs; NO clinic_id, NO RLS) ──
  // Verified: id, staff_id (FK CASCADE), setting_key (max 200),
  // setting_value (jsonb), +ts. UNIQUE on (staff_id, setting_key).
  // No clinic_id — settings are personal, follow the staff row.
  await knex.schema.createTable('staff_settings', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.string('setting_key', 200).notNullable();
    t.jsonb('setting_value');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['staff_id', 'setting_key'], { indexName: 'staff_settings_staff_id_setting_key_unique' });
    t.index(['staff_id'], 'staff_settings_staff_id_index');
  });
  await knex.raw(`
    CREATE TRIGGER trg_staff_settings_updated_at
      BEFORE UPDATE ON staff_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);

  // ── staff_sessions (live session + refresh-token family; HAS RLS) ──
  // Verified: id, staff_id, clinic_id, refresh_token (max 500), user_agent,
  // ip_address, expires_at, +ts, revoked_at, family_id (uuid + default
  // gen_random_uuid()).
  // TWO RLS policies:
  //   - rls_staff_sessions_tenant: standard tenant scope
  //   - auth_bypass: allows reads when app.clinic_id is NULL (login flow
  //     before tenant context is set; CLAUDE.md auth path)
  await knex.schema.createTable('staff_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.string('refresh_token', 500).notNullable();
    t.string('user_agent', 500);
    t.string('ip_address', 50);
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('revoked_at', { useTz: true });
    t.uuid('family_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    t.index(['clinic_id'], 'idx_staff_sessions_clinic_id');
    t.index(['family_id'], 'staff_sessions_family_id_idx');
    t.index(['refresh_token'], 'staff_sessions_refresh_token_index');
    t.index(['staff_id'], 'staff_sessions_staff_id_index');
  });
  await knex.raw(`
    ALTER TABLE staff_sessions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_staff_sessions_tenant ON staff_sessions
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- auth_bypass: pre-tenant-context reads (login flow). Without this
    -- the auth handler couldn't look up sessions by refresh_token before
    -- setting app.clinic_id.
    CREATE POLICY auth_bypass ON staff_sessions
      FOR ALL
      USING (NULLIF(current_setting('app.clinic_id', true), '') IS NULL)
      WITH CHECK (NULLIF(current_setting('app.clinic_id', true), '') IS NULL);
    CREATE TRIGGER trg_staff_sessions_updated_at
      BEFORE UPDATE ON staff_sessions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── staff_permissions (junction: staff × permission; NO clinic_id, NO RLS) ──
  // Verified: id, staff_id (FK CASCADE), permission_id (FK CASCADE),
  // granted_at, granted_by (FK staff SET NULL), created_at, updated_at
  // (NULLABLE — preserved for byte-compat).
  await knex.schema.createTable('staff_permissions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.uuid('permission_id').notNullable().references('id').inTable('permissions').onDelete('CASCADE');
    t.timestamp('granted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('granted_by').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()); // nullable in current schema
    t.unique(['staff_id', 'permission_id'], { indexName: 'staff_permissions_staff_id_permission_id_unique' });
    t.index(['granted_by'], 'idx_staff_permissions_granted_by');
  });
  await knex.raw(`
    CREATE TRIGGER trg_staff_permissions_updated_at
      BEFORE UPDATE ON staff_permissions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);

  // ── active_sessions (active refresh-token JTIs; HAS clinic_id + RLS) ──
  // Verified: id, staff_id (FK CASCADE), clinic_id (FK no-action),
  // refresh_token_jti (max 64), ip_address (max 45 — IPv6),
  // user_agent (max 500), created_at, expires_at, revoked_at.
  // Distinct from staff_sessions: this table tracks the JWT JTI claim
  // for refresh tokens (audit trail + revocation), where staff_sessions
  // tracks the full opaque refresh_token + family.
  // No updated_at column; no trigger needed.
  await knex.schema.createTable('active_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
    t.string('refresh_token_jti', 64).notNullable();
    t.string('ip_address', 45);
    t.string('user_agent', 500);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('revoked_at', { useTz: true });
    t.index(['clinic_id'], 'active_sessions_clinic_id_index');
    t.index(['clinic_id'], 'idx_active_sessions_clinic_id');
    t.index(['refresh_token_jti'], 'active_sessions_refresh_token_jti_index');
    t.index(['staff_id'], 'active_sessions_staff_id_index');
  });
  await knex.raw(`
    ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_active_sessions_tenant ON active_sessions
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION C3a — patients (the table)
  // ════════════════════════════════════════════════════════════════════
  //
  // 64 columns — the most-FK'd patient root. SD52 (photo_url column) is
  // built-in here. Three encrypted-lookup columns (medicare_number_lookup,
  // ihi_number_lookup, dva_number_lookup) are blind-index hashes that
  // power dedup queries; their UNIQUE indexes are PARTIAL on
  // `WHERE deleted_at IS NULL AND <col> IS NOT NULL`.
  //
  // search_tsv is a GENERATED ALWAYS AS column (Postgres 12+ feature)
  // that builds a tsvector from family_name + given_name + preferred_name
  // + emr_number + medicare_number. The Knex builder doesn't express
  // generated columns; raw is required (allowed-token category covers
  // this since 'GENERATED ALWAYS AS' is treated as a non-builder DDL
  // primitive).
  //
  // Trigram GIN indexes on family_name + given_name back the
  // patient-search hot path (typeahead). pg_trgm extension already
  // declared in Section A.
  //
  // FK sms_consent_updated_by → staff(id) added inline (staff exists).
  await knex.schema.createTable('patients', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('emr_number', 50);
    t.string('given_name', 100).notNullable();
    t.string('family_name', 100).notNullable();
    t.string('preferred_name', 100);
    t.date('date_of_birth').notNullable();
    t.string('gender', 30);
    t.string('pronouns', 50);
    t.string('email', 255);
    t.string('email_primary', 255);
    t.string('phone_mobile', 30);
    t.string('phone_home', 30);
    t.string('address_line1', 255);
    t.string('address_line2', 255);
    t.string('suburb', 100);
    t.string('state', 30);
    t.string('postcode', 10);
    t.string('country', 60).defaultTo('AU');
    t.string('status', 30).notNullable().defaultTo('active');
    // Identifiers (encrypted at rest via PHI_ENCRYPTION_KEY in app layer)
    t.string('medicare_number', 30);
    t.string('medicare_reference', 10);
    t.date('medicare_expiry');
    t.string('ihi_number', 30);
    t.string('dva_number', 30);
    t.string('dva_card_type', 20);
    // Demographics
    t.string('indigenous_status', 50);
    t.string('atsi_status', 50);
    t.boolean('interpreter_required').notNullable().defaultTo(false);
    t.string('interpreter_language', 100);
    // Emergency contact
    t.string('emergency_contact_name', 200);
    t.string('emergency_contact_phone', 30);
    t.string('emergency_contact_relationship', 100);
    // Primary GP details (denormalised; canonical version is in
    // patient_providers)
    t.string('gp_name', 200);
    t.string('gp_practice', 200);
    t.string('gp_phone', 30);
    t.string('gp_fax', 30);
    t.string('gp_email', 255);
    t.string('gp_provider_number', 30);
    t.string('gp_address_street', 255);
    t.string('gp_address_suburb', 100);
    t.string('gp_address_state', 20);
    t.string('gp_address_postcode', 10);
    // Next of kin
    t.string('nok_name', 200);
    t.string('nok_relationship', 100);
    t.string('nok_phone', 30);
    // Consents
    t.boolean('consent_to_treatment').defaultTo(false);
    t.boolean('consent_for_research').defaultTo(false);
    t.boolean('consent_to_share_with_gp').defaultTo(false);
    t.boolean('consent_to_share_with_carer').defaultTo(false);
    // Audit
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    // Viva mobile-app integration
    t.string('viva_triage_number', 30);
    // Health fund
    t.string('health_fund_name', 100);
    t.string('health_fund_number', 50);
    // Blind-index lookup columns (text — hex of HMAC-SHA256)
    // Set by app on insert via the BLIND_INDEX_KEY (CLAUDE.md §13).
    // search_tsv is generated — added below via raw since the builder
    // doesn't express GENERATED ALWAYS AS.
    t.text('medicare_number_lookup');
    t.text('ihi_number_lookup');
    t.text('dva_number_lookup');
    // SMS consent (Phase 12 patient outreach)
    t.boolean('sms_consent').notNullable().defaultTo(false);
    t.timestamp('sms_consent_updated_at', { useTz: true });
    t.uuid('sms_consent_updated_by').references('id').inTable('staff').onDelete('SET NULL');
    // SD52 — photo_url (added via 20260603000002_patients_photo_url.ts; baked in here)
    t.text('photo_url');
    // Standard btree FK + status indexes
    t.index(['clinic_id'], 'idx_patients_clinic_id');
    t.index(['clinic_id'], 'patients_clinic_id_index');
    t.index(['clinic_id', 'emr_number'], 'patients_clinic_id_emr_number_index');
    t.index(['clinic_id', 'family_name', 'given_name'], 'patients_clinic_id_family_name_given_name_index');
    t.index(['clinic_id', 'status'], 'patients_clinic_id_status_index');
    t.index(['deleted_at'], 'patients_deleted_at_index');
  });
  await knex.raw(`
    -- Generated tsvector column (Postgres 12+; not expressible via Knex builder).
    -- search_tsv = COALESCE(family_name, '') || ' ' || COALESCE(given_name, '') || ' ' || …
    ALTER TABLE patients ADD COLUMN search_tsv tsvector
      GENERATED ALWAYS AS (
        to_tsvector('english',
          COALESCE(family_name, '')::text || ' ' ||
          COALESCE(given_name, '')::text || ' ' ||
          COALESCE(preferred_name, '')::text || ' ' ||
          COALESCE(emr_number, '')::text || ' ' ||
          COALESCE(medicare_number, '')::text
        )
      ) STORED;

    -- Partial soft-delete index (CLAUDE.md §1.4)
    CREATE INDEX idx_patients_deleted_at ON patients (deleted_at)
      WHERE deleted_at IS NULL;

    -- Partial composite for date-of-birth dedup queries
    CREATE INDEX patients_clinic_dob_idx ON patients (clinic_id, date_of_birth)
      WHERE deleted_at IS NULL;

    -- Trigram GIN indexes for fuzzy name search (typeahead hot path)
    CREATE INDEX patients_family_name_trgm
      ON patients USING gin (family_name gin_trgm_ops);
    CREATE INDEX patients_given_name_trgm
      ON patients USING gin (given_name gin_trgm_ops);

    -- GIN on the generated tsvector (full-text search)
    CREATE INDEX patients_search_tsv_gin
      ON patients USING gin (search_tsv);

    -- Partial UNIQUE indexes on blind-index lookup columns. Three
    -- scoped to (clinic_id, <lookup_col>) — uniqueness only matters
    -- per-tenant + only for non-deleted rows with a value present.
    CREATE UNIQUE INDEX patients_medicare_lookup_uniq
      ON patients (clinic_id, medicare_number_lookup)
      WHERE deleted_at IS NULL AND medicare_number_lookup IS NOT NULL;
    CREATE UNIQUE INDEX patients_ihi_lookup_uniq
      ON patients (clinic_id, ihi_number_lookup)
      WHERE deleted_at IS NULL AND ihi_number_lookup IS NOT NULL;
    CREATE UNIQUE INDEX patients_dva_lookup_uniq
      ON patients (clinic_id, dva_number_lookup)
      WHERE deleted_at IS NULL AND dva_number_lookup IS NOT NULL;

    ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patients_tenant ON patients
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_patients_updated_at
      BEFORE UPDATE ON patients
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION C3b — patient supporting tables
  // ════════════════════════════════════════════════════════════════════
  //
  // 7 tables. SD45-48 (patient_contacts ghost columns) baked in here.

  // ── patient_contacts (SD45-48 cols built-in) ──
  // Verified: id, patient_id, given_name, family_name, relationship,
  // phones, email, is_emergency_contact, is_carer, has_consent, +ts,
  // contact_type ('support_person' default), consent_level ('full' default),
  // consent_notes, deleted_at, clinic_id.
  // updated_at is NULLABLE (preserved for byte-compat). Uses
  // audit_trigger_fn (AFTER) instead of set_updated_at (BEFORE) — this
  // table wants the audit_log row written for every change.
  await knex.schema.createTable('patient_contacts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('given_name', 100).notNullable();
    t.string('family_name', 100);
    t.string('relationship', 100);
    t.string('phone_mobile', 30);
    t.string('phone_home', 30);
    t.string('email', 255);
    t.boolean('is_emergency_contact').notNullable().defaultTo(false);
    t.boolean('is_carer').notNullable().defaultTo(false);
    t.boolean('has_consent').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()); // nullable in current schema
    // SD45-48: built-in from day one
    t.string('contact_type', 50).defaultTo('support_person');
    t.string('consent_level', 50).defaultTo('full');
    t.text('consent_notes');
    t.timestamp('deleted_at', { useTz: true });
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.index(['clinic_id'], 'idx_patient_contacts_clinic_id');
    t.index(['deleted_at'], 'idx_patient_contacts_deleted_at');
    t.index(['patient_id'], 'patient_contacts_patient_id_index');
  });
  await knex.raw(`
    ALTER TABLE patient_contacts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_contacts_tenant ON patient_contacts
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- patient_contacts uses the audit trigger (AFTER, all events) instead
    -- of set_updated_at (BEFORE UPDATE) — preserves the v2_baseline choice.
    CREATE TRIGGER trg_patient_contacts_audit
      AFTER INSERT OR UPDATE OR DELETE ON patient_contacts
      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
  `);

  // ── patient_providers ──
  // Verified: id, patient_id, clinic_id, provider_type, provider_name +
  // practice + phone + fax + email + number + address (all nullable),
  // is_primary, +ts. updated_at NULLABLE.
  await knex.schema.createTable('patient_providers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('SET NULL');
    t.string('provider_type', 50);
    t.string('provider_name', 200);
    t.string('provider_practice', 200);
    t.string('provider_phone', 30);
    t.string('provider_fax', 30);
    t.string('provider_email', 255);
    t.string('provider_number', 30);
    t.text('provider_address');
    t.boolean('is_primary').defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()); // nullable
    t.index(['clinic_id'], 'idx_patient_providers_clinic_id');
    t.index(['patient_id'], 'patient_providers_patient_id_index');
  });
  await knex.raw(`
    ALTER TABLE patient_providers ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_providers_tenant ON patient_providers
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_patient_providers_updated_at
      BEFORE UPDATE ON patient_providers
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── patient_attachments ──
  // Verified: id, patient_id, uploaded_by, filename, label, mime_type,
  // file_size, file_path, is_active, created_at, storage_backend
  // ('local' default), storage_key, storage_bucket, storage_etag,
  // clinic_id, episode_id, specialty_code, updated_at (NULLABLE).
  // FK episode_id → episodes(id) DEFERRED to Section N (episodes is
  // declared in Section D).
  // FK uploaded_by → staff(id), specialty_code → specialties(code)
  // both inline (already exist).
  await knex.schema.createTable('patient_attachments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('uploaded_by').references('id').inTable('staff').onDelete('SET NULL');
    t.string('filename', 500).notNullable();
    t.string('label', 300);
    t.string('mime_type', 100);
    t.integer('file_size');
    t.text('file_path').notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('storage_backend').notNullable().defaultTo('local');
    t.text('storage_key');
    t.text('storage_bucket');
    t.text('storage_etag');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('SET NULL');
    t.uuid('episode_id'); // FK → episodes(id) deferred to Section N
    t.string('specialty_code', 40).references('code').inTable('specialties').onUpdate('CASCADE').onDelete('RESTRICT');
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()); // nullable
    t.index(['clinic_id'], 'idx_patient_attachments_clinic_id');
    t.index(['episode_id'], 'idx_patient_attachments_episode');
    t.index(['patient_id', 'specialty_code'], 'idx_patient_attachments_patient_specialty');
    t.index(['uploaded_by'], 'idx_patient_attachments_uploaded_by');
    t.index(['clinic_id'], 'patient_attachments_clinic_id_idx');
    t.index(['patient_id'], 'patient_attachments_patient_id_index');
    t.index(['storage_key'], 'patient_attachments_storage_key_idx');
  });
  await knex.raw(`
    ALTER TABLE patient_attachments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_attachments_tenant ON patient_attachments
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_patient_attachments_updated_at
      BEFORE UPDATE ON patient_attachments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── patient_invites (Viva mobile-app invitation codes) ──
  // Verified: id, clinic_id, patient_id, code (max 6 — short PIN),
  // qr_token (uuid, default gen_random_uuid()), expires_at, used_at,
  // created_by (FK staff), created_at. Has TWO RLS policies (legacy
  // rls_patient_invites + rls_patient_invites_tenant) — both preserved
  // for byte-compat per archived migrations. Partial indexes on
  // unconsumed invites only.
  await knex.schema.createTable('patient_invites', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
    t.uuid('patient_id').notNullable().references('id').inTable('patients');
    t.string('code', 6).notNullable();
    t.uuid('qr_token').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('used_at', { useTz: true });
    t.uuid('created_by').references('id').inTable('staff');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_patient_invites_clinic');
    t.index(['clinic_id'], 'idx_patient_invites_clinic_id');
    t.index(['created_by'], 'idx_patient_invites_created_by');
    t.index(['patient_id'], 'idx_patient_invites_patient');
    t.index(['clinic_id'], 'patient_invites_clinic_id_index');
    t.index(['patient_id'], 'patient_invites_patient_id_index');
  });
  await knex.raw(`
    -- Partial indexes on UNCONSUMED invites only (the lookup hot path)
    CREATE INDEX idx_patient_invites_code ON patient_invites (code) WHERE used_at IS NULL;
    CREATE INDEX idx_patient_invites_qr ON patient_invites (qr_token) WHERE used_at IS NULL;
    ALTER TABLE patient_invites ENABLE ROW LEVEL SECURITY;
    -- Two RLS policies preserved for byte-compat with archived migrations
    CREATE POLICY rls_patient_invites ON patient_invites
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE POLICY rls_patient_invites_tenant ON patient_invites
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── patient_team_assignments ──
  // Verified: id, patient_id, org_unit_id, primary_clinician_id (FK
  // staff SET NULL), is_active, +ts. NO clinic_id (tenancy via
  // patient_id → patients(id) → clinic_id). Has TWO duplicate UNIQUE
  // constraints on (patient_id, org_unit_id) — preserved for byte-compat
  // (the archived migrations applied the constraint twice; one named
  // by Knex auto-naming, one with explicit name uq_*).
  // updated_at NULLABLE.
  await knex.schema.createTable('patient_team_assignments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('org_unit_id').notNullable().references('id').inTable('org_units').onDelete('CASCADE');
    t.uuid('primary_clinician_id').references('id').inTable('staff').onDelete('SET NULL');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()); // nullable
    t.index(['primary_clinician_id'], 'idx_patient_team_assignments_primary_clinician_id');
    t.index(['org_unit_id'], 'patient_team_assignments_org_unit_id_index');
    t.index(['patient_id'], 'patient_team_assignments_patient_id_index');
    t.index(['patient_id', 'is_active'], 'patient_team_assignments_patient_id_is_active_index');
    // Two duplicate UNIQUE constraints preserved for byte-compat
    t.unique(['patient_id', 'org_unit_id'], { indexName: 'patient_team_assignments_patient_id_org_unit_id_unique' });
    t.unique(['patient_id', 'org_unit_id'], { indexName: 'uq_patient_team_assignments_patient_org' });
  });
  await knex.raw(`
    CREATE TRIGGER trg_patient_team_assignments_updated_at
      BEFORE UPDATE ON patient_team_assignments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);

  // ── patient_alerts ──
  // Verified: id, patient_id, clinic_id, alert_type_id (FK alert_types
  // RESTRICT), entered_by_id (FK staff SET NULL), title, notes,
  // management_plan, severity ('medium' default), is_active, show_flag,
  // +ts, resolved_at.
  await knex.schema.createTable('patient_alerts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('alert_type_id').notNullable().references('id').inTable('alert_types').onDelete('RESTRICT');
    t.uuid('entered_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.string('title', 300).notNullable();
    t.text('notes');
    t.text('management_plan');
    t.string('severity', 30).notNullable().defaultTo('medium');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('show_flag').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('resolved_at', { useTz: true });
    t.index(['alert_type_id'], 'idx_patient_alerts_alert_type_id');
    t.index(['clinic_id'], 'idx_patient_alerts_clinic_id');
    t.index(['entered_by_id'], 'idx_patient_alerts_entered_by_id');
    t.index(['clinic_id'], 'patient_alerts_clinic_id_index');
    t.index(['patient_id', 'is_active'], 'patient_alerts_patient_id_is_active_index');
  });
  await knex.raw(`
    ALTER TABLE patient_alerts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_alerts_tenant ON patient_alerts
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_patient_alerts_updated_at
      BEFORE UPDATE ON patient_alerts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── patient_app_accounts (Viva mobile-app credentials) ──
  // Verified: id, clinic_id, patient_id, phone, email, password_hash,
  // is_active, mfa_enabled, mfa_secret, last_login_at,
  // failed_login_attempts, locked_until, +ts. UNIQUE on (clinic_id,
  // patient_id) — one account per patient per clinic.
  await knex.schema.createTable('patient_app_accounts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('phone', 20);
    t.string('email', 255);
    t.string('password_hash', 255).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('mfa_enabled').notNullable().defaultTo(false);
    t.string('mfa_secret', 64);
    t.timestamp('last_login_at', { useTz: true });
    t.integer('failed_login_attempts').notNullable().defaultTo(0);
    t.timestamp('locked_until', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['clinic_id', 'patient_id'], { indexName: 'patient_app_accounts_clinic_id_patient_id_unique' });
    t.index(['clinic_id'], 'idx_patient_accounts_clinic');
    t.index(['patient_id'], 'idx_patient_accounts_patient');
    t.index(['phone'], 'idx_patient_accounts_phone');
    t.index(['clinic_id'], 'idx_patient_app_accounts_clinic_id');
    t.index(['clinic_id'], 'patient_app_accounts_clinic_id_index');
  });
  await knex.raw(`
    ALTER TABLE patient_app_accounts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_app_accounts_tenant ON patient_app_accounts
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_patient_app_accounts_updated_at
      BEFORE UPDATE ON patient_app_accounts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION D1 — episodes + clinical_formulations
  // ════════════════════════════════════════════════════════════════════
  //
  // 2 tables. episodes is the foundational clinical thread referenced
  // by ~30 other tables. clinical_formulations is a previously-ghost
  // table materialized here (handler at psychiatristFeatureRoutes.ts:170
  // had `// TODO(Phase F ghost-table)` markers; R2 makes it real).

  // ── episodes (clinical episode threads) ──
  // Verified: id, patient_id, clinic_id, title, episode_number,
  // episode_type, status (default 'open'), presenting_problem,
  // primary_diagnosis, start_date, end_date, closure_reason,
  // closure_summary, team_id, primary_clinician_id (FK staff SET NULL),
  // +ts, deleted_at, discharge_signature_data, discharge_signed_by_id
  // (FK staff SET NULL — added inline), discharge_signed_at,
  // key_worker_id (FK staff SET NULL), specialty_code (FK specialties
  // RESTRICT, default 'mental_health').
  //
  // CRITICAL partial unique: one OPEN episode per (patient_id,
  // episode_type) — prevents creating a second open MH episode while
  // one is still active. Enforced via partial unique index
  // `idx_episodes_one_open_per_type WHERE status = 'open' AND
  // deleted_at IS NULL`.
  //
  // SD-NOTE: discharge_vetting_status, closure_vetting_status, and
  // related vetting columns referenced in episodeRoutes.ts (5 ghost
  // columns) are CURRENTLY NOT in the live DB schema. The R1 code
  // exempt comments document this — R2 baseline preserves the live
  // shape; if the vetting workflow is to be implemented properly, a
  // future migration will add those columns.
  await knex.schema.createTable('episodes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('RESTRICT');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('title', 300);
    t.string('episode_number', 50);
    t.string('episode_type', 50);
    t.string('status', 30).notNullable().defaultTo('open');
    t.text('presenting_problem');
    t.text('primary_diagnosis');
    t.date('start_date').notNullable();
    t.date('end_date');
    t.text('closure_reason');
    t.text('closure_summary');
    t.uuid('team_id'); // No FK constraint in current schema (legacy)
    t.uuid('primary_clinician_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.text('discharge_signature_data');
    t.uuid('discharge_signed_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('discharge_signed_at', { useTz: true });
    t.uuid('key_worker_id').references('id').inTable('staff').onDelete('SET NULL');
    t.string('specialty_code', 40).notNullable().defaultTo('mental_health').references('code').inTable('specialties').onUpdate('CASCADE').onDelete('RESTRICT');
    t.index(['clinic_id', 'patient_id'], 'episodes_clinic_id_patient_id_index');
    t.index(['clinic_id', 'status'], 'episodes_clinic_id_status_index');
    t.index(['patient_id', 'status'], 'episodes_patient_id_status_index');
    t.index(['patient_id', 'specialty_code', 'status'], 'episodes_patient_specialty_status_idx');
    t.index(['primary_clinician_id'], 'episodes_primary_clinician_id_index');
    t.index(['clinic_id'], 'idx_episodes_clinic_id');
    t.index(['key_worker_id'], 'idx_episodes_key_worker_id');
    t.index(['primary_clinician_id'], 'idx_episodes_primary_clinician_id');
  });
  await knex.raw(`
    -- Partial soft-delete index (CLAUDE.md §1.4)
    CREATE INDEX idx_episodes_deleted_at ON episodes (deleted_at)
      WHERE deleted_at IS NULL;
    -- Bare-id partial index for fast NOT-deleted lookups
    CREATE INDEX idx_episodes_not_deleted ON episodes (id)
      WHERE deleted_at IS NULL;
    -- Critical business rule: one OPEN episode per (patient, type)
    CREATE UNIQUE INDEX idx_episodes_one_open_per_type
      ON episodes (patient_id, episode_type)
      WHERE status = 'open' AND deleted_at IS NULL;
    ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_episodes_tenant ON episodes
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_episodes_updated_at
      BEFORE UPDATE ON episodes
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── clinical_formulations (PREVIOUSLY GHOST — materialized by R2) ──
  //
  // R2 promotes this from "ghost-table" status (the handler at
  // apps/api/src/features/roles/psychiatristFeatureRoutes.ts:170 wrote
  // to it but the table didn't exist; flagged as TODO(Phase F)) to a
  // real table.
  //
  // Schema derived from the handler's INSERT payload:
  //   id, clinic_id, patient_id, episode_id, author_id (FK staff),
  //   formulation_type ('5p' default — Presenting/Predisposing/
  //   Precipitating/Perpetuating/Protective), 5 factor columns
  //   (text), summary, diagnostic_formulation, treatment_implications,
  //   shared_with_patient (default false), status (default 'draft'),
  //   created_at, updated_at, deleted_at.
  //
  // Standard tenancy + soft-delete + RLS. The R3 commit will remove
  // the TODO(Phase F) marker from the handler now that the table
  // exists.
  await knex.schema.createTable('clinical_formulations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('author_id').references('id').inTable('staff').onDelete('SET NULL');
    t.string('formulation_type', 50).notNullable().defaultTo('5p');
    t.text('presenting_problem');
    t.text('predisposing_factors');
    t.text('precipitating_factors');
    t.text('perpetuating_factors');
    t.text('protective_factors');
    t.text('summary');
    t.text('diagnostic_formulation');
    t.text('treatment_implications');
    t.boolean('shared_with_patient').notNullable().defaultTo(false);
    t.string('status', 30).notNullable().defaultTo('draft');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['clinic_id'], 'idx_clinical_formulations_clinic_id');
    t.index(['patient_id'], 'idx_clinical_formulations_patient_id');
    t.index(['episode_id'], 'idx_clinical_formulations_episode_id');
  });
  await knex.raw(`
    CREATE INDEX idx_clinical_formulations_deleted_at
      ON clinical_formulations (deleted_at) WHERE deleted_at IS NULL;
    ALTER TABLE clinical_formulations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinical_formulations_tenant ON clinical_formulations
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_clinical_formulations_updated_at
      BEFORE UPDATE ON clinical_formulations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION D2 — clinical_notes + versions + codes
  // ════════════════════════════════════════════════════════════════════
  //
  // 3 tables. clinical_notes is the largest clinical-data table by
  // column count (38 cols + generated tsv + check constraint + optimistic
  // locking via lock_version). clinical_note_versions stores revision
  // snapshots; clinical_note_codes stores ICD/SNOMED tags from regex/AI
  // extractors with a clinician accept/reject workflow.

  // ── clinical_notes (38 cols + tsv + lock + signed CHECK) ──
  // Verified via psql \\d clinical_notes (2026-04-18). 38 logical
  // columns + generated search_tsv.
  // FKs to appointment_id and template_id are DEFERRED to Section N
  // (those tables don't exist yet). Other FKs (patients, episodes,
  // staff, clinic) inline.
  // CHECK clinical_notes_signed_integrity enforces: if status='signed',
  // then signed_at AND signed_by_id are NOT NULL. Builder doesn't
  // express CHECK with expressions; raw required.
  await knex.schema.createTable('clinical_notes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('RESTRICT');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('author_id').references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('appointment_id'); // FK → appointments(id) deferred to Section N
    t.string('title', 500);
    t.string('note_type', 50).notNullable().defaultTo('soap');
    t.string('note_category', 100);
    t.string('source_type', 50);
    t.timestamp('note_date_time', { useTz: true });
    t.date('note_date');
    t.text('content');
    t.text('content_html');
    t.jsonb('structured_fields');
    t.string('status', 30).notNullable().defaultTo('draft');
    t.boolean('is_draft').defaultTo(true);
    t.boolean('is_signed').defaultTo(false);
    t.uuid('template_id'); // FK → templates(id) deferred to Section N
    t.boolean('is_reportable_contact').notNullable().defaultTo(true);
    t.jsonb('contact_meta');
    t.text('foi_content');
    t.boolean('foi_exempt').notNullable().defaultTo(false);
    t.boolean('did_not_attend').notNullable().defaultTo(false);
    t.boolean('is_ai_draft').notNullable().defaultTo(false);
    t.text('soap_subjective');
    t.text('soap_objective');
    t.text('soap_assessment');
    t.text('soap_plan');
    t.uuid('amended_from_id'); // self-FK; deferred to N (or no FK — current schema has none)
    t.timestamp('signed_at', { useTz: true });
    t.uuid('signed_by').references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('signed_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    // search_tsv added below (raw — generated column)
    t.integer('lock_version').notNullable().defaultTo(1);
    t.index(['appointment_id'], 'clinical_notes_appointment_id_index');
    t.index(['clinic_id', 'episode_id'], 'clinical_notes_clinic_id_episode_id_index');
    t.index(['clinic_id', 'note_type'], 'clinical_notes_clinic_id_note_type_index');
    t.index(['clinic_id', 'patient_id'], 'clinical_notes_clinic_id_patient_id_index');
    t.index(['clinic_id', 'status'], 'clinical_notes_clinic_id_status_index');
    t.index(['deleted_at'], 'clinical_notes_deleted_at_index');
    t.index(['author_id'], 'idx_clinical_notes_author_id');
    t.index(['clinic_id'], 'idx_clinical_notes_clinic_id');
    t.index(['episode_id'], 'idx_clinical_notes_episode_id');
    t.index(['signed_by'], 'idx_clinical_notes_signed_by');
    t.index(['signed_by_id'], 'idx_clinical_notes_signed_by_id');
  });
  await knex.raw(`
    -- Generated tsvector for full-text search (Postgres 12+)
    ALTER TABLE clinical_notes ADD COLUMN search_tsv tsvector
      GENERATED ALWAYS AS (
        to_tsvector('english',
          COALESCE(title, '')::text || ' ' ||
          COALESCE(content, '')::text
        )
      ) STORED;

    -- GIN index on the generated tsvector
    CREATE INDEX clinical_notes_search_tsv_gin ON clinical_notes USING gin (search_tsv);

    -- Partial soft-delete indexes (CLAUDE.md §1.4)
    CREATE INDEX idx_clinical_notes_deleted_at ON clinical_notes (deleted_at)
      WHERE deleted_at IS NULL;
    CREATE INDEX idx_clinical_notes_not_deleted ON clinical_notes (id)
      WHERE deleted_at IS NULL;

    -- Signed-integrity CHECK: if signed, signed_at + signed_by_id required
    ALTER TABLE clinical_notes ADD CONSTRAINT clinical_notes_signed_integrity
      CHECK (status::text <> 'signed'::text
             OR (status::text = 'signed'::text
                 AND signed_at IS NOT NULL
                 AND signed_by_id IS NOT NULL));

    ALTER TABLE clinical_notes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinical_notes_tenant ON clinical_notes
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_clinical_notes_updated_at
      BEFORE UPDATE ON clinical_notes
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── clinical_note_versions (revision history) ──
  // Verified: id, note_id (FK clinical_notes CASCADE — added inline now
  // that clinical_notes exists), clinic_id (FK SET NULL), version_number,
  // snapshot (jsonb), edited_by_staff_id (FK SET NULL), edited_at,
  // edit_reason, status_at_snapshot.
  // UNIQUE on (note_id, version_number).
  await knex.schema.createTable('clinical_note_versions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('note_id').notNullable().references('id').inTable('clinical_notes').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('SET NULL');
    t.integer('version_number').notNullable();
    t.jsonb('snapshot').notNullable();
    t.uuid('edited_by_staff_id').notNullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('edited_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('edit_reason');
    t.string('status_at_snapshot', 30);
    t.unique(['note_id', 'version_number'], { indexName: 'clinical_note_versions_note_id_version_number_unique' });
    t.index(['clinic_id'], 'clinical_note_versions_clinic_id_index');
    t.index(['note_id', 'edited_at'], 'clinical_note_versions_note_id_edited_at_index');
    t.index(['clinic_id'], 'idx_clinical_note_versions_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE clinical_note_versions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinical_note_versions_tenant ON clinical_note_versions
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- No updated_at trigger (versions are immutable snapshots).
  `);

  // ── clinical_note_codes (ICD/SNOMED tags from extractors) ──
  // Verified: id, note_id (FK clinical_notes CASCADE), clinic_id,
  // system (max 32), code (max 64), display (text), confidence
  // ('moderate' default), status ('suggested' default), source
  // ('regex_v1' default), source_excerpt, accepted_by_staff_id (FK
  // staff SET NULL), accepted_at, rejected_by_staff_id (FK staff SET
  // NULL), rejected_at, reject_reason, +ts.
  // UNIQUE (note_id, system, code).
  await knex.schema.createTable('clinical_note_codes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('note_id').notNullable().references('id').inTable('clinical_notes').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('system', 32).notNullable();
    t.string('code', 64).notNullable();
    t.text('display').notNullable();
    t.string('confidence', 16).notNullable().defaultTo('moderate');
    t.string('status', 16).notNullable().defaultTo('suggested');
    t.string('source', 32).notNullable().defaultTo('regex_v1');
    t.text('source_excerpt');
    t.uuid('accepted_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('accepted_at', { useTz: true });
    t.uuid('rejected_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('rejected_at', { useTz: true });
    t.text('reject_reason');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['note_id', 'system', 'code'], { indexName: 'clinical_note_codes_note_id_system_code_unique' });
    t.index(['clinic_id'], 'clinical_note_codes_clinic_id_index');
    t.index(['note_id', 'status'], 'clinical_note_codes_note_id_status_index');
  });
  await knex.raw(`
    ALTER TABLE clinical_note_codes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinical_note_codes_tenant ON clinical_note_codes
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_clinical_note_codes_updated_at
      BEFORE UPDATE ON clinical_note_codes
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION D3 — referrals (50 cols + coordinator + SLA + SD44)
  // ════════════════════════════════════════════════════════════════════
  //
  // referrals has 50 columns covering: source/destination, OCR
  // attachments, urgency/status, SLA tracking, coordinator workflow
  // (target_specialty_code + service_request_status + task_status +
  // coordinator_id), and broadcast/auto-close machinery.
  //
  // SD44 resolution: column is `linked_episode_id`, NOT `episode_id`
  // (the historical name code wrote that didn't exist).
  //
  // Two CHECK constraints enforce service_request_status + task_status
  // enum values. Builder doesn't express CHECK with expressions; raw
  // required.
  await knex.schema.createTable('referrals', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('SET NULL');
    t.string('referral_number', 50).notNullable();
    t.date('referral_date').notNullable();
    t.string('source', 50).notNullable().defaultTo('external');
    t.string('from_service', 200).notNullable();
    t.string('from_provider_name', 200);
    t.string('from_provider_phone', 30);
    t.string('from_provider_email', 255);
    t.string('from_provider_prescriber_no', 30);
    t.string('referring_org', 200);
    t.text('reason').notNullable();
    t.text('clinical_summary');
    t.text('current_medications');
    t.text('diagnosis_info');
    t.string('urgency', 30).notNullable().defaultTo('routine');
    t.string('status', 30).notNullable().defaultTo('received');
    t.timestamp('status_changed_at', { useTz: true });
    t.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('assigned_to_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    // SD44: column name is linked_episode_id (FK to episodes); legacy
    // code wrote `episode_id` which didn't exist. Phase 0.7.5 c24-d8 fix.
    t.uuid('linked_episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.boolean('has_attachment').notNullable().defaultTo(false);
    t.jsonb('ocr_extracted');
    t.text('rejection_reason');
    t.string('redirect_to', 200);
    t.date('sla_due_date');
    t.boolean('sla_breached').notNullable().defaultTo(false);
    t.text('internal_notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    // Phase 1 (multi-specialty): coordinator queue + broadcast workflow
    t.string('referral_mode', 20).notNullable().defaultTo('standard');
    t.uuid('target_clinician_id').references('id').inTable('staff').onDelete('SET NULL');
    t.string('distribution_mode', 30);
    t.string('distribution_speciality', 100);
    t.uuid('accepted_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('broadcast_at', { useTz: true });
    t.timestamp('reminder_sent_at', { useTz: true });
    t.timestamp('final_reminder_sent_at', { useTz: true });
    t.timestamp('auto_close_at', { useTz: true });
    t.timestamp('feedback_sent_at', { useTz: true });
    t.text('clarification_notes');
    t.uuid('created_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    // Phase 1 ServiceRequest + Task split + coordinator
    t.string('target_specialty_code', 40).notNullable().defaultTo('mental_health').references('code').inTable('specialties').onUpdate('CASCADE').onDelete('RESTRICT');
    t.string('service_request_status', 20).notNullable().defaultTo('active');
    t.string('task_status', 20).notNullable().defaultTo('requested');
    t.uuid('coordinator_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('triaged_at', { useTz: true });
    t.uuid('triaged_by').references('id').inTable('staff').onDelete('SET NULL');
    // Standard btree indexes
    t.index(['accepted_by_staff_id'], 'idx_referrals_accepted_by_staff_id');
    t.index(['assigned_to_staff_id'], 'idx_referrals_assigned_to');
    t.index(['clinic_id', 'auto_close_at'], 'idx_referrals_auto_close');
    t.index(['clinic_id'], 'idx_referrals_clinic_id');
    t.index(['created_by_staff_id'], 'idx_referrals_created_by_staff_id');
    t.index(['linked_episode_id'], 'idx_referrals_linked_episode_id');
    t.index(['clinic_id', 'referral_mode', 'status'], 'idx_referrals_mode_status');
    t.index(['clinic_id', 'target_clinician_id'], 'idx_referrals_target_clinician');
    t.index(['assigned_to_staff_id'], 'referrals_assigned_to_staff_id_index');
    t.index(['clinic_id', 'patient_id'], 'referrals_clinic_id_patient_id_index');
    t.index(['clinic_id', 'status'], 'referrals_clinic_id_status_index');
    t.index(['referral_number'], 'referrals_referral_number_index');
  });
  await knex.raw(`
    -- Partial soft-delete indexes
    CREATE INDEX idx_referrals_deleted_at ON referrals (deleted_at)
      WHERE deleted_at IS NULL;
    CREATE INDEX idx_referrals_not_deleted ON referrals (id)
      WHERE deleted_at IS NULL;
    -- Coordinator queue hot-path index (partial — non-deleted only)
    CREATE INDEX referrals_coordinator_queue_idx
      ON referrals (clinic_id, target_specialty_code, task_status)
      WHERE deleted_at IS NULL;
    -- Two CHECK constraints enforcing the enum values
    ALTER TABLE referrals ADD CONSTRAINT referrals_service_request_status_check
      CHECK (service_request_status IN ('draft', 'active', 'revoked', 'completed'));
    ALTER TABLE referrals ADD CONSTRAINT referrals_task_status_check
      CHECK (task_status IN ('requested', 'received', 'accepted', 'rejected', 'in_progress', 'completed'));
    ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_referrals_tenant ON referrals
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_referrals_updated_at
      BEFORE UPDATE ON referrals
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION D4 — consultations + diagnoses + 5 referral support tables
  // ════════════════════════════════════════════════════════════════════
  //
  // 7 tables. Closes Section D (clinical core).

  // ── consultations (encounter records; clinical data) ──
  // Verified: id, clinic_id, patient_id, episode_id, clinician_id (FK
  // staff RESTRICT), encounter_date, encounter_type ('consultation'
  // default), duration_minutes, presenting_complaints, mse (jsonb —
  // mental state exam), plan_text, note_id (no FK in current schema —
  // soft pointer to clinical_notes), status, +ts.
  await knex.schema.createTable('consultations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('clinician_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.timestamp('encounter_date', { useTz: true }).notNullable();
    t.string('encounter_type', 50).notNullable().defaultTo('consultation');
    t.integer('duration_minutes');
    t.text('presenting_complaints');
    t.jsonb('mse');
    t.text('plan_text');
    t.uuid('note_id'); // soft pointer to clinical_notes (no FK in current schema)
    t.string('status', 30).notNullable().defaultTo('draft');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['clinic_id', 'patient_id'], 'consultations_clinic_id_patient_id_index');
    t.index(['clinician_id'], 'consultations_clinician_id_index');
    t.index(['patient_id'], 'consultations_patient_id_idx');
    t.index(['clinic_id'], 'idx_consultations_clinic_id');
    t.index(['clinician_id'], 'idx_consultations_clinician_id');
    t.index(['episode_id'], 'idx_consultations_episode_id');
  });
  await knex.raw(`
    CREATE INDEX idx_consultations_deleted_at ON consultations (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_consultations_tenant ON consultations
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_consultations_updated_at
      BEFORE UPDATE ON consultations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── diagnoses (ICD-coded patient diagnoses) ──
  // Verified: id, clinic_id, patient_id, episode_id, created_by_id
  // (FK staff RESTRICT), icd_code (max 20), description (max 500),
  // diagnosed_date, status ('active' default), is_primary, notes, +ts.
  await knex.schema.createTable('diagnoses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('created_by_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.string('icd_code', 20).notNullable();
    t.string('description', 500).notNullable();
    t.date('diagnosed_date').notNullable();
    t.string('status', 30).notNullable().defaultTo('active');
    t.boolean('is_primary').notNullable().defaultTo(false);
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['clinic_id', 'patient_id'], 'diagnoses_clinic_id_patient_id_index');
    t.index(['patient_id', 'status'], 'diagnoses_patient_id_status_index');
    t.index(['clinic_id'], 'idx_diagnoses_clinic_id');
    t.index(['created_by_id'], 'idx_diagnoses_created_by_id');
    t.index(['episode_id'], 'idx_diagnoses_episode_id');
  });
  await knex.raw(`
    CREATE INDEX idx_diagnoses_deleted_at ON diagnoses (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE diagnoses ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_diagnoses_tenant ON diagnoses
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_diagnoses_updated_at
      BEFORE UPDATE ON diagnoses
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── referral_attachments (OCR'd referral letters + scans) ──
  await knex.schema.createTable('referral_attachments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('referral_id').notNullable().references('id').inTable('referrals').onDelete('CASCADE');
    t.string('original_filename', 500).notNullable();
    t.string('stored_filename', 500).notNullable();
    t.string('mime_type', 100).notNullable();
    t.bigInteger('file_size_bytes').notNullable();
    t.string('storage_key', 500).notNullable();
    t.string('category', 50).notNullable().defaultTo('referral');
    t.string('ocr_status', 30).notNullable().defaultTo('pending');
    t.jsonb('ocr_result');
    t.text('ocr_error_message');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['clinic_id'], 'idx_referral_attachments_clinic_id');
    t.index(['referral_id'], 'referral_attachments_referral_id_index');
  });
  await knex.raw(`
    CREATE INDEX idx_referral_attachments_deleted_at ON referral_attachments (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE referral_attachments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_referral_attachments_tenant ON referral_attachments
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- No updated_at trigger in current schema for this table.
  `);

  // ── referral_clinician_offers (broadcast referral acceptance/decline) ──
  // Tracks which clinicians were offered a referral and their response.
  // UNIQUE (referral_id, staff_id) — one offer per staff per referral.
  await knex.schema.createTable('referral_clinician_offers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('referral_id').notNullable().references('id').inTable('referrals').onDelete('CASCADE');
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.timestamp('offered_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('response', 20).notNullable().defaultTo('pending');
    t.timestamp('responded_at', { useTz: true });
    t.text('decline_reason');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['referral_id', 'staff_id'], { indexName: 'uq_offer_referral_staff' });
    t.index(['clinic_id', 'referral_id'], 'idx_offers_clinic_referral');
    t.index(['clinic_id', 'staff_id', 'response'], 'idx_offers_staff_response');
    t.index(['clinic_id'], 'idx_referral_clinician_offers_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE referral_clinician_offers ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_referral_clinician_offers_tenant ON referral_clinician_offers
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_referral_clinician_offers_updated_at
      BEFORE UPDATE ON referral_clinician_offers
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── referral_feedback_log (outbound emails to GP/source provider) ──
  await knex.schema.createTable('referral_feedback_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('referral_id').notNullable().references('id').inTable('referrals').onDelete('CASCADE');
    t.string('feedback_type', 30).notNullable();
    t.string('recipient_email', 255).notNullable();
    t.timestamp('sent_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('message_body');
    t.uuid('sent_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.string('delivery_status', 20).notNullable().defaultTo('queued');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id', 'referral_id'], 'idx_feedback_log_clinic_referral');
    t.index(['clinic_id'], 'idx_referral_feedback_log_clinic_id');
    t.index(['sent_by_staff_id'], 'idx_referral_feedback_log_sent_by_staff_id');
  });
  await knex.raw(`
    ALTER TABLE referral_feedback_log ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_referral_feedback_log_tenant ON referral_feedback_log
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- No updated_at trigger; rows are append-only audit records.
  `);

  // ── referral_state_transitions (audit trail for task_status changes) ──
  // Append-only audit log; created_at is the only timestamp.
  await knex.schema.createTable('referral_state_transitions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('referral_id').notNullable().references('id').inTable('referrals').onDelete('CASCADE');
    t.string('from_task_status', 20);
    t.string('to_task_status', 20).notNullable();
    t.uuid('actor_id').references('id').inTable('staff').onDelete('SET NULL');
    t.text('reason');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_referral_state_transitions_clinic_id');
    t.index(['clinic_id'], 'referral_state_transitions_clinic_id_index');
    t.index(['clinic_id', 'referral_id', 'created_at'], 'referral_state_transitions_clinic_id_referral_id_created_at_ind');
    t.index(['referral_id'], 'referral_state_transitions_referral_id_index');
  });
  await knex.raw(`
    ALTER TABLE referral_state_transitions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_referral_state_transitions_tenant ON referral_state_transitions
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- Append-only; no updated_at trigger.
  `);

  // ── referral_workflow_events (workflow event log; bigserial PK) ──
  // ONLY table in the schema using a bigint+sequence PK (not uuid).
  // Preserved for byte-compat with the archived migration.
  // updated_at NULLABLE.
  await knex.schema.createTable('referral_workflow_events', (t) => {
    t.bigIncrements('id');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('referral_id').notNullable().references('id').inTable('referrals').onDelete('CASCADE');
    t.string('event_type', 50).notNullable();
    t.uuid('performed_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.text('notes');
    t.string('outcome', 100);
    t.timestamp('event_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()); // nullable
    t.index(['clinic_id'], 'idx_referral_workflow_events_clinic_id');
    t.index(['performed_by_staff_id'], 'idx_referral_workflow_events_performed_by_staff_id');
    t.index(['referral_id', 'event_at'], 'referral_workflow_events_referral_id_event_at_index');
  });
  await knex.raw(`
    ALTER TABLE referral_workflow_events ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_referral_workflow_events_tenant ON referral_workflow_events
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_referral_workflow_events_updated_at
      BEFORE UPDATE ON referral_workflow_events
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION E1 — drug_products + patient_medications + patient_med_reminders
  // ════════════════════════════════════════════════════════════════════
  //
  // 3 tables. drug_products is the per-clinic formulary; the other two
  // depend on it. clozapine + LAI + AIMS land in subsequent E2/E3/E4
  // commits.

  // ── drug_products (per-clinic formulary) ──
  // Verified: id, clinic_id (FK SET NULL), generic_name, brand_name,
  // form, strength, unit, route ('oral' default), schedule, pbs_code,
  // pbs_listed, is_authority_required, is_controlled, atc_code,
  // drug_class, is_lai, is_clozapine, contraindications,
  // common_interactions (jsonb default '[]'), monitoring_requirements,
  // dose_range, data_source ('MIMS' default), is_active, +ts.
  await knex.schema.createTable('drug_products', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('SET NULL');
    t.string('generic_name', 300).notNullable();
    t.string('brand_name', 300);
    t.string('form', 100);
    t.string('strength', 100);
    t.string('unit', 50);
    t.string('route', 50).notNullable().defaultTo('oral');
    t.string('schedule', 20);
    t.string('pbs_code', 20);
    t.boolean('pbs_listed').notNullable().defaultTo(false);
    t.boolean('is_authority_required').notNullable().defaultTo(false);
    t.boolean('is_controlled').notNullable().defaultTo(false);
    t.string('atc_code', 20);
    t.string('drug_class', 100);
    t.boolean('is_lai').notNullable().defaultTo(false);
    t.boolean('is_clozapine').notNullable().defaultTo(false);
    t.text('contraindications');
    t.jsonb('common_interactions').notNullable().defaultTo('[]');
    t.text('monitoring_requirements');
    t.string('dose_range', 100);
    t.string('data_source', 50).notNullable().defaultTo('MIMS');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['generic_name'], 'drug_products_generic_name_index');
    t.index(['is_active'], 'drug_products_is_active_index');
    t.index(['clinic_id'], 'idx_drug_products_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE drug_products ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_drug_products_tenant ON drug_products
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_drug_products_updated_at
      BEFORE UPDATE ON drug_products
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── patient_medications (the core med list) ──
  // Verified via psql \\d patient_medications (2026-04-18). 33 cols
  // + status CHECK constraint.
  // Phase 1 multi-specialty: prescribed_by_specialty_code (FK specialties)
  // + category — both nullable, used for cross-specialty filtering.
  await knex.schema.createTable('patient_medications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('RESTRICT');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('drug_product_id').references('id').inTable('drug_products').onDelete('SET NULL');
    t.string('drug_code', 50);
    t.string('drug_label', 300).notNullable();
    t.string('generic_name', 300);
    t.string('brand_name', 300);
    t.string('dose', 100).notNullable();
    t.string('dose_unit', 50);
    t.string('route', 50).notNullable().defaultTo('oral');
    t.string('frequency', 100).notNullable();
    t.text('instructions');
    t.text('indication');
    t.date('start_date');
    t.date('end_date');
    t.string('status', 30).notNullable().defaultTo('active');
    t.text('reason_for_cessation');
    t.boolean('is_regular').notNullable().defaultTo(true);
    t.boolean('is_prn').notNullable().defaultTo(false);
    t.boolean('is_lai').notNullable().defaultTo(false);
    t.jsonb('taper_schedule');
    t.string('source', 30).notNullable().defaultTo('manual');
    t.uuid('prescribed_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('recorded_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    // Phase 1 multi-specialty
    t.string('prescribed_by_specialty_code', 40).references('code').inTable('specialties').onUpdate('CASCADE').onDelete('SET NULL');
    t.string('category', 60);
    // Indexes
    t.index(['clinic_id'], 'idx_patient_medications_clinic_id');
    t.index(['drug_product_id'], 'idx_patient_medications_drug_product_id');
    t.index(['episode_id'], 'idx_patient_medications_episode_id');
    t.index(['prescribed_by_staff_id'], 'idx_patient_medications_prescribed_by_staff_id');
    t.index(['recorded_by_staff_id'], 'idx_patient_medications_recorded_by_staff_id');
    t.index(['clinic_id', 'patient_id'], 'patient_medications_clinic_id_patient_id_index');
    t.index(['patient_id', 'status'], 'patient_medications_patient_id_status_index');
  });
  await knex.raw(`
    -- Partial soft-delete + non-deleted indexes
    CREATE INDEX idx_patient_medications_deleted_at ON patient_medications (deleted_at)
      WHERE deleted_at IS NULL;
    CREATE INDEX idx_patient_medications_not_deleted ON patient_medications (id)
      WHERE deleted_at IS NULL;
    -- Specialty + category partial composites for cross-specialty filtering
    CREATE INDEX patient_medications_category_idx
      ON patient_medications (clinic_id, category) WHERE deleted_at IS NULL;
    CREATE INDEX patient_medications_specialty_idx
      ON patient_medications (clinic_id, prescribed_by_specialty_code) WHERE deleted_at IS NULL;
    -- Status enum CHECK (raw — Knex builder doesn't express CHECK with enum lists)
    ALTER TABLE patient_medications ADD CONSTRAINT patient_medications_status_valid
      CHECK (status IN ('active', 'ceased', 'ceased_discontinued', 'paused', 'draft'));
    ALTER TABLE patient_medications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_medications_tenant ON patient_medications
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_patient_medications_updated_at
      BEFORE UPDATE ON patient_medications
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── patient_med_reminders (Viva mobile-app medication reminders) ──
  // Verified: id, clinic_id, patient_id, medication_id (FK
  // patient_medications), drug_name, dose, instructions, days_of_week
  // (integer[] default '{1,2,3,4,5,6,7}'), reminder_time (time WITHOUT
  // TZ default '08:00:00'), is_active, created_by (FK staff), +ts.
  // Note: medication_id FK has no cascade qualifier in current schema.
  await knex.schema.createTable('patient_med_reminders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
    t.uuid('patient_id').notNullable().references('id').inTable('patients');
    t.uuid('medication_id').references('id').inTable('patient_medications');
    t.string('drug_name', 255).notNullable();
    t.string('dose', 100);
    t.text('instructions').notNullable();
    t.specificType('days_of_week', 'integer[]').notNullable().defaultTo(knex.raw("'{1,2,3,4,5,6,7}'::integer[]"));
    t.time('reminder_time').notNullable().defaultTo(knex.raw("'08:00:00'::time"));
    t.boolean('is_active').notNullable().defaultTo(true);
    t.uuid('created_by').references('id').inTable('staff');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_med_reminders_clinic');
    t.index(['patient_id'], 'idx_med_reminders_patient');
    t.index(['clinic_id'], 'idx_patient_med_reminders_clinic_id');
    t.index(['created_by'], 'idx_patient_med_reminders_created_by');
    t.index(['medication_id'], 'idx_patient_med_reminders_medication_id');
    t.index(['clinic_id'], 'patient_med_reminders_clinic_id_index');
    t.index(['patient_id'], 'patient_med_reminders_patient_id_index');
  });
  await knex.raw(`
    ALTER TABLE patient_med_reminders ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_med_reminders_tenant ON patient_med_reminders
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_patient_med_reminders_updated_at
      BEFORE UPDATE ON patient_med_reminders
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION E2 — prescriptions
  // ════════════════════════════════════════════════════════════════════
  //
  // 35 cols. Distinct from patient_medications: prescriptions are
  // legally signed paper/electronic scripts dispatched to pharmacy;
  // patient_medications is the clinical med list. Links via
  // patient_medication_id (SET NULL on med delete).
  //
  // safescript_* fields: integration with Victorian SafeScript
  // controlled-substance check service.
  // erx_*: integration with eRx Script Exchange (Australian e-script).
  //
  // CHECK constraint enforces prescription_category enum.
  await knex.schema.createTable('prescriptions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('RESTRICT');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('drug_product_id').references('id').inTable('drug_products').onDelete('SET NULL');
    t.uuid('prescribed_by_staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.uuid('patient_medication_id').references('id').inTable('patient_medications').onDelete('SET NULL');
    t.string('generic_name', 300).notNullable();
    t.string('brand_name', 300);
    t.string('dose', 100).notNullable();
    t.string('route', 50).notNullable();
    t.string('frequency', 100).notNullable();
    t.text('directions');
    t.integer('quantity').notNullable();
    t.integer('repeats').notNullable().defaultTo(0);
    t.string('pbs_item_code', 20);
    t.boolean('is_authority').notNullable().defaultTo(false);
    t.string('authority_code', 50);
    t.boolean('is_s8').notNullable().defaultTo(false);
    t.string('prescription_type', 30).notNullable().defaultTo('standard');
    t.string('status', 30).notNullable().defaultTo('draft');
    t.boolean('safescript_checked').notNullable().defaultTo(false);
    t.timestamp('safescript_checked_at', { useTz: true });
    t.jsonb('safescript_result');
    t.string('erx_token', 200);
    t.string('erx_dsp_id', 100);
    t.timestamp('erx_submitted_at', { useTz: true });
    t.boolean('is_electronic').notNullable().defaultTo(true);
    t.date('prescribed_date').notNullable();
    t.date('expires_at');
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.string('prescription_category', 30).notNullable().defaultTo('outpatient');
    t.index(['clinic_id'], 'idx_prescriptions_clinic_id');
    t.index(['drug_product_id'], 'idx_prescriptions_drug_product_id');
    t.index(['episode_id'], 'idx_prescriptions_episode_id');
    t.index(['patient_medication_id'], 'idx_prescriptions_patient_medication_id');
    t.index(['prescribed_by_staff_id'], 'idx_prescriptions_prescribed_by');
    t.index(['clinic_id', 'patient_id'], 'prescriptions_clinic_id_patient_id_index');
    t.index(['patient_id'], 'prescriptions_patient_id_idx');
    t.index(['prescribed_by_staff_id'], 'prescriptions_prescribed_by_staff_id_index');
    t.index(['status'], 'prescriptions_status_index');
  });
  await knex.raw(`
    CREATE INDEX idx_prescriptions_deleted_at ON prescriptions (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE prescriptions ADD CONSTRAINT prescriptions_prescription_category_check
      CHECK (prescription_category IN ('outpatient', 'inpatient', 'discharge'));
    ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_prescriptions_tenant ON prescriptions
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_prescriptions_updated_at
      BEFORE UPDATE ON prescriptions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION E3 — clozapine cluster (6 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // 6 tables. clozapine_registrations is the parent; the other 5 cascade
  // on registration delete. Encodes the strict monitoring protocol
  // required for clozapine prescribing (ANC monitoring, titration,
  // observations, monitoring checks).

  // ── clozapine_registrations (parent registration) ──
  await knex.schema.createTable('clozapine_registrations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('drug_product_id').references('id').inTable('drug_products').onDelete('SET NULL');
    t.uuid('prescriber_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.date('registration_date').notNullable();
    t.string('dispenser_pharmacy', 200);
    t.decimal('current_dose_mg', 8, 2);
    t.string('titration_phase', 30).notNullable().defaultTo('initiation');
    t.integer('monitoring_week');
    t.string('monitoring_frequency', 30).notNullable().defaultTo('weekly');
    t.date('last_anc_date');
    t.decimal('last_anc_value', 8, 2);
    t.string('anc_status', 30).notNullable().defaultTo('unknown');
    t.date('last_wbc_date');
    t.decimal('last_wbc_value', 8, 2);
    t.date('next_blood_due_date');
    t.date('physical_health_check_due');
    t.date('ceased_date');
    t.text('ceased_reason');
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['patient_id'], 'clozapine_registrations_patient_id_idx');
    t.index(['clinic_id'], 'idx_clozapine_registrations_clinic_id');
    t.index(['drug_product_id'], 'idx_clozapine_registrations_drug_product_id');
    t.index(['episode_id'], 'idx_clozapine_registrations_episode_id');
    t.index(['prescriber_staff_id'], 'idx_clozapine_registrations_prescriber_staff_id');
  });
  await knex.raw(`
    CREATE INDEX idx_clozapine_registrations_deleted_at ON clozapine_registrations (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE clozapine_registrations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clozapine_registrations_tenant ON clozapine_registrations
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_clozapine_registrations_updated_at
      BEFORE UPDATE ON clozapine_registrations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── clozapine_blood_results (ANC + WBC monitoring) ──
  await knex.schema.createTable('clozapine_blood_results', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('registration_id').notNullable().references('id').inTable('clozapine_registrations').onDelete('CASCADE');
    t.uuid('recorded_by_staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.date('collection_date').notNullable();
    t.date('resulted_date');
    t.decimal('anc_value', 8, 2);
    t.decimal('wbc_value', 8, 2);
    t.decimal('neutrophils_pct', 8, 2);
    t.string('anc_status', 30).notNullable().defaultTo('unknown');
    t.boolean('flag_raised').notNullable().defaultTo(false);
    t.string('flag_type', 50);
    t.string('lab_name', 200);
    t.string('lab_reference', 100);
    t.text('clinical_notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['patient_id', 'collection_date'], 'clozapine_blood_results_patient_id_collection_date_index');
    t.index(['registration_id'], 'clozapine_blood_results_registration_id_index');
    t.index(['clinic_id'], 'idx_clozapine_blood_results_clinic_id');
    t.index(['recorded_by_staff_id'], 'idx_clozapine_blood_results_recorded_by_staff_id');
  });
  await knex.raw(`
    CREATE INDEX idx_clozapine_blood_results_deleted_at ON clozapine_blood_results (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE clozapine_blood_results ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clozapine_blood_results_tenant ON clozapine_blood_results
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_clozapine_blood_results_updated_at
      BEFORE UPDATE ON clozapine_blood_results
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── clozapine_titration_days (week 1-4 dose escalation schedule) ──
  // UNIQUE (registration_id, day_number).
  await knex.schema.createTable('clozapine_titration_days', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('registration_id').notNullable().references('id').inTable('clozapine_registrations').onDelete('CASCADE');
    t.integer('day_number').notNullable();
    t.date('titration_date').notNullable();
    t.decimal('morning_dose_mg', 6, 1);
    t.decimal('evening_dose_mg', 6, 1);
    t.string('prescriber_initials', 10);
    t.uuid('prescribed_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.text('comments');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['registration_id', 'day_number'], { indexName: 'clozapine_titration_days_registration_id_day_number_unique' });
    t.index(['clinic_id', 'registration_id'], 'clozapine_titration_days_clinic_id_registration_id_index');
    t.index(['clinic_id'], 'idx_clozapine_titration_days_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE clozapine_titration_days ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clozapine_titration_days_tenant ON clozapine_titration_days
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_clozapine_titration_days_updated_at
      BEFORE UPDATE ON clozapine_titration_days
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── clozapine_administrations (per-dose admin log; morning + evening) ──
  // CHECK enforces time_slot ('morning'/'evening') and non_admin_code
  // (single-letter codes per the clozapine SOP: A=Absent, F=Fasting,
  // R=Refused, V=Vomited, L=Late, N=NBM, W=Withheld, S=Sleeping).
  await knex.schema.createTable('clozapine_administrations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('registration_id').notNullable().references('id').inTable('clozapine_registrations').onDelete('CASCADE');
    t.uuid('titration_day_id').references('id').inTable('clozapine_titration_days').onDelete('SET NULL');
    t.date('administration_date').notNullable();
    t.string('time_slot', 10).notNullable();
    t.string('actual_time', 5);
    t.decimal('dose_mg', 6, 1).notNullable();
    t.boolean('administered').notNullable().defaultTo(true);
    t.string('non_admin_code', 2);
    t.uuid('administered_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.string('administrator_initials', 10);
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id', 'registration_id', 'administration_date'], 'clozapine_administrations_clinic_id_registration_id_administrat');
    t.index(['clinic_id'], 'idx_clozapine_administrations_clinic_id');
    t.index(['titration_day_id'], 'idx_clozapine_administrations_titration_day_id');
  });
  await knex.raw(`
    ALTER TABLE clozapine_administrations ADD CONSTRAINT clozapine_administrations_time_slot_check
      CHECK (time_slot IN ('morning', 'evening'));
    ALTER TABLE clozapine_administrations ADD CONSTRAINT clozapine_administrations_non_admin_code_check
      CHECK (non_admin_code IS NULL OR non_admin_code IN ('A', 'F', 'R', 'V', 'L', 'N', 'W', 'S'));
    ALTER TABLE clozapine_administrations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clozapine_administrations_tenant ON clozapine_administrations
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- No updated_at trigger; per-admin records are append-only.
  `);

  // ── clozapine_monitoring_checks (LFTs, lipids, ECG, etc.) ──
  // UNIQUE (registration_id, investigation, check_point) — one of each
  // investigation per check_point ('baseline' / '6mo' / '12mo' etc.).
  // CHECK enforces result_status enum.
  await knex.schema.createTable('clozapine_monitoring_checks', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('registration_id').notNullable().references('id').inTable('clozapine_registrations').onDelete('CASCADE');
    t.string('investigation', 80).notNullable();
    t.string('check_point', 30).notNullable();
    t.date('check_date');
    t.string('result_status', 20);
    t.text('result_value');
    t.text('notes');
    t.uuid('recorded_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['registration_id', 'investigation', 'check_point'], { indexName: 'clozapine_monitoring_checks_registration_id_investigation_check' });
    t.index(['clinic_id', 'registration_id', 'check_point'], 'clozapine_monitoring_checks_clinic_id_registration_id_check_poi');
    t.index(['clinic_id'], 'idx_clozapine_monitoring_checks_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE clozapine_monitoring_checks ADD CONSTRAINT clozapine_monitoring_checks_result_status_check
      CHECK (result_status IS NULL OR result_status IN ('normal', 'abnormal', 'pending', 'not_required'));
    ALTER TABLE clozapine_monitoring_checks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clozapine_monitoring_checks_tenant ON clozapine_monitoring_checks
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- No updated_at trigger; checks are append-only.
  `);

  // ── clozapine_observations (vitals + smoking status during titration) ──
  // Smoking status matters because nicotine induces CYP1A2 (clozapine
  // metabolism); change in smoking → potential dose adjustment.
  await knex.schema.createTable('clozapine_observations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('registration_id').notNullable().references('id').inTable('clozapine_registrations').onDelete('CASCADE');
    t.date('observation_date').notNullable();
    t.string('observation_time', 5);
    t.decimal('temperature', 4, 1);
    t.integer('pulse');
    t.integer('bp_systolic_lying');
    t.integer('bp_diastolic_lying');
    t.integer('bp_systolic_standing');
    t.integer('bp_diastolic_standing');
    t.integer('respiration_rate');
    t.string('smoking_status', 30);
    t.integer('cigarettes_per_day');
    t.boolean('outside_normal').notNullable().defaultTo(false);
    t.text('notes');
    t.uuid('recorded_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id', 'registration_id', 'observation_date'], 'clozapine_observations_clinic_id_registration_id_observation_da');
    t.index(['clinic_id'], 'idx_clozapine_observations_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE clozapine_observations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clozapine_observations_tenant ON clozapine_observations
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- No updated_at trigger; observations are append-only.
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION E4 — LAI cluster + AIMS + side_effect_schedules (closes Section E)
  // ════════════════════════════════════════════════════════════════════
  //
  // 5 tables. lai_given has DUPLICATE columns (lai_schedule_id +
  // schedule_id, administered_by_staff_id + administered_by_id,
  // dose_given_mg + dose_given) — preserved for byte-compat per the
  // archived migrations. side_effect_schedules is a previously-ghost
  // table materialised by R2.

  // ── lai_schedules (LAI prescription schedule) ──
  // 32 cols. Tracks schedule, doses, AIMS due dates, oral overlap.
  await knex.schema.createTable('lai_schedules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('drug_product_id').references('id').inTable('drug_products').onDelete('SET NULL');
    t.uuid('prescriber_staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.string('drug_name', 300).notNullable();
    t.string('dose_mg', 50).notNullable();
    t.integer('frequency_days').notNullable().defaultTo(28);
    t.string('injection_site', 50).notNullable().defaultTo('gluteal');
    t.string('injection_technique', 20).notNullable().defaultTo('IM');
    t.string('needle_gauge', 20);
    t.text('indication');
    t.boolean('loading_dose_required').notNullable().defaultTo(false);
    t.integer('loading_doses_required').notNullable().defaultTo(0);
    t.integer('loading_doses_given').notNullable().defaultTo(0);
    t.boolean('oral_overlap_required').notNullable().defaultTo(false);
    t.date('oral_overlap_end_date');
    t.date('start_date').notNullable();
    t.date('first_due_date').notNullable();
    t.date('next_due_date');
    t.date('last_given_date');
    t.date('end_date');
    t.integer('baseline_aims_score');
    t.date('last_aims_date');
    t.date('next_aims_due_date');
    t.string('status', 30).notNullable().defaultTo('active');
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['clinic_id'], 'idx_lai_schedules_clinic_id');
    t.index(['drug_product_id'], 'idx_lai_schedules_drug_product_id');
    t.index(['episode_id'], 'idx_lai_schedules_episode_id');
    t.index(['prescriber_staff_id'], 'idx_lai_schedules_prescriber_staff_id');
    t.index(['clinic_id', 'patient_id'], 'lai_schedules_clinic_id_patient_id_index');
    t.index(['next_due_date'], 'lai_schedules_next_due_date_index');
    t.index(['patient_id', 'status'], 'lai_schedules_patient_id_status_index');
  });
  await knex.raw(`
    CREATE INDEX idx_lai_schedules_deleted_at ON lai_schedules (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE lai_schedules ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_lai_schedules_tenant ON lai_schedules
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_lai_schedules_updated_at
      BEFORE UPDATE ON lai_schedules
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── lai_given (per-injection administration log; duplicate cols) ──
  // CRITICAL byte-compat note: this table has 3 sets of duplicate
  // columns from a partial migration that was never completed:
  //   - lai_schedule_id (canonical) + schedule_id (legacy)
  //   - administered_by_staff_id (canonical) + administered_by_id (legacy)
  //   - dose_given_mg (canonical) + dose_given (legacy)
  // R2 preserves both; the canonical Row interface in
  // laiRepository.ts uses canonical names. R3 commits will eventually
  // deprecate the legacy columns once all callers migrate.
  await knex.schema.createTable('lai_given', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('lai_schedule_id').notNullable().references('id').inTable('lai_schedules').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('administered_by_staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    // Legacy duplicate columns (no FK on schedule_id; admin_by_id has none either)
    t.uuid('schedule_id'); // legacy duplicate of lai_schedule_id
    t.uuid('administered_by_id'); // legacy duplicate of administered_by_staff_id
    t.string('outcome', 30).notNullable().defaultTo('given');
    t.date('given_date').notNullable();
    t.string('dose_given_mg', 50);
    t.string('dose_given', 50); // legacy duplicate of dose_given_mg
    t.string('injection_site', 50);
    t.string('batch_number', 100);
    t.date('expires_at');
    t.string('refusal_reason', 300);
    t.date('deferred_to_date');
    t.date('next_due_date');
    t.boolean('aims_due').defaultTo(false);
    t.boolean('aims_completed').defaultTo(false);
    t.uuid('aims_response_id');
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['administered_by_staff_id'], 'idx_lai_given_administered_by_staff_id');
    t.index(['clinic_id'], 'idx_lai_given_clinic_id');
    t.index(['lai_schedule_id'], 'lai_given_lai_schedule_id_index');
    t.index(['patient_id', 'given_date'], 'lai_given_patient_id_given_date_index');
  });
  await knex.raw(`
    CREATE INDEX idx_lai_given_deleted_at ON lai_given (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE lai_given ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_lai_given_tenant ON lai_given
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_lai_given_updated_at
      BEFORE UPDATE ON lai_given
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── lai_validations (clinician approval to continue LAI) ──
  // 6-monthly review record. CHECK on outcome + validation_type enums.
  await knex.schema.createTable('lai_validations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('lai_schedule_id').notNullable().references('id').inTable('lai_schedules').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('validated_by_staff_id').notNullable().references('id').inTable('staff').onDelete('SET NULL');
    t.date('validation_date').notNullable();
    t.date('valid_until').notNullable();
    t.string('validation_type', 30).notNullable();
    t.string('outcome', 20).notNullable().defaultTo('approved');
    t.text('clinical_rationale');
    t.text('side_effects_reviewed');
    t.boolean('consent_confirmed').notNullable().defaultTo(false);
    t.boolean('blood_tests_reviewed').notNullable().defaultTo(false);
    t.boolean('aims_reviewed').notNullable().defaultTo(false);
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_lai_validations_clinic_id');
    t.index(['clinic_id', 'lai_schedule_id'], 'lai_validations_clinic_id_lai_schedule_id_index');
    t.index(['clinic_id', 'patient_id'], 'lai_validations_clinic_id_patient_id_index');
    t.index(['clinic_id', 'valid_until'], 'lai_validations_clinic_id_valid_until_index');
  });
  await knex.raw(`
    ALTER TABLE lai_validations ADD CONSTRAINT lai_validations_outcome_check
      CHECK (outcome IN ('approved', 'modified', 'ceased'));
    ALTER TABLE lai_validations ADD CONSTRAINT lai_validations_validation_type_check
      CHECK (validation_type IN ('initial', 'routine', 'gap_restart'));
    ALTER TABLE lai_validations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_lai_validations_tenant ON lai_validations
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- Append-only; no updated_at trigger.
  `);

  // ── aims_assessments (Abnormal Involuntary Movement Scale) ──
  // Standard antipsychotic safety assessment. Linked to lai_schedule
  // (SET NULL) so AIMS can outlive the schedule.
  await knex.schema.createTable('aims_assessments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('lai_schedule_id').references('id').inTable('lai_schedules').onDelete('SET NULL');
    t.uuid('assessed_by_staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.date('assessment_date').notNullable();
    t.jsonb('item_scores').notNullable().defaultTo('{}');
    t.integer('total_score');
    t.string('interpretation', 100);
    t.integer('global_severity');
    t.integer('incapacitation');
    t.integer('patient_awareness');
    t.boolean('current_dental_problems').notNullable().defaultTo(false);
    t.boolean('dentures').notNullable().defaultTo(false);
    t.text('clinical_notes');
    t.boolean('is_baseline').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['lai_schedule_id'], 'aims_assessments_lai_schedule_id_index');
    t.index(['patient_id', 'assessment_date'], 'aims_assessments_patient_id_assessment_date_index');
    t.index(['assessed_by_staff_id'], 'idx_aims_assessments_assessed_by_staff_id');
    t.index(['clinic_id'], 'idx_aims_assessments_clinic_id');
  });
  await knex.raw(`
    CREATE INDEX idx_aims_assessments_deleted_at ON aims_assessments (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE aims_assessments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_aims_assessments_tenant ON aims_assessments
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_aims_assessments_updated_at
      BEFORE UPDATE ON aims_assessments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── side_effect_schedules (PREVIOUSLY GHOST — materialised by R2) ──
  //
  // R2 promotes this from "ghost-table" status (handlers at
  // psychiatristFeatureRoutes.ts and crossRoleFeatureRoutes.ts wrote
  // to it but the table didn't exist) to a real table.
  //
  // Schema derived from the handler INSERT payload:
  //   id, clinic_id, patient_id, patient_medication_id (nullable, FK
  //   patient_medications SET NULL), schedule_type, frequency_weeks,
  //   next_due_date, parameters (jsonb), notes, status, created_by_id
  //   (FK staff), last_completed_date, +ts.
  //
  // Used for AIMS + metabolic monitoring scheduling per medication.
  // The R3 commit will remove the TODO(Phase F) markers from the
  // handler now that the table exists.
  await knex.schema.createTable('side_effect_schedules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('patient_medication_id').references('id').inTable('patient_medications').onDelete('SET NULL');
    t.string('schedule_type', 50).notNullable();
    t.integer('frequency_weeks').notNullable().defaultTo(4);
    t.date('next_due_date');
    t.date('last_completed_date');
    t.jsonb('parameters').notNullable().defaultTo('{}');
    t.text('notes');
    t.string('status', 30).notNullable().defaultTo('active');
    t.uuid('created_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_side_effect_schedules_clinic_id');
    t.index(['patient_id'], 'idx_side_effect_schedules_patient_id');
    t.index(['next_due_date'], 'idx_side_effect_schedules_next_due');
    t.index(['clinic_id', 'status'], 'idx_side_effect_schedules_clinic_status');
  });
  await knex.raw(`
    ALTER TABLE side_effect_schedules ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_side_effect_schedules_tenant ON side_effect_schedules
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_side_effect_schedules_updated_at
      BEFORE UPDATE ON side_effect_schedules
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION F1 — risk + safety plans + safety_checklists
  // ════════════════════════════════════════════════════════════════════

  // ── risk_assessments ──
  // Comprehensive risk assessment (suicide, self-harm, harm-to-others,
  // absconding, vulnerability) with template-driven scoring and free-text
  // narrative. template_submission_id is a soft pointer (no FK).
  await knex.schema.createTable('risk_assessments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('RESTRICT');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('template_submission_id'); // soft pointer (no FK)
    t.string('assessment_type', 50).notNullable().defaultTo('clinical');
    t.decimal('total_score', 8, 2);
    t.string('score_band', 50);
    t.jsonb('interpretation_detail');
    t.string('overall_risk_level', 30).notNullable().defaultTo('low');
    t.boolean('suicide_risk').notNullable().defaultTo(false);
    t.boolean('self_harm_risk').notNullable().defaultTo(false);
    t.boolean('harm_to_others_risk').notNullable().defaultTo(false);
    t.boolean('absconding_risk').notNullable().defaultTo(false);
    t.boolean('vulnerability_risk').notNullable().defaultTo(false);
    t.text('protective_factors');
    t.text('risk_narrative');
    t.text('risk_management_plan');
    t.boolean('safety_plan_in_place').notNullable().defaultTo(false);
    t.text('safety_plan_summary');
    t.uuid('assessed_by_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.date('assessment_date').notNullable();
    t.date('review_date');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['assessed_by_id'], 'idx_risk_assessments_assessed_by_id');
    t.index(['clinic_id'], 'idx_risk_assessments_clinic_id');
    t.index(['episode_id'], 'idx_risk_assessments_episode_id');
    t.index(['clinic_id', 'patient_id'], 'risk_assessments_clinic_id_patient_id_index');
    t.index(['patient_id', 'assessment_date'], 'risk_assessments_patient_id_assessment_date_index');
  });
  await knex.raw(`
    CREATE INDEX idx_risk_assessments_deleted_at ON risk_assessments (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE risk_assessments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_risk_assessments_tenant ON risk_assessments
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_risk_assessments_updated_at
      BEFORE UPDATE ON risk_assessments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── safety_plans (collaborative safety plan; jsonb content) ──
  // Compact: 4 cols + jsonb content (warning signs, coping strategies,
  // means restriction, support contacts). Stored as jsonb for flexible
  // structure across plan templates.
  await knex.schema.createTable('safety_plans', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.jsonb('content');
    t.string('status', 30).notNullable().defaultTo('active');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_safety_plans_clinic_id');
    t.index(['patient_id'], 'safety_plans_patient_id_index');
  });
  await knex.raw(`
    ALTER TABLE safety_plans ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_safety_plans_tenant ON safety_plans
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_safety_plans_updated_at
      BEFORE UPDATE ON safety_plans
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── safety_checklists (WHO Surgical Safety Checklist — NOT mental health!) ──
  //
  // NOTE: despite the "safety" name, this table is NOT a mental-health
  // safety plan. It's the WHO Surgical Safety Checklist tied to
  // surgical_cases (Section H). Lives in F because the table-name match
  // is here; tenancy + RLS pattern is identical.
  //
  // case_id FK to surgical_cases is DEFERRED to Section N (surgical_cases
  // doesn't exist yet — Section H).
  // CHECK enforces phase enum (sign_in / time_out / sign_out).
  // UNIQUE (case_id, phase) — one checklist per phase per case.
  await knex.schema.createTable('safety_checklists', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('case_id').notNullable(); // FK → surgical_cases(id) deferred to Section N
    t.string('phase', 20).notNullable();
    t.jsonb('items').notNullable();
    t.uuid('completed_by').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('completed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.unique(['case_id', 'phase'], { indexName: 'safety_checklists_case_id_phase_unique' });
    t.index(['clinic_id'], 'idx_safety_checklists_clinic_id');
    t.index(['case_id'], 'safety_checklists_case_id_index');
    t.index(['clinic_id'], 'safety_checklists_clinic_id_index');
  });
  await knex.raw(`
    CREATE INDEX idx_safety_checklists_deleted_at ON safety_checklists (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE safety_checklists ADD CONSTRAINT safety_checklists_phase_check
      CHECK (phase IN ('sign_in', 'time_out', 'sign_out'));
    ALTER TABLE safety_checklists ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_safety_checklists_tenant ON safety_checklists
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- No updated_at trigger; checklist phases are append-only.
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION F2 — outcomes + hotspots + admission_waitlist
  // ════════════════════════════════════════════════════════════════════
  //
  // 4 tables. outcome_measures + assessment_responses both reference
  // templates (deferred to N). hotspots + admission_waitlist link to
  // patient/episode + staff (inline).

  // ── outcome_measures (HoNOS, K10, PHQ-9, etc.) ──
  // Includes patient-app workflow (assigned_for_patient, assigned_by,
  // completed_at). updated_at is NULLABLE.
  // template_id FK to templates DEFERRED to Section N.
  await knex.schema.createTable('outcome_measures', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.string('measure_type', 100).notNullable();
    t.string('collection_occasion', 50);
    t.decimal('total_score', 8, 2);
    t.jsonb('items');
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()); // nullable
    t.string('status', 20).defaultTo('completed');
    t.boolean('assigned_for_patient').defaultTo(false);
    t.uuid('template_id'); // FK → templates(id) deferred to Section N
    t.string('template_name', 255);
    t.uuid('assigned_by').references('id').inTable('staff'); // FK no cascade in current schema
    t.timestamp('completed_at', { useTz: true });
    t.index(['clinic_id'], 'idx_outcome_measures_clinic_id');
    t.index(['episode_id'], 'idx_outcome_measures_episode_id');
    t.index(['patient_id'], 'idx_outcome_measures_patient_id');
    t.index(['staff_id'], 'idx_outcome_measures_staff_id');
    t.index(['clinic_id'], 'outcome_measures_clinic_id_index');
    t.index(['patient_id', 'measure_type'], 'outcome_measures_patient_id_measure_type_index');
  });
  await knex.raw(`
    ALTER TABLE outcome_measures ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_outcome_measures_tenant ON outcome_measures
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_outcome_measures_updated_at
      BEFORE UPDATE ON outcome_measures
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── assessment_responses (template-driven assessment instances) ──
  // updated_at NULLABLE. Has BOTH set_updated_at + audit_trigger_fn
  // triggers. template_id FK DEFERRED to Section N.
  await knex.schema.createTable('assessment_responses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('template_id'); // FK → templates(id) deferred to Section N
    t.string('assessment_type', 100);
    t.jsonb('responses').defaultTo('{}');
    t.decimal('total_score', 8, 2);
    t.string('severity', 50);
    t.string('collection_occasion', 50);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()); // nullable
    t.index(['clinic_id', 'assessment_type'], 'assessment_responses_clinic_id_assessment_type_index');
    t.index(['patient_id'], 'assessment_responses_patient_id_index');
    t.index(['clinic_id'], 'idx_assessment_responses_clinic_id');
    t.index(['episode_id'], 'idx_assessment_responses_episode_id');
    t.index(['staff_id'], 'idx_assessment_responses_staff_id');
  });
  await knex.raw(`
    ALTER TABLE assessment_responses ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_assessment_responses_tenant ON assessment_responses
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- Both audit + set_updated_at triggers (assessment writes are
    -- material clinical events worth audit-logging)
    CREATE TRIGGER trg_assessment_responses_audit
      AFTER INSERT OR UPDATE OR DELETE ON assessment_responses
      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
    CREATE TRIGGER trg_assessment_responses_updated_at
      BEFORE UPDATE ON assessment_responses
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── hotspots (frequent presenters / risk hotspot list) ──
  // Compact: 9 cols. Has BOTH set_updated_at + audit_trigger_fn.
  // updated_at NULLABLE.
  await knex.schema.createTable('hotspots', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('hotspot_type', 50);
    t.text('reason');
    t.string('severity', 30);
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()); // nullable
    t.index(['clinic_id', 'patient_id'], 'hotspots_clinic_id_patient_id_index');
    t.index(['clinic_id'], 'idx_hotspots_clinic_id');
    t.index(['patient_id'], 'idx_hotspots_patient_id');
  });
  await knex.raw(`
    ALTER TABLE hotspots ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_hotspots_tenant ON hotspots
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_hotspots_audit
      AFTER INSERT OR UPDATE OR DELETE ON hotspots
      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
    CREATE TRIGGER trg_hotspots_updated_at
      BEFORE UPDATE ON hotspots
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── admission_waitlist (planned + emergency admissions) ──
  // CHECK enforces priority (low/medium/high/urgent) and status
  // (waiting/admitted/removed/cancelled).
  // hotspot_id is a soft pointer (no FK in current schema — preserve
  // for byte-compat).
  await knex.schema.createTable('admission_waitlist', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('RESTRICT');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('hotspot_id'); // soft pointer to hotspots (no FK)
    t.string('source', 30).notNullable().defaultTo('planned');
    t.string('priority', 20).notNullable().defaultTo('medium');
    t.string('status', 30).notNullable().defaultTo('waiting');
    t.text('reason');
    t.text('clinical_notes');
    t.string('preferred_ward', 100);
    t.date('target_admission_date');
    t.uuid('flagged_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('removed_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('removed_at', { useTz: true });
    t.text('removal_reason');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id', 'patient_id'], 'admission_waitlist_clinic_id_patient_id_index');
    t.index(['clinic_id', 'status'], 'admission_waitlist_clinic_id_status_index');
    t.index(['clinic_id'], 'idx_admission_waitlist_clinic_id');
    t.index(['episode_id'], 'idx_admission_waitlist_episode_id');
  });
  await knex.raw(`
    ALTER TABLE admission_waitlist ADD CONSTRAINT admission_waitlist_priority_check
      CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
    ALTER TABLE admission_waitlist ADD CONSTRAINT admission_waitlist_status_check
      CHECK (status IN ('waiting', 'admitted', 'removed', 'cancelled'));
    ALTER TABLE admission_waitlist ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_admission_waitlist_tenant ON admission_waitlist
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- No updated_at trigger in current schema (caller updates manually).
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION F3 — legal orders + MHA reviews (5 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // The schema has TWO parallel legal-order tables: patient_legal_orders
  // (older) and legal_orders (newer). Both exist live; preserved here.
  // patient_legal_orders.order_type_id is a soft uuid (no FK) — preserved
  // for byte-compat. legal_orders has a proper FK to legal_order_types.

  // ── legal_order_types (global lookup; jurisdiction-scoped) ──
  // No clinic_id (these are global/jurisdiction defaults).
  await knex.schema.createTable('legal_order_types', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('code', 50).notNullable();
    t.string('name', 200).notNullable();
    t.string('jurisdiction', 20).notNullable().defaultTo('VIC');
    t.integer('max_duration_days');
    t.boolean('requires_tribunal').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    CREATE TRIGGER trg_legal_order_types_updated_at
      BEFORE UPDATE ON legal_order_types
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);

  // ── patient_legal_orders (LEGACY/older form) ──
  // 14 cols. order_type_id is a soft uuid (no FK in current schema).
  // ai_summary text column for AI-generated order summary.
  await knex.schema.createTable('patient_legal_orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('order_type_id').notNullable(); // soft pointer (no FK in current schema)
    t.uuid('entered_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.string('order_number', 50);
    t.date('start_date').notNullable();
    t.date('end_date');
    t.date('review_date');
    t.date('next_application_date');
    t.string('status', 30).notNullable().defaultTo('active');
    t.text('notes');
    t.text('ai_summary');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_patient_legal_orders_clinic_id');
    t.index(['entered_by_id'], 'idx_patient_legal_orders_entered_by_id');
    t.index(['patient_id'], 'idx_patient_legal_orders_patient_id');
    t.index(['clinic_id'], 'patient_legal_orders_clinic_id_index');
    t.index(['patient_id', 'status'], 'patient_legal_orders_patient_id_status_index');
  });
  await knex.raw(`
    ALTER TABLE patient_legal_orders ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_legal_orders_tenant ON patient_legal_orders
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_patient_legal_orders_updated_at
      BEFORE UPDATE ON patient_legal_orders
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── patient_legal_attachments (LEGACY) ──
  // updated_at NULLABLE. category default 'order'.
  // Tied to patient_legal_orders via legal_order_id (no FK in current
  // schema — soft pointer). Preserved.
  await knex.schema.createTable('patient_legal_attachments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('legal_order_id'); // soft pointer (no FK)
    t.string('category', 50).notNullable().defaultTo('order');
    t.string('filename', 500).notNullable();
    t.string('mime_type', 100);
    t.integer('file_size');
    t.text('file_path').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('storage_backend').notNullable().defaultTo('local');
    t.text('storage_key');
    t.text('storage_bucket');
    t.text('storage_etag');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('SET NULL');
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()); // nullable
    t.index(['clinic_id'], 'idx_patient_legal_attachments_clinic_id');
    t.index(['patient_id'], 'idx_patient_legal_attachments_patient_id');
    t.index(['clinic_id'], 'patient_legal_attachments_clinic_id_idx');
    t.index(['legal_order_id'], 'patient_legal_attachments_legal_order_id_index');
    t.index(['patient_id'], 'patient_legal_attachments_patient_id_index');
    t.index(['storage_key'], 'patient_legal_attachments_storage_key_idx');
  });
  await knex.raw(`
    ALTER TABLE patient_legal_attachments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_legal_attachments_tenant ON patient_legal_attachments
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_patient_legal_attachments_updated_at
      BEFORE UPDATE ON patient_legal_attachments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── legal_orders (newer/canonical form; FK to legal_order_types) ──
  // 18 cols. Soft-delete + auto_flagged for review-due alerts.
  await knex.schema.createTable('legal_orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('order_type_id').notNullable().references('id').inTable('legal_order_types').onDelete('RESTRICT');
    t.string('order_number', 50);
    t.date('start_date').notNullable();
    t.date('expires_at');
    t.date('review_date');
    t.string('status', 30).notNullable().defaultTo('active');
    t.string('issuing_authority', 200);
    t.text('conditions');
    t.text('notes');
    t.boolean('auto_flagged').notNullable().defaultTo(false);
    t.uuid('created_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['clinic_id'], 'idx_legal_orders_clinic_id');
    t.index(['created_by_staff_id'], 'idx_legal_orders_created_by_staff_id');
    t.index(['episode_id'], 'idx_legal_orders_episode_id');
    t.index(['order_type_id'], 'idx_legal_orders_order_type_id');
    t.index(['clinic_id', 'patient_id'], 'legal_orders_clinic_id_patient_id_index');
    t.index(['expires_at'], 'legal_orders_expiry_date_index');
    t.index(['patient_id', 'status'], 'legal_orders_patient_id_status_index');
  });
  await knex.raw(`
    CREATE INDEX idx_legal_orders_deleted_at ON legal_orders (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE legal_orders ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_legal_orders_tenant ON legal_orders
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_legal_orders_updated_at
      BEFORE UPDATE ON legal_orders
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── mha_reviews (Mental Health Act tribunal/clinical reviews) ──
  // 16 cols. DUPLICATE columns: order_id (legacy) alongside legal_order_id
  // (canonical, FK CASCADE); reviewed_by_id (legacy) alongside
  // reviewed_by_staff_id (canonical). Both preserved per current schema.
  await knex.schema.createTable('mha_reviews', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('legal_order_id').notNullable().references('id').inTable('legal_orders').onDelete('CASCADE');
    t.uuid('order_id'); // legacy duplicate of legal_order_id
    t.string('review_type', 50).notNullable();
    t.date('review_date').notNullable();
    t.string('outcome', 50);
    t.text('notes');
    t.text('clinical_notes');
    t.date('next_review_date');
    t.uuid('reviewed_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('reviewed_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['clinic_id'], 'idx_mha_reviews_clinic_id');
    t.index(['patient_id'], 'idx_mha_reviews_patient_id');
    t.index(['reviewed_by_staff_id'], 'idx_mha_reviews_reviewed_by_staff_id');
    t.index(['legal_order_id'], 'mha_reviews_legal_order_id_index');
    t.index(['patient_id'], 'mha_reviews_patient_id_index');
  });
  await knex.raw(`
    CREATE INDEX idx_mha_reviews_deleted_at ON mha_reviews (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE mha_reviews ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_mha_reviews_tenant ON mha_reviews
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_mha_reviews_updated_at
      BEFORE UPDATE ON mha_reviews
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION F4 — restrictive_interventions + nursing_assessments (closes F)
  // ════════════════════════════════════════════════════════════════════

  // ── restrictive_interventions (seclusion, restraint, PRN injection) ──
  // SD59-62 cols (alternatives_tried, debrief_completed, debrief_notes,
  // notified_persons) baked in from day one — originally added via
  // 20260603000003_restrictive_interventions_columns.ts (now archived).
  // updated_at NULLABLE.
  await knex.schema.createTable('restrictive_interventions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.string('intervention_type', 100);
    t.timestamp('start_time', { useTz: true });
    t.timestamp('end_time', { useTz: true });
    t.integer('duration_minutes');
    t.text('reason');
    t.uuid('authorised_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('recorded_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.text('outcome');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()); // nullable
    // SD59-62: clinical-governance documentation per Australian Mental
    // Health Commission standards (debrief + alternatives + notification).
    t.text('alternatives_tried');
    t.boolean('debrief_completed').notNullable().defaultTo(false);
    t.text('debrief_notes');
    t.jsonb('notified_persons');
    t.index(['authorised_by_id'], 'idx_restrictive_interventions_authorised_by_id');
    t.index(['clinic_id'], 'idx_restrictive_interventions_clinic_id');
    t.index(['episode_id'], 'idx_restrictive_interventions_episode_id');
    t.index(['patient_id'], 'idx_restrictive_interventions_patient_id');
    t.index(['recorded_by_id'], 'idx_restrictive_interventions_recorded_by_id');
    t.index(['clinic_id', 'patient_id'], 'restrictive_interventions_clinic_id_patient_id_index');
  });
  await knex.raw(`
    ALTER TABLE restrictive_interventions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_restrictive_interventions_tenant ON restrictive_interventions
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_restrictive_interventions_updated_at
      BEFORE UPDATE ON restrictive_interventions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── nursing_assessments (Falls / Pressure / VTE / etc.) ──
  // SD57 resolution: real columns are `assessment_data` (current
  // canonical) + `scores` (legacy). BOTH preserved per current schema
  // for byte-compat. Code at apps/api/src/features/roles/
  // nurseFeatureRoutes.ts writes to `assessment_data` post-SD57 fix.
  //
  // SD58-NOTE: the audit flagged a need for `next_review_at` for
  // assessment-rescheduling. The current live schema does NOT have
  // that column — preserved as-is. Phase 0.7.3 (clinical features)
  // can add it via a separate migration when the rescheduling
  // workflow is implemented.
  await knex.schema.createTable('nursing_assessments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.string('assessment_type', 50).notNullable();
    t.jsonb('scores'); // legacy column
    t.jsonb('assessment_data'); // SD57 canonical column
    t.decimal('total_score', 8, 2);
    t.string('risk_level', 30);
    t.text('notes');
    t.text('plan');
    t.timestamp('assessed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_nursing_assessments_clinic_id');
    t.index(['episode_id'], 'idx_nursing_assessments_episode_id');
    t.index(['staff_id'], 'idx_nursing_assessments_staff_id');
    t.index(['assessed_at'], 'nursing_assessments_assessed_at_index');
    t.index(['clinic_id'], 'nursing_assessments_clinic_id_index');
    t.index(['patient_id', 'assessment_type'], 'nursing_assessments_patient_id_assessment_type_index');
  });
  await knex.raw(`
    ALTER TABLE nursing_assessments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_nursing_assessments_tenant ON nursing_assessments
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_nursing_assessments_updated_at
      BEFORE UPDATE ON nursing_assessments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION G — care planning + nursing + ops (13 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // 4 existing tables (beds, bed_movements, structured_observations,
  // report_runs) + 9 PREVIOUSLY GHOST tables materialised here per the
  // handler INSERT payloads in apps/api/src/features/roles/*.ts (the
  // TODO(Phase F ghost-table) markers). R3 will remove those markers.
  //
  // Ghost tables materialised in G:
  //   care_plans, care_plan_goals, care_plan_interventions,
  //   community_resources, medication_administrations, shift_handovers,
  //   phone_triage, staff_leave, report_schedules.
  //
  // Note: shift_handovers had its schema EMBEDDED in the handler
  // (db.schema.createTable inside a request handler — anti-pattern from
  // c24-d11). The R3 commit will REMOVE that schema-in-handler block now
  // that R2 baseline materialises the table properly.

  // ── beds (clinical inpatient bed inventory) ──
  await knex.schema.createTable('beds', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('org_unit_id').references('id').inTable('org_units').onDelete('SET NULL');
    t.string('ward', 100);
    t.string('room', 50);
    t.string('bed_label', 50).notNullable();
    t.string('bed_type', 50);
    t.string('status', 30).notNullable().defaultTo('available');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id', 'status'], 'beds_clinic_id_status_index');
    t.index(['clinic_id'], 'idx_beds_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE beds ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_beds_tenant ON beds
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_beds_updated_at
      BEFORE UPDATE ON beds
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── bed_movements (admission / transfer / discharge audit) ──
  // updated_at NULLABLE.
  await knex.schema.createTable('bed_movements', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('bed_id').notNullable().references('id').inTable('beds').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('movement_type', 30).notNullable();
    t.timestamp('movement_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('authorised_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now()); // nullable
    t.index(['bed_id'], 'bed_movements_bed_id_index');
    t.index(['patient_id'], 'bed_movements_patient_id_index');
    t.index(['authorised_by_id'], 'idx_bed_movements_authorised_by_id');
    t.index(['bed_id'], 'idx_bed_movements_bed_id');
    t.index(['clinic_id'], 'idx_bed_movements_clinic_id');
    t.index(['episode_id'], 'idx_bed_movements_episode_id');
  });
  await knex.raw(`
    ALTER TABLE bed_movements ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_bed_movements_tenant ON bed_movements
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_bed_movements_updated_at
      BEFORE UPDATE ON bed_movements
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── structured_observations (15-min nursing observations) ──
  // SD53-56 NOTE: current schema uses canonical names (observation_type,
  // sleep_quality, observed_at). 'values' jsonb is a legacy column name
  // preserved for byte-compat. Phase 0.7.5 SD56 also flagged updated_at
  // + escalation_required + escalation_notes — current live schema
  // does NOT have those; preserved as-is.
  // Has audit_trigger_fn (no set_updated_at).
  await knex.schema.createTable('structured_observations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.string('observation_type', 50).notNullable();
    t.string('location', 100);
    t.string('mood', 100);
    t.string('behaviour', 100);
    t.text('risk_concerns');
    t.string('sleep_quality', 50);
    t.jsonb('values'); // legacy jsonb of misc observed values
    t.text('notes');
    t.timestamp('observed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_structured_observations_clinic_id');
    t.index(['patient_id'], 'idx_structured_observations_patient_id');
    t.index(['staff_id'], 'idx_structured_observations_staff_id');
    t.index(['clinic_id'], 'structured_observations_clinic_id_index');
    t.index(['observed_at'], 'structured_observations_observed_at_index');
    t.index(['patient_id'], 'structured_observations_patient_id_index');
  });
  await knex.raw(`
    ALTER TABLE structured_observations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_structured_observations_tenant ON structured_observations
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- Has audit trigger only (no updated_at column → no set_updated_at trigger)
    CREATE TRIGGER trg_structured_observations_audit
      AFTER INSERT OR UPDATE OR DELETE ON structured_observations
      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
  `);

  // ── report_runs (audit trail for executed reports) ──
  // Distinct from report_schedules (ghost-materialised below).
  await knex.schema.createTable('report_runs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('requested_by_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.string('report_type', 100).notNullable();
    t.jsonb('filters').notNullable();
    t.string('format', 20).notNullable().defaultTo('json');
    t.string('status', 30).notNullable().defaultTo('completed');
    t.integer('total_rows').notNullable().defaultTo(0);
    t.jsonb('result_data');
    t.string('error_message', 500);
    t.timestamp('generated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_report_runs_clinic_id');
    t.index(['requested_by_id'], 'idx_report_runs_requested_by_id');
    t.index(['clinic_id', 'report_type'], 'report_runs_clinic_id_report_type_index');
  });
  await knex.raw(`
    ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_report_runs_tenant ON report_runs
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_report_runs_updated_at
      BEFORE UPDATE ON report_runs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── care_plans (PREVIOUSLY GHOST — materialised by R2) ──
  //
  // Schema derived from caseManagerFeatureRoutes.ts UPDATE patterns
  // (lines 335, 384). The handler updates these columns:
  //   transition_checklist (jsonb), transition_status,
  //   transition_target_date, recovery_star_scores (jsonb),
  //   recovery_star_updated_at, recovery_star_updated_by (FK staff)
  // Plus inferred: id, clinic_id, patient_id, episode_id, title,
  // status, created_by_id, +ts, deleted_at.
  //
  // NOTE: care_plan_goals.treatment_plan_id is the FK to care_plans.id —
  // legacy naming preserved (per the handler INSERT at line 122 using
  // 'treatment_plan_id', not 'care_plan_id').
  await knex.schema.createTable('care_plans', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.string('title', 300);
    t.text('description');
    t.string('status', 30).notNullable().defaultTo('active');
    t.jsonb('transition_checklist');
    t.string('transition_status', 30);
    t.date('transition_target_date');
    t.jsonb('recovery_star_scores');
    t.timestamp('recovery_star_updated_at', { useTz: true });
    t.uuid('recovery_star_updated_by').references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('created_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['clinic_id'], 'idx_care_plans_clinic_id');
    t.index(['patient_id'], 'idx_care_plans_patient_id');
    t.index(['episode_id'], 'idx_care_plans_episode_id');
  });
  await knex.raw(`
    CREATE INDEX idx_care_plans_deleted_at ON care_plans (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE care_plans ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_care_plans_tenant ON care_plans
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_care_plans_updated_at
      BEFORE UPDATE ON care_plans
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── care_plan_goals (PREVIOUSLY GHOST) ──
  // Schema from caseManagerFeatureRoutes.ts:122 INSERT payload.
  await knex.schema.createTable('care_plan_goals', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('treatment_plan_id').notNullable().references('id').inTable('care_plans').onDelete('CASCADE');
    t.string('goal_text', 500).notNullable();
    t.text('description');
    t.string('goal_type', 50).notNullable().defaultTo('general');
    t.date('target_date');
    t.string('status', 30).notNullable().defaultTo('active');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.text('measurable');
    t.text('patient_self_rated');
    t.uuid('created_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_care_plan_goals_clinic_id');
    t.index(['treatment_plan_id', 'sort_order'], 'idx_care_plan_goals_plan_sort');
  });
  await knex.raw(`
    ALTER TABLE care_plan_goals ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_care_plan_goals_tenant ON care_plan_goals
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_care_plan_goals_updated_at
      BEFORE UPDATE ON care_plan_goals
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── care_plan_interventions (PREVIOUSLY GHOST) ──
  // Schema from caseManagerFeatureRoutes.ts:220 INSERT payload.
  await knex.schema.createTable('care_plan_interventions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('care_plan_goal_id').notNullable().references('id').inTable('care_plan_goals').onDelete('CASCADE');
    t.string('intervention_text', 500).notNullable();
    t.text('description');
    t.string('frequency', 100);
    t.uuid('responsible_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.string('status', 30).notNullable().defaultTo('active');
    t.date('start_date');
    t.date('end_date');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.uuid('created_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_care_plan_interventions_clinic_id');
    t.index(['care_plan_goal_id', 'sort_order'], 'idx_care_plan_interventions_goal_sort');
  });
  await knex.raw(`
    ALTER TABLE care_plan_interventions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_care_plan_interventions_tenant ON care_plan_interventions
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_care_plan_interventions_updated_at
      BEFORE UPDATE ON care_plan_interventions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── community_resources (PREVIOUSLY GHOST) ──
  // Per-clinic directory of external community resources.
  // Schema from caseManagerFeatureRoutes.ts:440 INSERT.
  await knex.schema.createTable('community_resources', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 300).notNullable();
    t.string('category', 50).notNullable().defaultTo('general');
    t.text('description');
    t.text('services');
    t.string('phone', 30);
    t.string('email', 255);
    t.string('website', 500);
    t.text('address');
    t.text('operating_hours');
    t.text('referral_process');
    t.text('eligibility');
    t.string('contact_person', 200);
    t.text('notes');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id', 'category'], 'idx_community_resources_clinic_category');
    t.index(['clinic_id', 'is_active'], 'idx_community_resources_clinic_active');
  });
  await knex.raw(`
    ALTER TABLE community_resources ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_community_resources_tenant ON community_resources
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_community_resources_updated_at
      BEFORE UPDATE ON community_resources
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── medication_administrations (PREVIOUSLY GHOST) ──
  // Per-dose nurse-administered med record. Schema from
  // nurseFeatureRoutes.ts:91 INSERT payload.
  // No updated_at column (append-only audit record).
  await knex.schema.createTable('medication_administrations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('patient_medication_id').references('id').inTable('patient_medications').onDelete('SET NULL');
    t.timestamp('scheduled_time', { useTz: true });
    t.string('status', 30).notNullable().defaultTo('given');
    t.timestamp('administered_time', { useTz: true });
    t.uuid('administered_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.string('dose_given', 100);
    t.string('route', 50);
    t.string('site', 100);
    t.text('notes');
    t.text('reason_not_given');
    t.uuid('witnessed_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.string('batch_number', 100);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_medication_administrations_clinic_id');
    t.index(['patient_id'], 'idx_medication_administrations_patient_id');
    t.index(['patient_medication_id'], 'idx_medication_administrations_med_id');
    t.index(['administered_by_staff_id'], 'idx_medication_administrations_by');
    t.index(['scheduled_time'], 'idx_medication_administrations_scheduled');
  });
  await knex.raw(`
    ALTER TABLE medication_administrations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_medication_administrations_tenant ON medication_administrations
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- Append-only; no updated_at trigger.
  `);

  // ── shift_handovers (PREVIOUSLY GHOST + had schema-in-handler!) ──
  // Schema transcribed from the in-handler db.schema.createTable at
  // nurseFeatureRoutes.ts:388 (an anti-pattern from c24-d11 that R3
  // will REMOVE now that R2 baseline materialises this table properly).
  await knex.schema.createTable('shift_handovers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('ward', 100);
    t.string('shift_type', 20).notNullable().defaultTo('morning');
    t.text('summary_manual');
    t.jsonb('key_issues');
    t.jsonb('patient_updates');
    t.uuid('outgoing_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('incoming_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.jsonb('pending_actions');
    t.date('shift_date');
    t.string('status', 30).notNullable().defaultTo('pending');
    t.uuid('created_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('acknowledged_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id', 'shift_date'], 'idx_shift_handovers_clinic_shift_date');
    t.index(['clinic_id', 'status'], 'idx_shift_handovers_clinic_status');
  });
  await knex.raw(`
    ALTER TABLE shift_handovers ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_shift_handovers_tenant ON shift_handovers
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_shift_handovers_updated_at
      BEFORE UPDATE ON shift_handovers
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── phone_triage (PREVIOUSLY GHOST) ──
  // Schema from receptionistFeatureRoutes.ts:173 INSERT payload.
  await knex.schema.createTable('phone_triage', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').references('id').inTable('patients').onDelete('SET NULL');
    t.string('caller_name', 200).notNullable();
    t.string('caller_relationship', 100);
    t.string('caller_phone', 30);
    t.text('reason_for_call').notNullable();
    t.string('urgency', 30).notNullable().defaultTo('routine');
    t.text('triage_notes');
    t.text('action_taken');
    t.uuid('assigned_to_id').references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('received_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('triaged_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.string('status', 30).notNullable().defaultTo('open');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id', 'status'], 'idx_phone_triage_clinic_status');
    t.index(['patient_id'], 'idx_phone_triage_patient');
    t.index(['assigned_to_id'], 'idx_phone_triage_assigned_to');
    t.index(['urgency'], 'idx_phone_triage_urgency');
  });
  await knex.raw(`
    ALTER TABLE phone_triage ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_phone_triage_tenant ON phone_triage
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_phone_triage_updated_at
      BEFORE UPDATE ON phone_triage
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── staff_leave (PREVIOUSLY GHOST) ──
  // Schema from managerFeatureRoutes.ts:288 INSERT payload.
  // NOTE: clinic_id present; staff_leave for THIS clinic only.
  await knex.schema.createTable('staff_leave', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.string('leave_type', 50).notNullable();
    t.date('start_date').notNullable();
    t.date('end_date').notNullable();
    t.text('reason');
    t.uuid('cover_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.string('status', 30).notNullable().defaultTo('requested');
    t.uuid('requested_by').references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('approved_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('approved_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id', 'staff_id'], 'idx_staff_leave_clinic_staff');
    t.index(['clinic_id', 'status'], 'idx_staff_leave_clinic_status');
    t.index(['start_date', 'end_date'], 'idx_staff_leave_dates');
  });
  await knex.raw(`
    ALTER TABLE staff_leave ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_staff_leave_tenant ON staff_leave
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_staff_leave_updated_at
      BEFORE UPDATE ON staff_leave
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── report_schedules (PREVIOUSLY GHOST) ──
  // Schema from managerFeatureRoutes.ts:381 INSERT payload.
  // Distinct from report_runs (audit log). report_schedules defines
  // recurring report jobs.
  await knex.schema.createTable('report_schedules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('report_type', 100).notNullable();
    t.string('name', 200).notNullable();
    t.string('frequency', 30).notNullable().defaultTo('weekly');
    t.string('schedule_cron', 100);
    t.jsonb('recipients').notNullable().defaultTo('[]');
    t.jsonb('filters').notNullable().defaultTo('{}');
    t.string('format', 20).notNullable().defaultTo('pdf');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.uuid('created_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('last_run_at', { useTz: true });
    t.timestamp('next_run_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id', 'is_active'], 'idx_report_schedules_clinic_active');
    t.index(['next_run_at'], 'idx_report_schedules_next_run');
  });
  await knex.raw(`
    ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_report_schedules_tenant ON report_schedules
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_report_schedules_updated_at
      BEFORE UPDATE ON report_schedules
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION H1 — oncology mCODE (6 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // FHIR mCODE-aligned oncology cluster. primary_cancer_conditions is
  // the parent; tnm_stage_groups + cancer_treatment_plans + tumour_board
  // _decisions FK CASCADE on it. ecog_performance_status is patient-
  // scoped (separate from any single condition). chemo_cycles cascades
  // off cancer_treatment_plans.
  //
  // Multiple CHECK constraints enforce mCODE enums (intent, status,
  // stage_system, ECOG score range 0-5).

  // ── primary_cancer_conditions (parent — FHIR mCODE Condition) ──
  await knex.schema.createTable('primary_cancer_conditions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.string('icd10', 20);
    t.string('snomed', 30);
    t.string('histology', 200);
    t.string('laterality', 20);
    t.date('diagnosis_date').notNullable();
    t.string('stage_system', 10);
    t.text('notes');
    t.uuid('created_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['clinic_id'], 'idx_primary_cancer_conditions_clinic_id');
    t.index(['clinic_id', 'diagnosis_date'], 'primary_cancer_conditions_clinic_id_diagnosis_date_index');
    t.index(['clinic_id', 'patient_id'], 'primary_cancer_conditions_clinic_id_patient_id_index');
    t.index(['episode_id'], 'primary_cancer_conditions_episode_id_index');
  });
  await knex.raw(`
    CREATE INDEX idx_primary_cancer_conditions_deleted_at
      ON primary_cancer_conditions (deleted_at) WHERE deleted_at IS NULL;
    ALTER TABLE primary_cancer_conditions ADD CONSTRAINT primary_cancer_conditions_stage_system_check
      CHECK (stage_system IS NULL OR stage_system IN ('ajcc8', 'uicc8'));
    ALTER TABLE primary_cancer_conditions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_primary_cancer_conditions_tenant ON primary_cancer_conditions
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_primary_cancer_conditions_updated_at
      BEFORE UPDATE ON primary_cancer_conditions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── tnm_stage_groups (TNM staging history per condition) ──
  // Append-only; no updated_at.
  await knex.schema.createTable('tnm_stage_groups', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('condition_id').notNullable().references('id').inTable('primary_cancer_conditions').onDelete('CASCADE');
    t.string('t', 10);
    t.string('n', 10);
    t.string('m', 10);
    t.string('stage_group', 10);
    t.timestamp('staged_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('staged_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_tnm_stage_groups_clinic_id');
    t.index(['clinic_id', 'condition_id'], 'tnm_stage_groups_clinic_id_condition_id_index');
    t.index(['condition_id', 'staged_at'], 'tnm_stage_groups_condition_id_staged_at_index');
  });
  await knex.raw(`
    ALTER TABLE tnm_stage_groups ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_tnm_stage_groups_tenant ON tnm_stage_groups
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── ecog_performance_status (mCODE performance status) ──
  // Append-only; CHECK enforces score 0-5.
  await knex.schema.createTable('ecog_performance_status', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.specificType('score', 'smallint').notNullable();
    t.timestamp('assessed_at', { useTz: true }).notNullable();
    t.uuid('assessed_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id', 'patient_id', 'assessed_at'], 'ecog_performance_status_clinic_id_patient_id_assessed_at_index');
    t.index(['clinic_id'], 'idx_ecog_performance_status_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE ecog_performance_status ADD CONSTRAINT ecog_score_check
      CHECK (score >= 0 AND score <= 5);
    ALTER TABLE ecog_performance_status ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_ecog_performance_status_tenant ON ecog_performance_status
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── cancer_treatment_plans (regimens; FK condition CASCADE) ──
  // CHECK on intent (curative/palliative/adjuvant/neoadjuvant) + status.
  await knex.schema.createTable('cancer_treatment_plans', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('condition_id').notNullable().references('id').inTable('primary_cancer_conditions').onDelete('CASCADE');
    t.string('regimen_name', 200).notNullable();
    t.string('intent', 20).notNullable();
    t.string('protocol_ref', 200);
    t.date('start_date').notNullable();
    t.date('end_date');
    t.string('status', 20).notNullable().defaultTo('draft');
    t.text('notes');
    t.uuid('created_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['clinic_id', 'condition_id'], 'cancer_treatment_plans_clinic_id_condition_id_index');
    t.index(['clinic_id', 'status'], 'cancer_treatment_plans_clinic_id_status_index');
    t.index(['clinic_id'], 'idx_cancer_treatment_plans_clinic_id');
  });
  await knex.raw(`
    CREATE INDEX idx_cancer_treatment_plans_deleted_at
      ON cancer_treatment_plans (deleted_at) WHERE deleted_at IS NULL;
    ALTER TABLE cancer_treatment_plans ADD CONSTRAINT cancer_treatment_plans_intent_check
      CHECK (intent IN ('curative', 'palliative', 'adjuvant', 'neoadjuvant'));
    ALTER TABLE cancer_treatment_plans ADD CONSTRAINT cancer_treatment_plans_status_check
      CHECK (status IN ('draft', 'active', 'completed', 'cancelled'));
    ALTER TABLE cancer_treatment_plans ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_cancer_treatment_plans_tenant ON cancer_treatment_plans
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_cancer_treatment_plans_updated_at
      BEFORE UPDATE ON cancer_treatment_plans
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── chemo_cycles (per-cycle administration record; UNIQUE on plan + cycle_number) ──
  // CHECK on status (planned/administered/delayed/cancelled).
  await knex.schema.createTable('chemo_cycles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('plan_id').notNullable().references('id').inTable('cancer_treatment_plans').onDelete('CASCADE');
    t.integer('cycle_number').notNullable();
    t.date('planned_date').notNullable();
    t.date('actual_date');
    t.string('status', 20).notNullable().defaultTo('planned');
    t.jsonb('dose_modifications').notNullable().defaultTo('{}');
    t.jsonb('toxicity_ctcae').notNullable().defaultTo('{}');
    t.text('notes');
    t.uuid('administered_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['plan_id', 'cycle_number'], { indexName: 'chemo_cycles_plan_id_cycle_number_unique' });
    t.index(['clinic_id', 'plan_id', 'cycle_number'], 'chemo_cycles_clinic_id_plan_id_cycle_number_index');
    t.index(['clinic_id'], 'idx_chemo_cycles_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE chemo_cycles ADD CONSTRAINT chemo_cycles_status_check
      CHECK (status IN ('planned', 'administered', 'delayed', 'cancelled'));
    ALTER TABLE chemo_cycles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_chemo_cycles_tenant ON chemo_cycles
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_chemo_cycles_updated_at
      BEFORE UPDATE ON chemo_cycles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── tumour_board_decisions (MDT meeting decisions; uuid[] attendees) ──
  // Append-only; uses Postgres uuid[] for attendee list.
  await knex.schema.createTable('tumour_board_decisions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('condition_id').notNullable().references('id').inTable('primary_cancer_conditions').onDelete('CASCADE');
    t.date('meeting_date').notNullable();
    t.text('recommendation').notNullable();
    t.text('rationale');
    t.specificType('attendee_staff_ids', 'uuid[]');
    t.uuid('chaired_by_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id'], 'idx_tumour_board_decisions_clinic_id');
    t.index(['clinic_id', 'condition_id', 'meeting_date'], 'tumour_board_decisions_clinic_id_condition_id_meeting_date_inde');
  });
  await knex.raw(`
    ALTER TABLE tumour_board_decisions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_tumour_board_decisions_tenant ON tumour_board_decisions
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION H2 — ECT + TMS (4 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // Two specialty cluster pairs: courses + sessions for both ECT
  // (electroconvulsive therapy) and TMS (transcranial magnetic
  // stimulation). Both follow the same pattern: course is parent;
  // sessions cascade on course delete; UNIQUE on (course_id,
  // session_number); CHECKs on enums.

  // ── ect_courses (electroconvulsive therapy course) ──
  await knex.schema.createTable('ect_courses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
    t.uuid('patient_id').notNullable().references('id').inTable('patients');
    t.uuid('episode_id').references('id').inTable('episodes');
    t.uuid('treating_psychiatrist_id').notNullable().references('id').inTable('staff');
    t.uuid('anaesthetist_id').references('id').inTable('staff');
    t.boolean('consent_obtained').notNullable().defaultTo(false);
    t.timestamp('consent_date', { useTz: true });
    t.uuid('consent_recorded_by').references('id').inTable('staff');
    t.integer('total_planned_sessions').notNullable().defaultTo(12);
    t.string('indication', 255).notNullable();
    t.string('status', 30).notNullable().defaultTo('planned');
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['clinic_id', 'patient_id'], 'ect_courses_clinic_id_patient_id_index');
    t.index(['treating_psychiatrist_id'], 'ect_courses_treating_psychiatrist_id_index');
    t.index(['clinic_id'], 'idx_ect_courses_clinic_id');
  });
  await knex.raw(`
    CREATE INDEX idx_ect_courses_deleted_at ON ect_courses (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE ect_courses ADD CONSTRAINT ect_courses_status_check
      CHECK (status IN ('planned', 'active', 'completed', 'discontinued'));
    ALTER TABLE ect_courses ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_ect_courses_tenant ON ect_courses
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_ect_courses_updated_at
      BEFORE UPDATE ON ect_courses
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── ect_sessions (per-session record; bilateral default placement) ──
  await knex.schema.createTable('ect_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('course_id').notNullable().references('id').inTable('ect_courses').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
    t.integer('session_number').notNullable();
    t.date('session_date').notNullable();
    t.decimal('stimulus_dose_mc', 8, 2);
    t.integer('seizure_duration_sec');
    t.string('electrode_placement', 30).notNullable().defaultTo('bilateral');
    t.string('anaesthetic_agent', 100);
    t.string('muscle_relaxant', 100);
    t.string('pre_treatment_bp', 20);
    t.string('post_treatment_bp', 20);
    t.integer('mmse_score');
    t.text('adverse_events');
    t.text('clinician_notes');
    t.uuid('administered_by').notNullable().references('id').inTable('staff');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['course_id', 'session_number'], { indexName: 'ect_sessions_course_id_session_number_unique' });
    t.index(['clinic_id'], 'ect_sessions_clinic_id_index');
    t.index(['course_id', 'session_number'], 'ect_sessions_course_id_session_number_index');
    t.index(['clinic_id'], 'idx_ect_sessions_clinic_id');
  });
  await knex.raw(`
    ALTER TABLE ect_sessions ADD CONSTRAINT ect_sessions_placement_check
      CHECK (electrode_placement IN ('bilateral', 'right_unilateral', 'bifrontal'));
    ALTER TABLE ect_sessions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_ect_sessions_tenant ON ect_sessions
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_ect_sessions_updated_at
      BEFORE UPDATE ON ect_sessions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── tms_courses (transcranial magnetic stimulation course) ──
  // CHECKs on protocol (standard/theta_burst/deep_tms) + status.
  await knex.schema.createTable('tms_courses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
    t.uuid('patient_id').notNullable().references('id').inTable('patients');
    t.uuid('episode_id').references('id').inTable('episodes');
    t.uuid('treating_psychiatrist_id').notNullable().references('id').inTable('staff');
    t.string('protocol', 30).notNullable().defaultTo('standard');
    t.string('target_area', 100).notNullable().defaultTo('left_dlpfc');
    t.integer('total_planned_sessions').notNullable().defaultTo(20);
    t.integer('motor_threshold_percent');
    t.boolean('consent_obtained').notNullable().defaultTo(false);
    t.timestamp('consent_date', { useTz: true });
    t.uuid('consent_recorded_by').references('id').inTable('staff');
    t.string('indication', 255).notNullable();
    t.string('status', 30).notNullable().defaultTo('planned');
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true });
    t.index(['clinic_id'], 'idx_tms_courses_clinic_id');
    t.index(['clinic_id', 'patient_id'], 'tms_courses_clinic_id_patient_id_index');
    t.index(['treating_psychiatrist_id'], 'tms_courses_treating_psychiatrist_id_index');
  });
  await knex.raw(`
    CREATE INDEX idx_tms_courses_deleted_at ON tms_courses (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE tms_courses ADD CONSTRAINT tms_courses_protocol_check
      CHECK (protocol IN ('standard', 'theta_burst', 'deep_tms'));
    ALTER TABLE tms_courses ADD CONSTRAINT tms_courses_status_check
      CHECK (status IN ('planned', 'active', 'completed', 'discontinued'));
    ALTER TABLE tms_courses ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_tms_courses_tenant ON tms_courses
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_tms_courses_updated_at
      BEFORE UPDATE ON tms_courses
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── tms_sessions (per-session record; PHQ-9 score per session) ──
  await knex.schema.createTable('tms_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('course_id').notNullable().references('id').inTable('tms_courses').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
    t.integer('session_number').notNullable();
    t.date('session_date').notNullable();
    t.integer('pulses_delivered');
    t.integer('intensity_percent');
    t.string('coil_position', 100);
    t.integer('duration_minutes');
    t.text('adverse_events');
    t.string('patient_tolerance', 20).notNullable().defaultTo('good');
    t.uuid('administered_by').notNullable().references('id').inTable('staff');
    t.integer('phq9_score');
    t.text('clinician_notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['course_id', 'session_number'], { indexName: 'tms_sessions_course_id_session_number_unique' });
    t.index(['clinic_id'], 'idx_tms_sessions_clinic_id');
    t.index(['clinic_id'], 'tms_sessions_clinic_id_index');
    t.index(['course_id', 'session_number'], 'tms_sessions_course_id_session_number_index');
  });
  await knex.raw(`
    ALTER TABLE tms_sessions ADD CONSTRAINT tms_sessions_tolerance_check
      CHECK (patient_tolerance IN ('good', 'moderate', 'poor'));
    ALTER TABLE tms_sessions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_tms_sessions_tenant ON tms_sessions
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_tms_sessions_updated_at
      BEFORE UPDATE ON tms_sessions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION H3 — endocrinology + paediatrics + obs_gyne (7 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // - Endocrinology: glucose_readings, insulin_regimens
  // - Paediatrics: growth_measurements, immunizations,
  //   developmental_milestones
  // - Obstetrics: pregnancies, antenatal_visits
  //
  // No FHIR-profile alignment beyond column naming. Every table is
  // patient + clinic scoped with optional episode_id link.

  // ── glucose_readings (BG monitoring; CGM-aware via source enum) ──
  await knex.schema.createTable('glucose_readings', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.decimal('value', 6, 2).notNullable();
    t.string('unit', 10).notNullable().defaultTo('mmol/L');
    t.string('source', 20).notNullable().defaultTo('fingerstick');
    t.string('meal_context', 20).nullable();
    t.timestamp('measured_at', { useTz: true }).notNullable();
    t.uuid('recorded_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.text('note').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'patient_id', 'measured_at']);
  });
  await knex.raw(`
    CREATE INDEX idx_glucose_readings_clinic_id ON glucose_readings (clinic_id);
    CREATE INDEX idx_glucose_readings_deleted_at ON glucose_readings (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE glucose_readings ADD CONSTRAINT glucose_readings_unit_check
      CHECK (unit IN ('mmol/L','mg/dL'));
    ALTER TABLE glucose_readings ADD CONSTRAINT glucose_readings_source_check
      CHECK (source IN ('cgm','fingerstick','lab','manual'));
    ALTER TABLE glucose_readings ADD CONSTRAINT glucose_readings_meal_context_check
      CHECK (meal_context IS NULL OR meal_context IN
        ('fasting','pre_meal','post_meal_1h','post_meal_2h','bedtime','random','overnight'));
    ALTER TABLE glucose_readings ADD CONSTRAINT glucose_readings_value_range_check
      CHECK (value > 0 AND value < 1000);
    ALTER TABLE glucose_readings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_glucose_readings_tenant ON glucose_readings
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_glucose_readings_updated_at
      BEFORE UPDATE ON glucose_readings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── insulin_regimens (basal/bolus regimen; valid_from/valid_to versioning) ──
  await knex.schema.createTable('insulin_regimens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.string('basal_drug', 100).nullable();
    t.decimal('basal_dose_units', 7, 2).nullable();
    t.string('basal_frequency', 50).nullable();
    t.string('bolus_drug', 100).nullable();
    t.jsonb('bolus_doses').nullable();
    t.decimal('correction_factor', 6, 2).nullable();
    t.decimal('carb_ratio', 6, 2).nullable();
    t.decimal('target_low', 6, 2).nullable();
    t.decimal('target_high', 6, 2).nullable();
    t.timestamp('valid_from', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('valid_to', { useTz: true }).nullable();
    t.text('note').nullable();
    t.uuid('prescribed_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'patient_id', 'valid_to']);
  });
  await knex.raw(`
    CREATE INDEX idx_insulin_regimens_clinic_id ON insulin_regimens (clinic_id);
    CREATE INDEX idx_insulin_regimens_deleted_at ON insulin_regimens (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE insulin_regimens ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_insulin_regimens_tenant ON insulin_regimens
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_insulin_regimens_updated_at
      BEFORE UPDATE ON insulin_regimens
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── growth_measurements (weight/height/HC/BMI; WHO/CDC reference) ──
  await knex.schema.createTable('growth_measurements', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.string('measurement_type', 30).notNullable();
    t.decimal('value', 8, 3).notNullable();
    t.string('unit', 10).notNullable();
    t.integer('age_at_measurement_days').notNullable();
    t.decimal('percentile', 5, 2).nullable();
    t.decimal('z_score', 6, 3).nullable();
    t.string('reference_source', 10).nullable();
    t.timestamp('measured_at', { useTz: true }).notNullable();
    t.uuid('recorded_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.text('note').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'patient_id', 'measured_at']);
    t.index(['clinic_id', 'patient_id', 'measurement_type']);
  });
  await knex.raw(`
    CREATE INDEX idx_growth_measurements_clinic_id ON growth_measurements (clinic_id);
    CREATE INDEX idx_growth_measurements_deleted_at ON growth_measurements (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE growth_measurements ADD CONSTRAINT growth_measurements_type_check
      CHECK (measurement_type IN ('weight_kg','height_cm','head_circumference_cm','bmi'));
    ALTER TABLE growth_measurements ADD CONSTRAINT growth_measurements_value_range_check
      CHECK (value > 0 AND value < 10000);
    ALTER TABLE growth_measurements ADD CONSTRAINT growth_measurements_age_range_check
      CHECK (age_at_measurement_days >= 0 AND age_at_measurement_days < 36525);
    ALTER TABLE growth_measurements ADD CONSTRAINT growth_measurements_reference_source_check
      CHECK (reference_source IS NULL OR reference_source IN ('who','cdc','local','unknown'));
    ALTER TABLE growth_measurements ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_growth_measurements_tenant ON growth_measurements
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_growth_measurements_updated_at
      BEFORE UPDATE ON growth_measurements
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── immunizations (CVX-coded; FHIR Immunization-aligned status enum) ──
  await knex.schema.createTable('immunizations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.string('cvx_code', 10).notNullable();
    t.string('vaccine_name', 200).notNullable();
    t.string('manufacturer', 100).nullable();
    t.string('series_name', 100).nullable();
    t.specificType('dose_number', 'smallint').nullable();
    t.specificType('series_doses', 'smallint').nullable();
    t.date('administered_date').notNullable();
    t.string('lot_number', 50).nullable();
    t.date('expiration_date').nullable();
    t.string('site', 30).nullable();
    t.string('route', 10).nullable();
    t.decimal('dose_quantity_ml', 5, 2).nullable();
    t.string('status', 20).notNullable().defaultTo('completed');
    t.text('not_done_reason').nullable();
    t.text('note').nullable();
    t.uuid('administered_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'cvx_code']);
    t.index(['clinic_id', 'patient_id', 'administered_date']);
  });
  await knex.raw(`
    CREATE INDEX idx_immunizations_clinic_id ON immunizations (clinic_id);
    CREATE INDEX idx_immunizations_deleted_at ON immunizations (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE immunizations ADD CONSTRAINT immunizations_status_check
      CHECK (status IN ('completed','entered-in-error','not-done'));
    ALTER TABLE immunizations ADD CONSTRAINT immunizations_dose_number_check
      CHECK (dose_number IS NULL OR (dose_number > 0 AND dose_number < 20));
    ALTER TABLE immunizations ADD CONSTRAINT immunizations_route_check
      CHECK (route IS NULL OR route IN ('IM','SC','ID','PO','IN','other'));
    ALTER TABLE immunizations ADD CONSTRAINT immunizations_site_check
      CHECK (site IS NULL OR site IN
        ('left-deltoid','right-deltoid','left-thigh','right-thigh',
         'left-buttock','right-buttock','oral','nasal','other'));
    ALTER TABLE immunizations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_immunizations_tenant ON immunizations
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_immunizations_updated_at
      BEFORE UPDATE ON immunizations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── developmental_milestones (paediatric domain tracking) ──
  await knex.schema.createTable('developmental_milestones', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.string('domain', 20).notNullable();
    t.string('milestone', 200).notNullable();
    t.specificType('expected_age_months', 'smallint').nullable();
    t.specificType('achieved_at_months', 'smallint').nullable();
    t.string('status', 20).notNullable().defaultTo('not_assessed');
    t.text('note').nullable();
    t.timestamp('assessed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('assessed_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'patient_id', 'domain']);
  });
  await knex.raw(`
    CREATE INDEX idx_developmental_milestones_clinic_id ON developmental_milestones (clinic_id);
    CREATE INDEX idx_developmental_milestones_deleted_at ON developmental_milestones (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE developmental_milestones ADD CONSTRAINT developmental_milestones_domain_check
      CHECK (domain IN ('gross_motor','fine_motor','language','cognitive','social_emotional'));
    ALTER TABLE developmental_milestones ADD CONSTRAINT developmental_milestones_status_check
      CHECK (status IN ('achieved','delayed','not_assessed','regression'));
    ALTER TABLE developmental_milestones ADD CONSTRAINT developmental_milestones_age_check
      CHECK ((expected_age_months IS NULL OR (expected_age_months >= 0 AND expected_age_months <= 240))
         AND (achieved_at_months IS NULL OR (achieved_at_months >= 0 AND achieved_at_months <= 240)));
    ALTER TABLE developmental_milestones ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_developmental_milestones_tenant ON developmental_milestones
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_developmental_milestones_updated_at
      BEFORE UPDATE ON developmental_milestones
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── pregnancies (parent for antenatal_visits; GTPAL JSONB) ──
  await knex.schema.createTable('pregnancies', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.date('lmp_date').notNullable();
    t.date('edd_date').notNullable();
    t.jsonb('gtpal').notNullable();
    t.string('status', 20).notNullable().defaultTo('ongoing');
    t.text('note').nullable();
    t.uuid('recorded_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'patient_id', 'status']);
  });
  await knex.raw(`
    CREATE INDEX idx_pregnancies_clinic_id ON pregnancies (clinic_id);
    CREATE INDEX idx_pregnancies_deleted_at ON pregnancies (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE pregnancies ADD CONSTRAINT pregnancies_status_check
      CHECK (status IN ('ongoing','delivered','miscarried','terminated'));
    ALTER TABLE pregnancies ADD CONSTRAINT pregnancies_date_range_check
      CHECK (edd_date >= lmp_date);
    ALTER TABLE pregnancies ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_pregnancies_tenant ON pregnancies
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_pregnancies_updated_at
      BEFORE UPDATE ON pregnancies
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── antenatal_visits (per-visit clinical observations; UNIQUE per pregnancy) ──
  await knex.schema.createTable('antenatal_visits', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('pregnancy_id').notNullable().references('id').inTable('pregnancies').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.integer('visit_number').notNullable();
    t.date('visit_date').notNullable();
    t.integer('ga_weeks').notNullable();
    t.integer('ga_days').notNullable();
    t.decimal('fundal_height_cm', 5, 2).nullable();
    t.integer('fetal_heart_rate_bpm').nullable();
    t.integer('bp_systolic').nullable();
    t.integer('bp_diastolic').nullable();
    t.string('urine_protein', 10).nullable();
    t.string('urine_glucose', 10).nullable();
    t.boolean('oedema').nullable();
    t.text('note').nullable();
    t.uuid('seen_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.unique(['pregnancy_id', 'visit_number']);
    t.index(['clinic_id']);
    t.index(['pregnancy_id']);
    t.index(['clinic_id', 'patient_id', 'visit_date']);
  });
  await knex.raw(`
    CREATE INDEX idx_antenatal_visits_clinic_id ON antenatal_visits (clinic_id);
    CREATE INDEX idx_antenatal_visits_deleted_at ON antenatal_visits (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE antenatal_visits ADD CONSTRAINT antenatal_visits_ga_weeks_check
      CHECK (ga_weeks >= 0 AND ga_weeks <= 45);
    ALTER TABLE antenatal_visits ADD CONSTRAINT antenatal_visits_ga_days_check
      CHECK (ga_days >= 0 AND ga_days <= 6);
    ALTER TABLE antenatal_visits ADD CONSTRAINT antenatal_visits_fetal_hr_check
      CHECK (fetal_heart_rate_bpm IS NULL OR (fetal_heart_rate_bpm >= 60 AND fetal_heart_rate_bpm <= 220));
    ALTER TABLE antenatal_visits ADD CONSTRAINT antenatal_visits_urine_protein_check
      CHECK (urine_protein IS NULL OR urine_protein IN ('negative','trace','+','++','+++','++++'));
    ALTER TABLE antenatal_visits ADD CONSTRAINT antenatal_visits_urine_glucose_check
      CHECK (urine_glucose IS NULL OR urine_glucose IN ('negative','trace','+','++','+++','++++'));
    ALTER TABLE antenatal_visits ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_antenatal_visits_tenant ON antenatal_visits
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_antenatal_visits_updated_at
      BEFORE UPDATE ON antenatal_visits
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION H4 — surgery + internal_medicine (6 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // - Surgery: surgical_cases (parent), safety_checklists, op_notes,
  //   pacu_records (4 tables; the latter 3 CASCADE from surgical_cases)
  // - Internal medicine: problem_list, medication_reconciliations
  //
  // op_notes, safety_checklists, pacu_records are APPEND-ONLY
  // (no updated_at column, no update trigger) — clinical correction
  // creates a new row rather than mutating the original. This matches
  // medical-record immutability conventions.

  // ── surgical_cases (parent — WHO surgical-safety case record) ──
  await knex.schema.createTable('surgical_cases', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.string('procedure_code', 50).notNullable();
    t.string('procedure_display', 500).notNullable();
    t.uuid('primary_surgeon_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.date('planned_date').notNullable();
    t.string('urgency', 20).notNullable();
    t.specificType('asa_class', 'smallint').notNullable();
    t.string('consent_status', 20).notNullable().defaultTo('pending');
    t.string('status', 20).notNullable().defaultTo('scheduled');
    t.text('note').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'patient_id', 'planned_date']);
    t.index(['clinic_id', 'status']);
  });
  await knex.raw(`
    CREATE INDEX idx_surgical_cases_clinic_id ON surgical_cases (clinic_id);
    CREATE INDEX idx_surgical_cases_deleted_at ON surgical_cases (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE surgical_cases ADD CONSTRAINT surgical_cases_urgency_check
      CHECK (urgency IN ('elective','urgent','emergency'));
    ALTER TABLE surgical_cases ADD CONSTRAINT surgical_cases_asa_class_check
      CHECK (asa_class >= 1 AND asa_class <= 6);
    ALTER TABLE surgical_cases ADD CONSTRAINT surgical_cases_consent_status_check
      CHECK (consent_status IN ('pending','signed','withdrawn'));
    ALTER TABLE surgical_cases ADD CONSTRAINT surgical_cases_status_check
      CHECK (status IN ('scheduled','in_progress','completed','cancelled'));
    ALTER TABLE surgical_cases ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_surgical_cases_tenant ON surgical_cases
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_surgical_cases_updated_at
      BEFORE UPDATE ON surgical_cases
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── safety_checklists deliberately NOT declared here — already
  // created in Section F1 with the case_id FK deferred to Section N
  // (which is where surgical_cases gets attached as the parent).
  // See line ~2812.

  // ── op_notes (APPEND-ONLY; UNIQUE per case_id; intra-op record) ──
  await knex.schema.createTable('op_notes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('case_id').notNullable().references('id').inTable('surgical_cases').onDelete('CASCADE');
    t.text('indication').notNullable();
    t.text('findings').notNullable();
    t.text('procedure_text').notNullable();
    t.text('complications').nullable();
    t.integer('estimated_blood_loss_ml').nullable();
    t.jsonb('specimens').notNullable().defaultTo('[]');
    t.uuid('closed_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('closed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.unique(['case_id']);
    t.index(['clinic_id']);
    t.index(['case_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_op_notes_clinic_id ON op_notes (clinic_id);
    CREATE INDEX idx_op_notes_deleted_at ON op_notes (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE op_notes ADD CONSTRAINT op_notes_ebl_check
      CHECK (estimated_blood_loss_ml IS NULL OR estimated_blood_loss_ml >= 0);
    ALTER TABLE op_notes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_op_notes_tenant ON op_notes
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── pacu_records (APPEND-ONLY; per-recovery vitals + Aldrete score) ──
  await knex.schema.createTable('pacu_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('case_id').notNullable().references('id').inTable('surgical_cases').onDelete('CASCADE');
    t.jsonb('vitals').notNullable();
    t.specificType('aldrete_score', 'smallint').notNullable();
    t.boolean('discharge_criteria_met').notNullable().defaultTo(false);
    t.timestamp('recovery_end_at', { useTz: true }).nullable();
    t.text('note').nullable();
    t.uuid('recorded_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['case_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_pacu_records_clinic_id ON pacu_records (clinic_id);
    CREATE INDEX idx_pacu_records_deleted_at ON pacu_records (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE pacu_records ADD CONSTRAINT pacu_records_aldrete_check
      CHECK (aldrete_score >= 0 AND aldrete_score <= 10);
    ALTER TABLE pacu_records ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_pacu_records_tenant ON pacu_records
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── problem_list (FHIR Condition-aligned; chronic disease register) ──
  await knex.schema.createTable('problem_list', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.string('code_system', 50).notNullable().defaultTo('snomed');
    t.string('code', 40).notNullable();
    t.string('display', 500).notNullable();
    t.string('category', 30).notNullable().defaultTo('problem-list-item');
    t.string('clinical_status', 20).notNullable().defaultTo('active');
    t.string('verification_status', 20).notNullable().defaultTo('confirmed');
    t.string('severity', 20).nullable();
    t.boolean('is_chronic').notNullable().defaultTo(false);
    t.date('onset_date').nullable();
    t.specificType('onset_age_years', 'smallint').nullable();
    t.date('abatement_date').nullable();
    t.text('note').nullable();
    t.timestamp('recorded_date', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('recorded_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'patient_id', 'clinical_status']);
    t.index(['clinic_id', 'is_chronic']);
  });
  await knex.raw(`
    CREATE INDEX idx_problem_list_clinic_id ON problem_list (clinic_id);
    CREATE INDEX idx_problem_list_deleted_at ON problem_list (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE problem_list ADD CONSTRAINT problem_list_category_check
      CHECK (category IN ('problem-list-item','encounter-diagnosis','health-concern'));
    ALTER TABLE problem_list ADD CONSTRAINT problem_list_clinical_status_check
      CHECK (clinical_status IN ('active','recurrence','relapse','inactive','remission','resolved'));
    ALTER TABLE problem_list ADD CONSTRAINT problem_list_verification_status_check
      CHECK (verification_status IN ('unconfirmed','provisional','differential','confirmed','refuted','entered-in-error'));
    ALTER TABLE problem_list ADD CONSTRAINT problem_list_severity_check
      CHECK (severity IS NULL OR severity IN ('mild','moderate','severe'));
    ALTER TABLE problem_list ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_problem_list_tenant ON problem_list
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_problem_list_updated_at
      BEFORE UPDATE ON problem_list
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── medication_reconciliations (admission/discharge/transfer med-rec) ──
  await knex.schema.createTable('medication_reconciliations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.string('context', 30).notNullable();
    t.timestamp('performed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('performed_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.jsonb('snapshot').notNullable().defaultTo('[]');
    t.integer('continued_count').notNullable().defaultTo(0);
    t.integer('ceased_count').notNullable().defaultTo(0);
    t.integer('modified_count').notNullable().defaultTo(0);
    t.integer('new_count').notNullable().defaultTo(0);
    t.integer('on_hold_count').notNullable().defaultTo(0);
    t.text('summary_notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'patient_id', 'performed_at'], 'medication_reconciliations_clinic_id_patient_id_performed_at_in');
  });
  await knex.raw(`
    CREATE INDEX idx_medication_reconciliations_clinic_id ON medication_reconciliations (clinic_id);
    CREATE INDEX idx_medication_reconciliations_deleted_at ON medication_reconciliations (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE medication_reconciliations ADD CONSTRAINT medication_reconciliations_context_check
      CHECK (context IN ('admission','discharge','transfer','outpatient','periodic-review'));
    ALTER TABLE medication_reconciliations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_medication_reconciliations_tenant ON medication_reconciliations
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_medication_reconciliations_updated_at
      BEFORE UPDATE ON medication_reconciliations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION I — appointments + calendar (4 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // appointments (parent — 38 cols incl. 5 legacy/canonical pairs),
  // appointment_attendees (multi-clinician junction),
  // appointment_checklists (per-visit task list),
  // clinician_availability_blocks (calendar traffic-light blocks).
  //
  // Duplicate columns on appointments preserved for byte-compat:
  //   - start_time / appointment_start
  //   - end_time / appointment_end
  //   - type / appointment_type
  //   - telehealth_url / telehealth_link
  // Phase R3 reconciles these via repository translation layer.

  // ── appointments (38 cols; self-FK for recurrence; specialty_code FK) ──
  await knex.schema.createTable('appointments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('clinician_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.uuid('staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.timestamp('start_time', { useTz: true }).notNullable();
    t.timestamp('end_time', { useTz: true }).notNullable();
    t.timestamp('appointment_start', { useTz: true }).nullable();
    t.timestamp('appointment_end', { useTz: true }).nullable();
    t.integer('duration_minutes').nullable();
    t.string('status', 50).notNullable().defaultTo('scheduled');
    t.string('type', 50).notNullable().defaultTo('initial');
    t.string('appointment_type', 50).nullable();
    t.string('mode', 50).nullable();
    t.string('mbs_item', 20).nullable();
    t.string('patient_response', 50).nullable();
    t.string('location', 200).nullable();
    t.text('notes').nullable();
    t.boolean('telehealth').defaultTo(false);
    t.string('telehealth_url', 500).nullable();
    t.string('telehealth_link', 500).nullable();
    t.string('telehealth_provider', 100).nullable();
    t.string('telehealth_passcode', 100).nullable();
    t.string('cancellation_reason', 500).nullable();
    t.uuid('cancelled_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    // Self-FK for recurring appointments — points back to first occurrence.
    t.uuid('rescheduled_from_id').nullable();
    t.boolean('reminder_scheduled').notNullable().defaultTo(false);
    t.boolean('reminder_sent').notNullable().defaultTo(false);
    t.timestamp('reminder_sent_at', { useTz: true }).nullable();
    t.string('outlook_event_id', 255).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.string('recurrence_rule', 30).nullable();
    t.date('recurrence_end_date').nullable();
    t.uuid('recurrence_parent_id').nullable();
    t.string('specialty_code', 40).notNullable().defaultTo('mental_health');
    // Self-FK constraints (added inline since appointments references appointments).
    t.foreign('recurrence_parent_id').references('id').inTable('appointments').onDelete('SET NULL');
    // specialty_code → specialties(code) FK
    t.foreign('specialty_code').references('code').inTable('specialties').onUpdate('CASCADE').onDelete('RESTRICT');

    t.index(['clinic_id', 'clinician_id']);
    t.index(['clinic_id', 'patient_id']);
    t.index(['clinic_id', 'start_time']);
    t.index(['clinic_id', 'status']);
    t.index(['deleted_at']);
    t.index(['patient_id'], 'appointments_patient_id_idx');
    t.index(['recurrence_parent_id']);
    t.index(['staff_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_appointments_cancelled_by_id ON appointments (cancelled_by_id);
    CREATE INDEX idx_appointments_clinic_id ON appointments (clinic_id);
    CREATE INDEX idx_appointments_clinician_id ON appointments (clinician_id);
    CREATE INDEX idx_appointments_deleted_at ON appointments (deleted_at)
      WHERE deleted_at IS NULL;
    CREATE INDEX idx_appointments_episode_id ON appointments (episode_id);
    CREATE INDEX idx_appointments_not_deleted ON appointments (id)
      WHERE deleted_at IS NULL;
    CREATE INDEX appointments_specialty_idx ON appointments (clinic_id, specialty_code, appointment_start)
      WHERE deleted_at IS NULL;
    ALTER TABLE appointments ADD CONSTRAINT appointments_status_valid
      CHECK (status IN ('scheduled','confirmed','arrived','in_session',
                        'completed','cancelled','no_show','rescheduled'));
    ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_appointments_tenant ON appointments
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_appointments_updated_at
      BEFORE UPDATE ON appointments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── appointment_attendees (multi-clinician junction; CASCADE all FKs) ──
  await knex.schema.createTable('appointment_attendees', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('appointment_id').notNullable().references('id').inTable('appointments').onDelete('CASCADE');
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.string('role', 20).notNullable().defaultTo('co_clinician');
    t.string('attendance_status', 20).notNullable().defaultTo('required');
    t.timestamp('invited_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('responded_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['appointment_id', 'staff_id'], { indexName: 'appointment_attendees_unique' });
    t.index(['appointment_id'], 'appointment_attendees_appointment_idx');
    t.index(['clinic_id', 'staff_id', 'appointment_id'], 'appointment_attendees_my_calendar_idx');
  });
  await knex.raw(`
    CREATE INDEX idx_appointment_attendees_clinic_id ON appointment_attendees (clinic_id);
    ALTER TABLE appointment_attendees ADD CONSTRAINT aa_role_chk
      CHECK (role IN ('primary','co_clinician','supervisor','observer','interpreter','support'));
    ALTER TABLE appointment_attendees ADD CONSTRAINT aa_attendance_status_chk
      CHECK (attendance_status IN ('required','accepted','tentative','declined',
                                   'attended','did_not_attend','removed'));
    ALTER TABLE appointment_attendees ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_appointment_attendees_tenant ON appointment_attendees
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_appointment_attendees_updated_at
      BEFORE UPDATE ON appointment_attendees
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── appointment_checklists (per-visit task list; APPEND-ONLY, no soft-delete) ──
  await knex.schema.createTable('appointment_checklists', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
    t.uuid('patient_id').notNullable().references('id').inTable('patients');
    t.uuid('appointment_id').nullable();
    t.string('item', 500).notNullable();
    t.boolean('is_completed').notNullable().defaultTo(false);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.uuid('created_by').nullable().references('id').inTable('staff');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_appointment_checklists_clinic_id ON appointment_checklists (clinic_id);
    CREATE INDEX idx_appointment_checklists_created_by ON appointment_checklists (created_by);
    CREATE INDEX idx_appt_checklist_appt ON appointment_checklists (appointment_id);
    CREATE INDEX idx_appt_checklist_clinic ON appointment_checklists (clinic_id);
    CREATE INDEX idx_appt_checklist_patient ON appointment_checklists (patient_id);
    -- appointment FK with name fk_appointment_checklists_appointment_id (per archived migration)
    ALTER TABLE appointment_checklists
      ADD CONSTRAINT fk_appointment_checklists_appointment_id
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;
    ALTER TABLE appointment_checklists ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_appointment_checklists_tenant ON appointment_checklists
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- Duplicate policy in archived migration; preserved verbatim for byte-compat.
    CREATE POLICY rls_appt_checklists ON appointment_checklists
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── clinician_availability_blocks (calendar traffic-light: red/yellow/green) ──
  await knex.schema.createTable('clinician_availability_blocks', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('clinician_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.string('colour', 10).notNullable();
    t.string('recurrence', 10).notNullable().defaultTo('weekly');
    t.specificType('day_of_week', 'smallint').nullable();
    t.date('specific_date').nullable();
    t.specificType('start_time', 'time without time zone').notNullable();
    t.specificType('end_time', 'time without time zone').notNullable();
    // effective_from has CURRENT_TIMESTAMP default that resolves to date in the live DB.
    t.date('effective_from').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
    t.date('effective_until').nullable();
    t.string('label', 200).nullable();
    t.text('notes').nullable();
    t.uuid('created_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['deleted_at'], 'cab_deleted_at_idx');
    t.index(['clinic_id', 'clinician_id', 'specific_date'], 'cab_oneoff_idx');
    t.index(['clinic_id', 'clinician_id', 'day_of_week'], 'cab_weekly_idx');
  });
  await knex.raw(`
    CREATE INDEX idx_clinician_availability_blocks_clinic_id ON clinician_availability_blocks (clinic_id);
    CREATE INDEX idx_clinician_availability_blocks_deleted_at ON clinician_availability_blocks (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE clinician_availability_blocks ADD CONSTRAINT cab_colour_chk
      CHECK (colour IN ('red','yellow','green'));
    ALTER TABLE clinician_availability_blocks ADD CONSTRAINT cab_recurrence_chk
      CHECK (recurrence IN ('none','weekly'));
    ALTER TABLE clinician_availability_blocks ADD CONSTRAINT cab_day_of_week_chk
      CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6));
    ALTER TABLE clinician_availability_blocks ADD CONSTRAINT cab_recurrence_shape_chk
      CHECK ((recurrence = 'weekly' AND day_of_week IS NOT NULL AND specific_date IS NULL)
          OR (recurrence = 'none'   AND day_of_week IS NULL     AND specific_date IS NOT NULL));
    ALTER TABLE clinician_availability_blocks ADD CONSTRAINT cab_time_range_chk
      CHECK (end_time > start_time);
    ALTER TABLE clinician_availability_blocks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinician_availability_blocks_tenant ON clinician_availability_blocks
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_clinician_availability_blocks_updated_at
      BEFORE UPDATE ON clinician_availability_blocks
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION J — billing (7 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // fee_schedules + clinician_fee_overrides (per-clinic + per-staff
  // pricing), billing_accounts (patient-scoped account/payer), invoices
  // (parent), invoice_line_items (no RLS — child of invoice),
  // payments (paid-back records), referral_validity (12-month MBS rule),
  // billing_queue (claim submission state).
  //
  // billing_accounts has the audit_trigger_fn AFTER trigger — only
  // table in this section that's audited at row level. Fix-registry
  // SD40-43 are baked in:
  //   - payments.amount_cents (not amount)
  //   - payments.reference (not reference_number)
  //   - invoices.paid_cents/total_cents (not paid_amount/total_amount)
  //   - invoice_line_items.mbs_item_code (not mbs_item_number)

  // ── fee_schedules (per-clinic MBS / DVA / NDIS fee table) ──
  await knex.schema.createTable('fee_schedules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('item_number', 20).notNullable();
    t.string('description', 500).notNullable();
    t.integer('schedule_fee_cents').notNullable();
    t.string('category', 50).notNullable();
    t.string('modality', 30).nullable();
    t.integer('min_duration_mins').nullable();
    t.integer('max_duration_mins').nullable();
    t.boolean('is_initial').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.string('source', 20).notNullable().defaultTo('mbs');
    t.date('effective_from').nullable();
    t.date('effective_to').nullable();
    t.integer('sort_order').defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    CREATE INDEX idx_fee_schedules_active ON fee_schedules (clinic_id, is_active);
    CREATE INDEX idx_fee_schedules_category ON fee_schedules (clinic_id, category);
    CREATE INDEX idx_fee_schedules_clinic_id ON fee_schedules (clinic_id);
    ALTER TABLE fee_schedules ADD CONSTRAINT uq_fee_schedule_item
      UNIQUE (clinic_id, item_number, source, effective_from);
    ALTER TABLE fee_schedules ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_fee_schedules_tenant ON fee_schedules
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_fee_schedules_updated_at
      BEFORE UPDATE ON fee_schedules
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── clinician_fee_overrides (per-staff fee adjustment vs schedule) ──
  await knex.schema.createTable('clinician_fee_overrides', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.string('item_number', 20).notNullable();
    t.integer('provider_fee_cents').notNullable();
    t.integer('gap_cents').notNullable().defaultTo(0);
    t.boolean('bulk_bill_eligible').notNullable().defaultTo(false);
    t.text('notes').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    CREATE INDEX idx_clinician_fee_overrides_clinic_id ON clinician_fee_overrides (clinic_id);
    CREATE INDEX idx_clinician_fees_staff ON clinician_fee_overrides (clinic_id, staff_id);
    ALTER TABLE clinician_fee_overrides ADD CONSTRAINT uq_clinician_fee_override
      UNIQUE (clinic_id, staff_id, item_number);
    ALTER TABLE clinician_fee_overrides ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinician_fee_overrides_tenant ON clinician_fee_overrides
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_clinician_fee_overrides_updated_at
      BEFORE UPDATE ON clinician_fee_overrides
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── billing_accounts (patient payer setup; legacy+canonical cols preserved) ──
  await knex.schema.createTable('billing_accounts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').nullable().references('id').inTable('patients').onDelete('SET NULL');
    t.string('account_type', 50).nullable();
    t.string('medicare_number', 30).nullable();
    t.string('dva_number', 30).nullable();
    t.string('private_health_fund', 100).nullable();
    t.string('member_number', 50).nullable();
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('billing_type', 30).nullable();
    t.string('health_fund_name', 100).nullable();
    t.string('health_fund_member_number', 50).nullable();
    t.string('ndis_number', 30).nullable();
    t.string('ndis_package_manager', 200).nullable();
    t.string('dva_card_type', 10).nullable();
    t.text('notes').nullable();
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    t.index(['clinic_id', 'patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_billing_accounts_clinic_id ON billing_accounts (clinic_id);
    CREATE INDEX idx_billing_accounts_patient_id ON billing_accounts (patient_id);
    ALTER TABLE billing_accounts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_billing_accounts_tenant ON billing_accounts
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_billing_accounts_updated_at
      BEFORE UPDATE ON billing_accounts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER trg_billing_accounts_audit
      AFTER INSERT OR DELETE OR UPDATE ON billing_accounts
      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
  `);

  // ── invoices (parent — SD42 paid_cents/total_cents canonical names) ──
  await knex.schema.createTable('invoices', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').nullable().references('id').inTable('patients').onDelete('SET NULL');
    t.uuid('clinician_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.string('invoice_number', 50).nullable();
    t.date('service_date').nullable();
    t.string('mbs_item_code', 20).nullable();
    t.string('mbs_item_description', 300).nullable();
    t.integer('fee_cents').nullable();
    t.string('status', 30).defaultTo('pending');
    t.string('payment_method', 50).nullable();
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('appointment_id').nullable().references('id').inTable('appointments').onDelete('SET NULL');
    t.string('billing_type', 30).nullable();
    t.integer('subtotal_cents').defaultTo(0);
    t.integer('gst_cents').defaultTo(0);
    t.integer('total_cents').defaultTo(0);
    t.integer('paid_cents').defaultTo(0);
    t.integer('gap_cents').defaultTo(0);
    t.integer('schedule_fee_cents').defaultTo(0);
    t.integer('rebate_cents').defaultTo(0);
    t.integer('provider_fee_cents').defaultTo(0);
    t.date('due_date').nullable();
    t.timestamp('approved_at', { useTz: true }).nullable();
    t.uuid('approved_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('sent_at', { useTz: true }).nullable();
    t.boolean('auto_generated').notNullable().defaultTo(false);
    t.text('override_notes').nullable();
    t.boolean('referral_valid').defaultTo(true);

    t.index(['clinic_id', 'appointment_id'], 'idx_invoices_appointment');
    t.index(['clinic_id', 'billing_type', 'status'], 'idx_invoices_billing_type');
    t.index(['clinic_id', 'status']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_invoices_approved_by_staff_id ON invoices (approved_by_staff_id);
    CREATE INDEX idx_invoices_clinic_id ON invoices (clinic_id);
    CREATE INDEX idx_invoices_clinician_id ON invoices (clinician_id);
    CREATE INDEX idx_invoices_patient_id ON invoices (patient_id);
    ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_invoices_tenant ON invoices
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_invoices_updated_at
      BEFORE UPDATE ON invoices
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── invoice_line_items (NO RLS — parent invoice handles tenancy) ──
  // SD43: mbs_item_code (not mbs_item_number).
  await knex.schema.createTable('invoice_line_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('invoice_id').nullable().references('id').inTable('invoices').onDelete('CASCADE');
    t.string('mbs_item_code', 20).nullable();
    t.string('description', 300).nullable();
    t.integer('fee_cents').nullable();
    t.integer('quantity').defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('unit_price_cents').defaultTo(0);
    t.integer('discount_cents').defaultTo(0);
    t.integer('line_total_cents').defaultTo(0);
    t.integer('schedule_fee_cents').defaultTo(0);
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));

    t.index(['invoice_id']);
  });
  await knex.raw(`
    CREATE TRIGGER trg_invoice_line_items_updated_at
      BEFORE UPDATE ON invoice_line_items
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── payments (SD40 amount_cents + SD41 reference canonical names) ──
  // payments.clinic_id has ON DELETE SET NULL (atypical) — preserved.
  await knex.schema.createTable('payments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('invoice_id').nullable().references('id').inTable('invoices').onDelete('SET NULL');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('SET NULL');
    t.integer('amount_cents').nullable();
    t.string('payment_method', 50).nullable();
    t.string('reference', 100).nullable();
    t.string('status', 30).defaultTo('completed');
    t.timestamp('paid_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('received_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.date('payment_date').nullable();
    t.string('claim_status', 30).defaultTo('not_submitted');
    t.string('claim_reference', 100).nullable();
    t.text('notes').nullable();
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    t.index(['clinic_id']);
    t.index(['invoice_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_payments_clinic_id ON payments (clinic_id);
    CREATE INDEX idx_payments_received_by_id ON payments (received_by_id);
    ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_payments_tenant ON payments
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_payments_updated_at
      BEFORE UPDATE ON payments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── referral_validity (12-month MBS rule tracking; replaces legacy
  //   referrals.episode_id mismatches per SD13/SD44) ──
  await knex.schema.createTable('referral_validity', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('referring_provider_name', 200).notNullable();
    t.string('referring_provider_number', 30).nullable();
    t.string('referral_type', 20).notNullable().defaultTo('gp');
    t.date('referral_date').notNullable();
    t.date('expires_at').notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'patient_id', 'is_active'], 'idx_referral_validity_patient');
  });
  await knex.raw(`
    CREATE INDEX idx_referral_validity_clinic_id ON referral_validity (clinic_id);
    ALTER TABLE referral_validity ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_referral_validity_tenant ON referral_validity
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_referral_validity_updated_at
      BEFORE UPDATE ON referral_validity
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── billing_queue (claim submission state; CASCADE from invoice) ──
  await knex.schema.createTable('billing_queue', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('invoice_id').notNullable().references('id').inTable('invoices').onDelete('CASCADE');
    t.string('claim_type', 20).notNullable();
    t.string('status', 20).notNullable().defaultTo('queued');
    t.timestamp('submitted_at', { useTz: true }).nullable();
    t.string('response_code', 50).nullable();
    t.text('response_message').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['invoice_id']);
    t.index(['clinic_id', 'status'], 'idx_billing_queue_status');
  });
  await knex.raw(`
    CREATE INDEX idx_billing_queue_clinic_id ON billing_queue (clinic_id);
    ALTER TABLE billing_queue ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_billing_queue_tenant ON billing_queue
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION K — messaging + notifications + outreach (10 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // - In-app messaging: message_threads (parent), messages (child),
  //   message_thread_participants (junction, NO clinic_id/no RLS — child)
  // - In-app notifications: notifications (Phase 10A)
  // - Escalations: escalations (parent), escalation_events (child,
  //   NO clinic_id/no RLS)
  // - Patient outreach: patient_outreach_log (Phase 12A)
  // - FCM device registries: patient_fcm_tokens, staff_fcm_tokens
  // - Sync preferences: patient_sync_preferences (per-module opt-in)

  // ── message_threads (parent — patient-scoped conversation thread) ──
  await knex.schema.createTable('message_threads', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('created_by_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('SET NULL');
    t.string('subject', 300).notNullable();
    t.timestamp('last_message_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_message_threads_clinic_id ON message_threads (clinic_id);
    CREATE INDEX idx_message_threads_created_by_id ON message_threads (created_by_id);
    CREATE INDEX idx_message_threads_deleted_at ON message_threads (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE message_threads ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_message_threads_tenant ON message_threads
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_message_threads_updated_at
      BEFORE UPDATE ON message_threads
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── messages (child of message_threads) ──
  await knex.schema.createTable('messages', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('thread_id').nullable().references('id').inTable('message_threads').onDelete('CASCADE');
    t.uuid('sender_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.text('content').nullable();
    t.boolean('is_read').defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['thread_id', 'created_at'], 'messages_thread_id_created_at_index');
  });
  await knex.raw(`
    CREATE INDEX idx_messages_clinic_id ON messages (clinic_id);
    CREATE INDEX idx_messages_sender_id ON messages (sender_id);
    CREATE INDEX idx_messages_thread_id ON messages (thread_id);
    ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_messages_tenant ON messages
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_messages_updated_at
      BEFORE UPDATE ON messages
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── message_thread_participants (NO clinic_id, NO RLS — child) ──
  // Tenancy via thread_id → message_threads.clinic_id.
  await knex.schema.createTable('message_thread_participants', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('thread_id').notNullable().references('id').inTable('message_threads').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.timestamp('last_read_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));

    t.unique(['thread_id', 'user_id']);
  });
  await knex.raw(`
    CREATE TRIGGER trg_message_thread_participants_updated_at
      BEFORE UPDATE ON message_thread_participants
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── notifications (Phase 10A; complex partial indexes + audit trigger) ──
  await knex.schema.createTable('notifications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('recipient_staff_id').nullable().references('id').inTable('staff').onDelete('CASCADE');
    t.string('type', 50).notNullable().defaultTo('generic');
    t.string('title', 300).notNullable();
    t.text('body').nullable();
    t.string('link', 500).nullable();
    t.string('priority', 20).defaultTo('normal');
    t.boolean('is_read').notNullable().defaultTo(false);
    t.timestamp('read_at', { useTz: true }).nullable();
    t.string('source_type', 50).nullable();
    t.uuid('source_id').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).nullable();
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('severity', 16).nullable();
    t.string('category', 40).nullable();
    t.jsonb('payload').nullable();
    t.boolean('override_patient_sync').notNullable().defaultTo(false);

    t.index(['clinic_id']);
    t.index(['recipient_staff_id', 'is_read', 'created_at']);
  });
  await knex.raw(`
    CREATE INDEX idx_notifications_clinic_id ON notifications (clinic_id);
    -- Clinic-broadcast: recipient_staff_id IS NULL means clinic-wide
    CREATE INDEX idx_notifications_clinic_broadcast ON notifications (clinic_id, created_at DESC)
      WHERE recipient_staff_id IS NULL;
    -- Bell unread hot path
    CREATE INDEX idx_notifications_user_unread_bell ON notifications (clinic_id, recipient_staff_id, created_at DESC)
      WHERE is_read = false;
    -- Janitor sweep
    CREATE INDEX idx_notifications_expiry ON notifications (expires_at)
      WHERE expires_at IS NOT NULL;
    -- Phase 10A dedupe key — UNIQUE partial on payload->>'dedupe_key'
    CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications (clinic_id, ((payload ->> 'dedupe_key'::text)))
      WHERE (payload ->> 'dedupe_key'::text) IS NOT NULL;
    ALTER TABLE notifications ADD CONSTRAINT notifications_severity_check
      CHECK (severity IS NULL OR severity IN ('info','success','warning','critical'));
    ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_notifications_tenant ON notifications
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_notifications_updated_at
      BEFORE UPDATE ON notifications
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER trg_notifications_audit
      AFTER INSERT OR DELETE OR UPDATE ON notifications
      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
  `);

  // ── escalations (5 staff FKs all SET NULL; ISBAR description JSON) ──
  await knex.schema.createTable('escalations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').nullable().references('id').inTable('patients').onDelete('SET NULL');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('raised_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('assigned_to_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('acknowledged_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('resolved_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.string('type', 50).nullable();
    t.string('severity', 30).nullable();
    t.string('title', 300).nullable();
    t.text('description').nullable();
    t.string('status', 30).defaultTo('open');
    t.text('resolution').nullable();
    t.timestamp('acknowledged_at', { useTz: true }).nullable();
    t.timestamp('resolved_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id', 'status']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_escalations_acknowledged_by_id ON escalations (acknowledged_by_id);
    CREATE INDEX idx_escalations_assigned_to_id ON escalations (assigned_to_id);
    CREATE INDEX idx_escalations_clinic_id ON escalations (clinic_id);
    CREATE INDEX idx_escalations_deleted_at ON escalations (deleted_at)
      WHERE deleted_at IS NULL;
    CREATE INDEX idx_escalations_episode_id ON escalations (episode_id);
    CREATE INDEX idx_escalations_raised_by_id ON escalations (raised_by_id);
    CREATE INDEX idx_escalations_resolved_by_id ON escalations (resolved_by_id);
    ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_escalations_tenant ON escalations
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_escalations_updated_at
      BEFORE UPDATE ON escalations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── escalation_events (NO clinic_id, NO RLS — child of escalations) ──
  await knex.schema.createTable('escalation_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('escalation_id').nullable().references('id').inTable('escalations').onDelete('CASCADE');
    t.uuid('actor_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.string('event_type', 50).nullable();
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));

    t.index(['escalation_id'], 'escalation_events_escalation_id_index');
  });
  await knex.raw(`
    CREATE INDEX idx_escalation_events_actor_id ON escalation_events (actor_id);
    CREATE TRIGGER trg_escalation_events_updated_at
      BEFORE UPDATE ON escalation_events
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── patient_outreach_log (Phase 12A; APPEND-ONLY; override-consistency CHECK) ──
  await knex.schema.createTable('patient_outreach_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('kind', 60).notNullable();
    t.string('channel', 20).notNullable();
    t.string('skip_reason', 60).nullable();
    t.text('provider_message_id').nullable();
    t.text('title').nullable();
    t.text('body').nullable();
    t.text('deep_link').nullable();
    t.string('override_channel', 20).nullable();
    t.text('override_reason').nullable();
    t.uuid('override_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('attempted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('delivered_at', { useTz: true }).nullable();
    t.timestamp('failed_at', { useTz: true }).nullable();
    t.text('error_message').nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_patient_outreach_log_clinic_id ON patient_outreach_log (clinic_id);
    -- Patient timeline (attempted_at DESC for newest-first ordering — raw SQL because
    -- Knex schema builder does not support per-column index direction).
    CREATE INDEX idx_patient_outreach_log_patient_attempted ON patient_outreach_log
      (clinic_id, patient_id, attempted_at DESC);
    -- Failed-deliveries dashboard
    CREATE INDEX idx_patient_outreach_log_failed ON patient_outreach_log (clinic_id, attempted_at DESC)
      WHERE failed_at IS NOT NULL;
    ALTER TABLE patient_outreach_log ADD CONSTRAINT patient_outreach_log_channel_check
      CHECK (channel IN ('fcm','acs_sms','skipped'));
    ALTER TABLE patient_outreach_log ADD CONSTRAINT patient_outreach_log_override_channel_check
      CHECK (override_channel IS NULL OR override_channel IN ('fcm','acs_sms'));
    -- Override fields are all-3-or-none: prevents partial override audit trails
    ALTER TABLE patient_outreach_log ADD CONSTRAINT patient_outreach_log_override_consistency_check
      CHECK ((override_channel IS NULL AND override_reason IS NULL AND override_by_staff_id IS NULL)
          OR (override_channel IS NOT NULL AND override_reason IS NOT NULL AND override_by_staff_id IS NOT NULL));
    ALTER TABLE patient_outreach_log ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_outreach_log_tenant ON patient_outreach_log
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── patient_fcm_tokens (Viva mobile FCM device registry) ──
  await knex.schema.createTable('patient_fcm_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('patient_app_account_id').nullable().references('id').inTable('patient_app_accounts').onDelete('SET NULL');
    t.text('device_token').notNullable();
    t.string('platform', 10).notNullable();
    t.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.unique(['patient_id', 'device_token']);
    t.index(['clinic_id']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_patient_fcm_tokens_clinic_id ON patient_fcm_tokens (clinic_id);
    CREATE INDEX idx_patient_fcm_tokens_deleted_at ON patient_fcm_tokens (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE patient_fcm_tokens ADD CONSTRAINT patient_fcm_tokens_platform_check
      CHECK (platform IN ('ios','android'));
    ALTER TABLE patient_fcm_tokens ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_fcm_tokens_tenant ON patient_fcm_tokens
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── staff_fcm_tokens (Sara mobile FCM device registry) ──
  await knex.schema.createTable('staff_fcm_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.text('device_token').notNullable();
    t.string('platform', 10).notNullable();
    t.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.unique(['staff_id', 'device_token']);
    t.index(['clinic_id']);
    t.index(['staff_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_staff_fcm_tokens_clinic_id ON staff_fcm_tokens (clinic_id);
    CREATE INDEX idx_staff_fcm_tokens_deleted_at ON staff_fcm_tokens (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE staff_fcm_tokens ADD CONSTRAINT staff_fcm_tokens_platform_check
      CHECK (platform IN ('ios','android'));
    ALTER TABLE staff_fcm_tokens ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_staff_fcm_tokens_tenant ON staff_fcm_tokens
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── patient_sync_preferences (per-module sync opt-in) ──
  await knex.schema.createTable('patient_sync_preferences', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('module_key', 40).notNullable();
    t.boolean('enabled').notNullable().defaultTo(false);
    t.boolean('updated_by_patient').notNullable().defaultTo(false);
    t.uuid('updated_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['clinic_id', 'patient_id', 'module_key']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_patient_sync_preferences_clinic_id ON patient_sync_preferences (clinic_id);
    -- Mobile-sync hot path: which modules are currently enabled for this patient?
    CREATE INDEX idx_patient_sync_preferences_enabled ON patient_sync_preferences (patient_id, module_key)
      WHERE enabled = true;
    ALTER TABLE patient_sync_preferences ADD CONSTRAINT patient_sync_preferences_module_key_check
      CHECK (module_key IN ('appointments','messages','documents','notifications','reminders'));
    ALTER TABLE patient_sync_preferences ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_sync_preferences_tenant ON patient_sync_preferences
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_patient_sync_preferences_updated_at
      BEFORE UPDATE ON patient_sync_preferences
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION L1 — patient cluster catch-up (9 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // Tables that should have lived in Section D/E but were missed:
  // advance_directives, carers, contact_records, patient_alert_attachments,
  // patient_allergies, patient_flags, patient_merges, patient_shared_documents,
  // patient_tracking. Adding them here keeps each table's git history
  // pinned to one commit; Section N will add cross-table FKs that need
  // forward-references (contact_records.template_id → templates).
  //
  // 4 of 9 have audit_trigger_fn (advance_directives, carers,
  // contact_records, plus 2 added later). Patient_tracking and
  // patient_shared_documents have DUPLICATE RLS policies preserved
  // verbatim from archived migrations.

  // ── advance_directives (CARE wishes; AUDITED) ──
  await knex.schema.createTable('advance_directives', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('type', 100).notNullable();
    t.jsonb('content').nullable();
    t.string('status', 30).notNullable().defaultTo('active');
    t.date('valid_from').nullable();
    t.date('valid_until').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));

    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_advance_directives_clinic_id ON advance_directives (clinic_id);
    ALTER TABLE advance_directives ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_advance_directives_tenant ON advance_directives
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_advance_directives_updated_at
      BEFORE UPDATE ON advance_directives
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER trg_advance_directives_audit
      AFTER INSERT OR DELETE OR UPDATE ON advance_directives
      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
  `);

  // ── carers (next-of-kin / informal carer contacts; AUDITED) ──
  await knex.schema.createTable('carers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('given_name', 100).notNullable();
    t.string('family_name', 100).nullable();
    t.string('relationship', 100).nullable();
    t.string('phone', 30).nullable();
    t.string('email', 255).nullable();
    t.boolean('is_primary').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));

    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_carers_clinic_id ON carers (clinic_id);
    ALTER TABLE carers ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_carers_tenant ON carers
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_carers_updated_at
      BEFORE UPDATE ON carers
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER trg_carers_audit
      AFTER INSERT OR DELETE OR UPDATE ON carers
      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
  `);

  // ── contact_records (ABF/CMI service contact log; AUDITED;
  //   template_id FK DEFERRED to Section N — templates not declared yet) ──
  await knex.schema.createTable('contact_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.string('contact_type', 50).notNullable();
    t.date('contact_date').notNullable();
    t.specificType('contact_time', 'time without time zone').nullable();
    t.integer('duration_min').nullable();
    t.string('location', 200).nullable();
    t.string('contact_medium', 50).nullable();
    t.string('program', 100).nullable();
    t.string('service_recipients', 200).nullable();
    t.boolean('is_reportable').notNullable().defaultTo(true);
    t.string('team', 100).nullable();
    t.integer('num_providing').nullable();
    t.integer('num_receiving').nullable();
    t.text('content').nullable();
    t.uuid('template_id').nullable(); // FK → templates(id) deferred to Section N
    t.string('status', 30).notNullable().defaultTo('draft');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));

    t.index(['clinic_id', 'contact_date']);
    t.index(['clinic_id', 'patient_id']);
    t.index(['episode_id']);
    t.index(['patient_id'], 'contact_records_patient_id_idx');
  });
  await knex.raw(`
    CREATE INDEX idx_contact_records_clinic_id ON contact_records (clinic_id);
    CREATE INDEX idx_contact_records_episode_id ON contact_records (episode_id);
    CREATE INDEX idx_contact_records_staff_id ON contact_records (staff_id);
    ALTER TABLE contact_records ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_contact_records_tenant ON contact_records
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_contact_records_updated_at
      BEFORE UPDATE ON contact_records
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER trg_contact_records_audit
      AFTER INSERT OR DELETE OR UPDATE ON contact_records
      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
  `);

  // ── patient_alert_attachments (file attachments to patient_alerts) ──
  await knex.schema.createTable('patient_alert_attachments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_alert_id').notNullable().references('id').inTable('patient_alerts').onDelete('CASCADE');
    t.string('filename', 500).notNullable();
    t.string('mime_type', 100).nullable();
    t.integer('file_size').nullable();
    t.text('file_path').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('storage_backend').notNullable().defaultTo('local');
    t.text('storage_key').nullable();
    t.text('storage_bucket').nullable();
    t.text('storage_etag').nullable();
    t.uuid('clinic_id').nullable();
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));

    t.index(['patient_alert_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_patient_alert_attachments_clinic_id ON patient_alert_attachments (clinic_id);
    CREATE INDEX patient_alert_attachments_clinic_id_idx ON patient_alert_attachments (clinic_id);
    CREATE INDEX patient_alert_attachments_storage_key_idx ON patient_alert_attachments (storage_key);
    -- clinic_id FK with explicit name fk_patient_alert_attachments_clinic_id (per archived migration)
    ALTER TABLE patient_alert_attachments
      ADD CONSTRAINT fk_patient_alert_attachments_clinic_id
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
    ALTER TABLE patient_alert_attachments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_alert_attachments_tenant ON patient_alert_attachments
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_patient_alert_attachments_updated_at
      BEFORE UPDATE ON patient_alert_attachments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── patient_allergies (allergy register; severity + status enums) ──
  await knex.schema.createTable('patient_allergies', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('allergen', 200).notNullable();
    t.string('allergen_type', 50).notNullable();
    t.string('reaction', 200).nullable();
    t.string('severity', 30).notNullable().defaultTo('moderate');
    t.string('status', 30).notNullable().defaultTo('active');
    t.uuid('recorded_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['patient_id', 'status']);
  });
  await knex.raw(`
    CREATE INDEX idx_patient_allergies_clinic_id ON patient_allergies (clinic_id);
    CREATE INDEX idx_patient_allergies_deleted_at ON patient_allergies (deleted_at)
      WHERE deleted_at IS NULL;
    CREATE INDEX idx_patient_allergies_recorded_by_staff_id ON patient_allergies (recorded_by_staff_id);
    ALTER TABLE patient_allergies ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_allergies_tenant ON patient_allergies
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_patient_allergies_updated_at
      BEFORE UPDATE ON patient_allergies
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── patient_flags (clinical/admin flags; raised + resolved staff FKs) ──
  await knex.schema.createTable('patient_flags', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.string('category', 50).notNullable();
    t.string('severity', 30).notNullable().defaultTo('medium');
    t.string('title', 300).notNullable();
    t.text('description').nullable();
    t.string('status', 30).notNullable().defaultTo('active');
    t.uuid('raised_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('resolved_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('raised_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('resolved_at', { useTz: true }).nullable();
    t.string('related_record_type', 50).nullable();
    t.uuid('related_record_id').nullable();
    t.boolean('is_header_flag').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id', 'patient_id']);
    t.index(['patient_id', 'status']);
  });
  await knex.raw(`
    CREATE INDEX idx_patient_flags_clinic_id ON patient_flags (clinic_id);
    CREATE INDEX idx_patient_flags_deleted_at ON patient_flags (deleted_at)
      WHERE deleted_at IS NULL;
    CREATE INDEX idx_patient_flags_episode_id ON patient_flags (episode_id);
    CREATE INDEX idx_patient_flags_raised_by_staff_id ON patient_flags (raised_by_staff_id);
    CREATE INDEX idx_patient_flags_resolved_by_staff_id ON patient_flags (resolved_by_staff_id);
    ALTER TABLE patient_flags ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_flags_tenant ON patient_flags
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_patient_flags_updated_at
      BEFORE UPDATE ON patient_flags
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── patient_merges (audit trail for patient deduplication;
  //   distinct CHECK + reason min length; APPEND-ONLY) ──
  await knex.schema.createTable('patient_merges', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
    t.uuid('source_patient_id').notNullable().references('id').inTable('patients');
    t.uuid('destination_patient_id').notNullable().references('id').inTable('patients');
    t.uuid('merged_by').notNullable().references('id').inTable('staff');
    t.text('reason').notNullable();
    t.jsonb('source_snapshot').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id'], 'patient_merges_clinic_idx');
    t.index(['destination_patient_id'], 'patient_merges_destination_idx');
    t.index(['source_patient_id'], 'patient_merges_source_idx');
  });
  await knex.raw(`
    CREATE INDEX idx_patient_merges_clinic_id ON patient_merges (clinic_id);
    CREATE INDEX idx_patient_merges_merged_by ON patient_merges (merged_by);
    ALTER TABLE patient_merges ADD CONSTRAINT patient_merges_distinct
      CHECK (source_patient_id <> destination_patient_id);
    ALTER TABLE patient_merges ADD CONSTRAINT patient_merges_reason_min_length
      CHECK (char_length(reason) >= 10);
    ALTER TABLE patient_merges ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_merges_tenant ON patient_merges
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── patient_shared_documents (Viva-shared docs; 2 RLS policies preserved) ──
  await knex.schema.createTable('patient_shared_documents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
    t.uuid('patient_id').notNullable().references('id').inTable('patients');
    t.string('title', 255).notNullable();
    t.string('doc_type', 30).notNullable().defaultTo('document');
    t.text('file_path').nullable();
    t.text('url').nullable();
    t.uuid('shared_by').nullable().references('id').inTable('staff');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_patient_shared_documents_clinic_id ON patient_shared_documents (clinic_id);
    CREATE INDEX idx_patient_shared_documents_shared_by ON patient_shared_documents (shared_by);
    CREATE INDEX idx_shared_docs_clinic ON patient_shared_documents (clinic_id);
    CREATE INDEX idx_shared_docs_patient ON patient_shared_documents (patient_id);
    ALTER TABLE patient_shared_documents ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_shared_documents_tenant ON patient_shared_documents
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- Duplicate policy preserved verbatim from archived migration.
    CREATE POLICY rls_shared_docs ON patient_shared_documents
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── patient_tracking (Viva self-tracking time series; 2 RLS policies preserved) ──
  await knex.schema.createTable('patient_tracking', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
    t.uuid('patient_id').notNullable().references('id').inTable('patients');
    t.string('tracking_type', 30).notNullable();
    t.decimal('value', 10, 2).notNullable();
    t.text('note').nullable();
    t.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('source', 20).notNullable().defaultTo('patient_app');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id'], 'idx_patient_tracking_clinic');
    t.index(['patient_id', 'tracking_type']);
  });
  await knex.raw(`
    CREATE INDEX idx_patient_tracking_clinic_id ON patient_tracking (clinic_id);
    -- recorded_at DESC for newest-first ordering — raw SQL because Knex
    -- builder does not support per-column index direction.
    CREATE INDEX idx_patient_tracking_date ON patient_tracking (recorded_at DESC);
    CREATE INDEX idx_patient_tracking_patient ON patient_tracking (patient_id, tracking_type);
    ALTER TABLE patient_tracking ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_tracking ON patient_tracking
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- Duplicate policy preserved verbatim from archived migration.
    CREATE POLICY rls_patient_tracking_tenant ON patient_tracking
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION L2 — clinical catch-up (10 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // 10 clinical tables that should have lived in Section E but were
  // missed: clinical_note_evidence (RAG retrieval), clinical_policies
  // (clinical-decision rules), clinical_reviews, clinical_templates
  // (LEGACY — distinct from `templates` in L3), engagement_scores,
  // key_issues, review_plans, treatment_pathways (AUDITED), treatment_plans,
  // correspondence_letters (AUDITED + GENERATED tsvector + GIN index).
  //
  // Forward FKs deferred to Section N:
  //   - clinical_note_evidence.chunk_id → evidence_chunks (L7)
  //   - correspondence_letters.template_id → templates (L3)

  // ── clinical_note_evidence (RAG-retrieval evidence; APPEND-ONLY;
  //   chunk_id FK DEFERRED to Section N — evidence_chunks not declared yet) ──
  await knex.schema.createTable('clinical_note_evidence', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('note_id').notNullable().references('id').inTable('clinical_notes').onDelete('CASCADE');
    t.uuid('chunk_id').notNullable(); // FK → evidence_chunks(id) deferred to Section N
    t.uuid('clinic_id').notNullable();
    t.text('quoted_excerpt').nullable();
    t.string('section', 32).nullable();
    t.string('status', 16).notNullable().defaultTo('suggested');
    t.string('source', 32).notNullable().defaultTo('retrieval_v1');
    t.uuid('accepted_by_staff_id').nullable();
    t.timestamp('accepted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['note_id', 'chunk_id'], { indexName: 'clinical_note_evidence_note_id_chunk_id_unique' });
    t.index(['clinic_id']);
    t.index(['note_id', 'status']);
  });
  await knex.raw(`
    CREATE INDEX idx_clinical_note_evidence_clinic_id ON clinical_note_evidence (clinic_id);
    -- Named FK constraints (per archived migration): named instead of auto-named.
    ALTER TABLE clinical_note_evidence
      ADD CONSTRAINT fk_clinical_note_evidence_clinic_id
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
    ALTER TABLE clinical_note_evidence
      ADD CONSTRAINT fk_clinical_note_evidence_accepted_by_staff_id
      FOREIGN KEY (accepted_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL;
    ALTER TABLE clinical_note_evidence ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinical_note_evidence_tenant ON clinical_note_evidence
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── clinical_policies (per-clinic clinical-decision rules + LLM context) ──
  await knex.schema.createTable('clinical_policies', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 200).notNullable();
    t.text('description').nullable();
    t.string('rule_type', 50).notNullable().defaultTo('review_interval');
    t.jsonb('parameters').notNullable().defaultTo('{}');
    t.text('llm_context').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('generates_alert').notNullable().defaultTo(true);
    t.boolean('available_to_llm').notNullable().defaultTo(true);
    t.string('category', 50).nullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'is_active']);
    t.index(['clinic_id', 'rule_type']);
  });
  await knex.raw(`
    CREATE INDEX idx_clinical_policies_clinic_id ON clinical_policies (clinic_id);
    ALTER TABLE clinical_policies ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinical_policies_tenant ON clinical_policies
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_clinical_policies_updated_at
      BEFORE UPDATE ON clinical_policies
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── clinical_reviews (case-review records; per-encounter reviews) ──
  await knex.schema.createTable('clinical_reviews', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('reviewed_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.string('review_type', 50).nullable();
    t.date('review_date').nullable();
    t.text('summary').nullable();
    t.text('recommendations').nullable();
    t.string('status', 30).defaultTo('draft');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_clinical_reviews_clinic_id ON clinical_reviews (clinic_id);
    CREATE INDEX idx_clinical_reviews_episode_id ON clinical_reviews (episode_id);
    CREATE INDEX idx_clinical_reviews_reviewed_by_id ON clinical_reviews (reviewed_by_id);
    ALTER TABLE clinical_reviews ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinical_reviews_tenant ON clinical_reviews
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_clinical_reviews_updated_at
      BEFORE UPDATE ON clinical_reviews
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── clinical_templates (LEGACY — distinct from `templates` in L3) ──
  // Both tables exist in current DB; preserved per byte-compat. Phase R3
  // determines which one is the canonical and migrates callers.
  await knex.schema.createTable('clinical_templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('category_id').nullable().references('id').inTable('template_categories').onDelete('SET NULL');
    t.string('name', 300).notNullable();
    t.string('type', 50).notNullable();
    t.text('description').nullable();
    t.jsonb('content').notNullable().defaultTo('[]');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('is_system').notNullable().defaultTo(false);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.uuid('created_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['category_id']);
    t.index(['clinic_id', 'type']);
  });
  await knex.raw(`
    CREATE INDEX idx_clinical_templates_clinic_id ON clinical_templates (clinic_id);
    CREATE INDEX idx_clinical_templates_created_by_id ON clinical_templates (created_by_id);
    ALTER TABLE clinical_templates ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinical_templates_tenant ON clinical_templates
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_clinical_templates_updated_at
      BEFORE UPDATE ON clinical_templates
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── engagement_scores (5-axis MSE-adjacent assessment per encounter) ──
  await knex.schema.createTable('engagement_scores', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('encounter_id').notNullable().references('id').inTable('consultations').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.integer('rapport').notNullable();
    t.integer('engagement').notNullable();
    t.integer('compliance').notNullable();
    t.integer('insight').notNullable();
    t.integer('affect').notNullable();
    t.text('notes').nullable();
    t.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['encounter_id']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_engagement_scores_clinic_id ON engagement_scores (clinic_id);
    ALTER TABLE engagement_scores ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_engagement_scores_tenant ON engagement_scores
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_engagement_scores_updated_at
      BEFORE UPDATE ON engagement_scores
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── key_issues (encounter-extracted issues; soft-delete via deleted_at) ──
  await knex.schema.createTable('key_issues', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('encounter_id').notNullable().references('id').inTable('consultations').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.text('issue_text').notNullable();
    t.string('category', 50).notNullable().defaultTo('clinical');
    t.string('priority', 30).notNullable().defaultTo('routine');
    t.text('resolution').nullable();
    t.timestamp('resolved_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['encounter_id']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_key_issues_clinic_id ON key_issues (clinic_id);
    CREATE INDEX idx_key_issues_deleted_at ON key_issues (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE key_issues ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_key_issues_tenant ON key_issues
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_key_issues_updated_at
      BEFORE UPDATE ON key_issues
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── review_plans (per-consultation plan of care; tasks + letter triggers) ──
  await knex.schema.createTable('review_plans', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('encounter_id').notNullable().references('id').inTable('consultations').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.text('plan_text').notNullable();
    t.date('follow_up_date').nullable();
    t.string('follow_up_type', 50).nullable();
    t.jsonb('tasks_to_create').nullable();
    t.boolean('generate_letter').notNullable().defaultTo(false);
    t.string('letter_type', 50).nullable();
    t.string('letter_recipient', 200).nullable();
    t.uuid('letter_job_id').nullable();
    t.integer('tasks_created').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['encounter_id']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_review_plans_clinic_id ON review_plans (clinic_id);
    CREATE INDEX idx_review_plans_deleted_at ON review_plans (deleted_at)
      WHERE deleted_at IS NULL;
    CREATE INDEX idx_review_plans_episode_id ON review_plans (episode_id);
    ALTER TABLE review_plans ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_review_plans_tenant ON review_plans
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_review_plans_updated_at
      BEFORE UPDATE ON review_plans
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── treatment_pathways (CBT/DBT/etc treatment streams; AUDITED; milestones JSONB) ──
  await knex.schema.createTable('treatment_pathways', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 200).notNullable();
    t.string('status', 30).notNullable().defaultTo('active');
    t.jsonb('milestones').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));

    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_treatment_pathways_clinic_id ON treatment_pathways (clinic_id);
    CREATE INDEX idx_treatment_pathways_patient_id ON treatment_pathways (patient_id);
    ALTER TABLE treatment_pathways ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_treatment_pathways_tenant ON treatment_pathways
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_treatment_pathways_updated_at
      BEFORE UPDATE ON treatment_pathways
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER trg_treatment_pathways_audit
      AFTER INSERT OR DELETE OR UPDATE ON treatment_pathways
      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
  `);

  // ── treatment_plans (goals + interventions JSONB; clinic_id ON DELETE SET NULL atypical) ──
  await knex.schema.createTable('treatment_plans', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('SET NULL');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.string('title', 300).nullable();
    t.string('status', 30).defaultTo('active');
    t.jsonb('goals').defaultTo('[]');
    t.jsonb('interventions').defaultTo('[]');
    t.date('review_date').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_treatment_plans_clinic_id ON treatment_plans (clinic_id);
    CREATE INDEX idx_treatment_plans_episode_id ON treatment_plans (episode_id);
    CREATE INDEX idx_treatment_plans_staff_id ON treatment_plans (staff_id);
    ALTER TABLE treatment_plans ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_treatment_plans_tenant ON treatment_plans
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_treatment_plans_updated_at
      BEFORE UPDATE ON treatment_plans
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── correspondence_letters (AUDITED; GENERATED tsvector + GIN search;
  //   template_id FK DEFERRED to Section N — templates not declared yet) ──
  await knex.schema.createTable('correspondence_letters', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('author_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.string('recipient_name', 255).nullable();
    t.text('recipient_address').nullable();
    t.string('recipient_email', 255).nullable();
    t.string('recipient_fax', 30).nullable();
    t.uuid('recipient_provider_id').nullable();
    t.string('letter_type', 50).notNullable().defaultTo('general');
    t.string('subject', 500).nullable();
    t.text('content').nullable();
    t.text('body').nullable();
    t.string('status', 30).notNullable().defaultTo('draft');
    t.uuid('clinical_note_id').nullable();
    t.uuid('template_id').nullable(); // FK → templates(id) deferred to Section N
    t.uuid('generated_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.text('notes').nullable();
    t.string('sent_via', 50).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('sent_at', { useTz: true }).nullable();
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.text('signature_data').nullable();
    t.uuid('signed_by_id').nullable();
    t.timestamp('signed_at', { useTz: true }).nullable();
    // search_tsv is a GENERATED ALWAYS column — must be added via raw SQL
    // because Knex builder does not support generated columns.

    t.index(['clinic_id', 'patient_id']);
    t.index(['clinic_id', 'status']);
  });
  await knex.raw(`
    -- GENERATED ALWAYS column (Knex builder does not express this).
    ALTER TABLE correspondence_letters
      ADD COLUMN search_tsv tsvector
      GENERATED ALWAYS AS (
        to_tsvector('english',
          COALESCE(subject, '')::text || ' ' ||
          COALESCE(body, '') || ' ' ||
          COALESCE(content, '')
        )
      ) STORED;
    -- GIN index for full-text search (raw SQL — Knex builder does not
    -- support GIN method).
    CREATE INDEX correspondence_letters_search_tsv_gin ON correspondence_letters
      USING gin (search_tsv);
    CREATE INDEX idx_correspondence_letters_author_id ON correspondence_letters (author_id);
    CREATE INDEX idx_correspondence_letters_clinic_id ON correspondence_letters (clinic_id);
    CREATE INDEX idx_correspondence_letters_deleted_at ON correspondence_letters (deleted_at)
      WHERE deleted_at IS NULL;
    CREATE INDEX idx_correspondence_letters_episode_id ON correspondence_letters (episode_id);
    CREATE INDEX idx_correspondence_letters_generated_by_id ON correspondence_letters (generated_by_id);
    CREATE INDEX idx_correspondence_letters_patient_id ON correspondence_letters (patient_id);
    ALTER TABLE correspondence_letters ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_correspondence_letters_tenant ON correspondence_letters
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- Note: NO updated_at trigger on correspondence_letters in current DB
    -- (likely an oversight in archived migrations — preserved as-is).
    CREATE TRIGGER trg_correspondence_letters_audit
      AFTER INSERT OR DELETE OR UPDATE ON correspondence_letters
      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION L3 — templates + checklists + tasks (6 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // - templates (central hub — parent FOR contact_records, clinical_notes,
  //   correspondence_letters, assessment_responses, outcome_measures); resolves
  //   the deferred-FK references from L1, L2 sections.
  // - template_sections (child of templates; NO clinic_id/no RLS)
  // - checklist_templates + checklist_instances (separate from `templates`
  //   above — these are workflow checklists, not form templates)
  // - tasks (SD1 fix baked in: assigned_by_id, due_date, no team_id/deleted_at)
  // - patient_tasks (Viva mobile patient self-tasks; 2 RLS policies preserved)

  // ── templates (form-template hub; parent for many other tables) ──
  await knex.schema.createTable('templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 255).notNullable();
    t.string('type', 50).nullable();
    t.text('description').nullable();
    t.string('category', 100).notNullable().defaultTo('General');
    t.jsonb('content').defaultTo('[]');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.string('status', 30).notNullable().defaultTo('draft');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.uuid('created_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('published_at', { useTz: true }).nullable();
    t.timestamp('retired_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id', 'status', 'deleted_at']);
  });
  await knex.raw(`
    CREATE INDEX idx_templates_clinic_id ON templates (clinic_id);
    CREATE INDEX idx_templates_created_by_id ON templates (created_by_id);
    CREATE INDEX idx_templates_deleted_at ON templates (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_templates_tenant ON templates
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_templates_updated_at
      BEFORE UPDATE ON templates
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── template_sections (NO clinic_id, NO RLS — child of templates) ──
  // CASCADE from templates handles tenant isolation transitively.
  await knex.schema.createTable('template_sections', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('template_id').notNullable().references('id').inTable('templates').onDelete('CASCADE');
    t.string('section_type', 50).nullable();
    t.string('label', 200).nullable();
    t.jsonb('options').nullable();
    t.integer('sort_order').defaultTo(0);
    t.boolean('is_required').defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['template_id']);
  });

  // ── checklist_templates (workflow checklists; advisory/mandatory enforcement) ──
  await knex.schema.createTable('checklist_templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 200).notNullable();
    t.text('description').nullable();
    t.string('trigger_point', 50).notNullable();
    t.string('enforcement', 20).notNullable().defaultTo('advisory');
    t.jsonb('items').notNullable().defaultTo('[]');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.uuid('created_by_staff_id').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'trigger_point', 'is_active']);
  });
  await knex.raw(`
    CREATE INDEX idx_checklist_templates_clinic_id ON checklist_templates (clinic_id);
    -- Named FK constraint preserved per archived migration.
    ALTER TABLE checklist_templates
      ADD CONSTRAINT fk_checklist_templates_created_by_staff_id
      FOREIGN KEY (created_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL;
    ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_checklist_templates_tenant ON checklist_templates
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_checklist_templates_updated_at
      BEFORE UPDATE ON checklist_templates
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── checklist_instances (per-patient checklist completion) ──
  await knex.schema.createTable('checklist_instances', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('template_id').notNullable().references('id').inTable('checklist_templates').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('RESTRICT');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('completed_by_staff_id').nullable();
    t.string('status', 20).notNullable().defaultTo('in_progress');
    t.jsonb('checked_items').notNullable().defaultTo('{}');
    t.integer('total_items').notNullable().defaultTo(0);
    t.integer('completed_items').notNullable().defaultTo(0);
    t.text('notes').nullable();
    t.timestamp('completed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'episode_id']);
    t.index(['clinic_id', 'patient_id']);
    t.index(['clinic_id', 'template_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_checklist_instances_clinic_id ON checklist_instances (clinic_id);
    -- Named FK preserved per archived migration.
    ALTER TABLE checklist_instances
      ADD CONSTRAINT fk_checklist_instances_completed_by_staff_id
      FOREIGN KEY (completed_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL;
    ALTER TABLE checklist_instances ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_checklist_instances_tenant ON checklist_instances
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_checklist_instances_updated_at
      BEFORE UPDATE ON checklist_instances
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── tasks (SD1 fix baked in: assigned_by_id, due_date, no team_id/deleted_at) ──
  await knex.schema.createTable('tasks', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').nullable().references('id').inTable('patients').onDelete('SET NULL');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('assigned_to_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('assigned_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.string('title', 300).notNullable();
    t.text('description').nullable();
    t.string('task_type', 50).defaultTo('follow-up');
    t.string('priority', 30).defaultTo('medium');
    t.string('status', 30).defaultTo('pending');
    t.date('due_date').nullable();
    t.timestamp('completed_at', { useTz: true }).nullable();
    t.uuid('completed_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['assigned_to_id', 'status']);
    t.index(['clinic_id', 'status']);
    t.index(['due_date']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_tasks_assigned_by_id ON tasks (assigned_by_id);
    CREATE INDEX idx_tasks_assigned_to_id ON tasks (assigned_to_id);
    CREATE INDEX idx_tasks_clinic_id ON tasks (clinic_id);
    CREATE INDEX idx_tasks_completed_by_id ON tasks (completed_by_id);
    CREATE INDEX idx_tasks_episode_id ON tasks (episode_id);
    ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_tasks_tenant ON tasks
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_tasks_updated_at
      BEFORE UPDATE ON tasks
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── patient_tasks (Viva mobile patient self-tasks; 2 RLS policies preserved) ──
  await knex.schema.createTable('patient_tasks', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
    t.uuid('patient_id').notNullable().references('id').inTable('patients');
    t.string('title', 255).notNullable();
    t.text('description').nullable();
    t.date('due_date').nullable();
    t.specificType('reminder_time', 'time without time zone').nullable();
    t.string('status', 20).notNullable().defaultTo('pending');
    t.timestamp('completed_at', { useTz: true }).nullable();
    t.uuid('created_by').nullable().references('id').inTable('staff');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_patient_tasks_clinic ON patient_tasks (clinic_id);
    CREATE INDEX idx_patient_tasks_clinic_id ON patient_tasks (clinic_id);
    CREATE INDEX idx_patient_tasks_created_by ON patient_tasks (created_by);
    CREATE INDEX idx_patient_tasks_patient ON patient_tasks (patient_id);
    CREATE INDEX idx_patient_tasks_status ON patient_tasks (status);
    ALTER TABLE patient_tasks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_tasks ON patient_tasks
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- Duplicate policy preserved verbatim from archived migration.
    CREATE POLICY rls_patient_tasks_tenant ON patient_tasks
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_patient_tasks_updated_at
      BEFORE UPDATE ON patient_tasks
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION L4 — operations catch-up (6 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // group_sessions (parent), group_session_attendees (child, no clinic_id),
  // planned_transitions (parent), planned_transition_assignments (child,
  // no clinic_id), patient_team_reallocations (with partial UNIQUE),
  // waitlist_entries (SD12 fix baked in: preferred_clinician_id +
  // added_date + target_appointment_by canonical names).

  // ── group_sessions (CBT/DBT/etc parent; facilitator is staff) ──
  await knex.schema.createTable('group_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('facilitator_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.string('name', 200).notNullable();
    t.string('group_type', 50).nullable();
    t.string('program', 100).nullable();
    t.date('session_date').notNullable();
    t.specificType('start_time', 'time without time zone').nullable();
    t.specificType('end_time', 'time without time zone').nullable();
    t.integer('duration_min').nullable();
    t.string('location', 200).nullable();
    t.text('notes').nullable();
    t.string('status', 30).notNullable().defaultTo('scheduled');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'session_date']);
  });
  await knex.raw(`
    CREATE INDEX idx_group_sessions_clinic_id ON group_sessions (clinic_id);
    CREATE INDEX idx_group_sessions_facilitator_id ON group_sessions (facilitator_id);
    ALTER TABLE group_sessions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_group_sessions_tenant ON group_sessions
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_group_sessions_updated_at
      BEFORE UPDATE ON group_sessions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── group_session_attendees (NO clinic_id, NO RLS — child of group_sessions) ──
  // Tenancy via group_session_id → group_sessions.clinic_id.
  await knex.schema.createTable('group_session_attendees', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('group_session_id').notNullable().references('id').inTable('group_sessions').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('attendance_status', 30).notNullable().defaultTo('attended');
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));

    t.index(['group_session_id']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE TRIGGER trg_group_session_attendees_updated_at
      BEFORE UPDATE ON group_session_attendees
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── planned_transitions (parent — staff-departure handover plans) ──
  // from_staff_id ON DELETE RESTRICT (cannot delete staff with pending
  // transition); approved_by_id ON DELETE SET NULL.
  await knex.schema.createTable('planned_transitions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('from_staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.string('reason', 200).notNullable();
    t.date('effective_date').notNullable();
    t.string('status', 30).notNullable().defaultTo('draft');
    t.uuid('created_by_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.uuid('approved_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('approved_at', { useTz: true }).nullable();
    t.timestamp('executed_at', { useTz: true }).nullable();
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id', 'status']);
    t.index(['from_staff_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_planned_transitions_clinic_id ON planned_transitions (clinic_id);
    CREATE INDEX idx_planned_transitions_created_by_id ON planned_transitions (created_by_id);
    CREATE INDEX idx_planned_transitions_approved_by_id ON planned_transitions (approved_by_id);
    CREATE INDEX idx_planned_transitions_deleted_at ON planned_transitions (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE planned_transitions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_planned_transitions_tenant ON planned_transitions
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_planned_transitions_updated_at
      BEFORE UPDATE ON planned_transitions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── planned_transition_assignments (NO clinic_id, NO RLS — child) ──
  // CASCADE from planned_transitions handles tenant isolation transitively.
  await knex.schema.createTable('planned_transition_assignments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('transition_id').notNullable().references('id').inTable('planned_transitions').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('to_staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.string('to_team', 100).nullable();
    t.string('status', 30).notNullable().defaultTo('pending');
    t.text('handover_notes').nullable();
    t.timestamp('executed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));

    t.index(['transition_id']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_planned_transition_assignments_episode_id ON planned_transition_assignments (episode_id);
    CREATE INDEX idx_planned_transition_assignments_to_staff_id ON planned_transition_assignments (to_staff_id);
    CREATE TRIGGER trg_planned_transition_assignments_updated_at
      BEFORE UPDATE ON planned_transition_assignments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── patient_team_reallocations (clinic-to-clinic transfer requests;
  //   partial UNIQUE: only one pending_approval per (clinic, patient)) ──
  await knex.schema.createTable('patient_team_reallocations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('to_org_unit_id').notNullable().references('id').inTable('org_units').onDelete('RESTRICT');
    t.uuid('to_primary_clinician_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('from_org_unit_id').nullable().references('id').inTable('org_units').onDelete('SET NULL');
    t.string('status', 30).notNullable().defaultTo('pending_approval');
    t.uuid('referred_by_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.uuid('reviewed_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.text('reason').nullable();
    t.text('rejection_reason').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id']);
    t.index(['clinic_id', 'status']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_patient_team_reallocations_clinic_id ON patient_team_reallocations (clinic_id);
    -- Partial UNIQUE: only one pending_approval per (clinic_id, patient_id).
    CREATE UNIQUE INDEX uq_patient_team_reallocations_one_pending
      ON patient_team_reallocations (clinic_id, patient_id)
      WHERE status = 'pending_approval';
    ALTER TABLE patient_team_reallocations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_team_reallocations_tenant ON patient_team_reallocations
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_patient_team_reallocations_updated_at
      BEFORE UPDATE ON patient_team_reallocations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── waitlist_entries (SD12 fix baked in: preferred_clinician_id +
  //   added_date + target_appointment_by canonical names) ──
  // referral_id and converted_appointment_id columns exist with NO FK
  // declared in current DB — preserved exactly.
  // added_date has CURRENT_TIMESTAMP default that resolves to date —
  // same atypical pattern as clinician_availability_blocks.effective_from.
  await knex.schema.createTable('waitlist_entries', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('referral_id').nullable(); // No FK in current DB
    t.uuid('preferred_clinician_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.string('priority', 30).notNullable().defaultTo('medium');
    t.string('preferred_time_of_day', 50).nullable();
    t.specificType('preferred_start_time', 'time without time zone').nullable();
    t.specificType('preferred_end_time', 'time without time zone').nullable();
    t.date('added_date').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
    t.date('target_appointment_by').nullable();
    t.string('status', 30).notNullable().defaultTo('waiting');
    t.uuid('converted_appointment_id').nullable(); // No FK in current DB
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id', 'patient_id']);
    t.index(['clinic_id', 'status']);
    t.index(['patient_id'], 'waitlist_entries_patient_id_idx');
    t.index(['preferred_clinician_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_waitlist_entries_clinic_id ON waitlist_entries (clinic_id);
    CREATE INDEX idx_waitlist_entries_deleted_at ON waitlist_entries (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_waitlist_entries_tenant ON waitlist_entries
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_waitlist_entries_updated_at
      BEFORE UPDATE ON waitlist_entries
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION L5 — pathology + ereferrals + workflows + flags (8 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // pathology_orders + pathology_results (HL7-aligned),
  // ereferrals (incoming referral), workflows + workflow_executions
  // (workflow engine), import_jobs (CSV ingest), fhir_bulk_export_jobs
  // (FHIR bulk-data API), feature_flags (per-clinic + global; 2 partial
  // UNIQUE indexes).

  // ── pathology_orders (parent; tests as text[] array) ──
  await knex.schema.createTable('pathology_orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('appointment_id').nullable();
    t.uuid('ordered_by_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.string('order_number', 50).notNullable();
    t.string('panel_name', 200).notNullable();
    t.specificType('tests', 'text[]').notNullable();
    t.string('urgency', 30).notNullable().defaultTo('routine');
    t.text('clinical_notes').nullable();
    t.boolean('fasting').defaultTo(false);
    t.boolean('copy_to_gp').defaultTo(false);
    t.string('status', 30).notNullable().defaultTo('pending');
    t.timestamp('hl7_sent_at', { useTz: true }).nullable();
    t.text('hl7_message').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id', 'patient_id']);
    t.index(['order_number']);
    t.index(['patient_id'], 'pathology_orders_patient_id_idx');
    t.index(['status']);
  });
  await knex.raw(`
    CREATE INDEX idx_pathology_orders_clinic_id ON pathology_orders (clinic_id);
    CREATE INDEX idx_pathology_orders_deleted_at ON pathology_orders (deleted_at)
      WHERE deleted_at IS NULL;
    CREATE INDEX idx_pathology_orders_episode_id ON pathology_orders (episode_id);
    CREATE INDEX idx_pathology_orders_ordered_by_id ON pathology_orders (ordered_by_id);
    -- Named FK to appointments (deferred-compatible — appointments exists in Section I).
    ALTER TABLE pathology_orders
      ADD CONSTRAINT fk_pathology_orders_appointment_id
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;
    ALTER TABLE pathology_orders ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_pathology_orders_tenant ON pathology_orders
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_pathology_orders_updated_at
      BEFORE UPDATE ON pathology_orders
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── pathology_results (per-test result; critical-result acknowledgement) ──
  await knex.schema.createTable('pathology_results', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('pathology_order_id').notNullable().references('id').inTable('pathology_orders').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('test_code', 50).notNullable();
    t.string('test_name', 200).notNullable();
    t.string('result_value', 200).notNullable();
    t.string('result_unit', 50).nullable();
    t.string('reference_range', 100).nullable();
    t.string('abnormal_flag', 30).notNullable().defaultTo('normal');
    t.string('result_status', 30).notNullable().defaultTo('final');
    t.date('collection_date').notNullable();
    t.date('result_date').notNullable();
    t.timestamp('collected_at', { useTz: true }).nullable();
    t.string('performing_lab', 200).nullable();
    t.text('hl7_raw').nullable();
    t.boolean('is_critical').defaultTo(false);
    t.timestamp('critical_acknowledged_at', { useTz: true }).nullable();
    t.uuid('critical_acknowledged_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('flag_task_id').nullable(); // No FK in current DB
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['pathology_order_id']);
    t.index(['patient_id', 'test_code']);
  });
  await knex.raw(`
    CREATE INDEX idx_pathology_results_clinic_id ON pathology_results (clinic_id);
    CREATE INDEX idx_pathology_results_critical_acknowledged_by_id ON pathology_results (critical_acknowledged_by_id);
    ALTER TABLE pathology_results ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_pathology_results_tenant ON pathology_results
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_pathology_results_updated_at
      BEFORE UPDATE ON pathology_results
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── ereferrals (inbound electronic referral; status workflow) ──
  await knex.schema.createTable('ereferrals', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').nullable().references('id').inTable('patients').onDelete('SET NULL');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('referrer_name', 200).nullable();
    t.string('referrer_org', 200).nullable();
    t.string('referrer_phone', 30).nullable();
    t.string('referrer_email', 255).nullable();
    t.string('priority', 30).notNullable().defaultTo('routine');
    t.string('status', 30).notNullable().defaultTo('received');
    t.jsonb('content').nullable();
    t.text('reason').nullable();
    t.text('clinical_summary').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));

    t.index(['clinic_id', 'status']);
  });
  await knex.raw(`
    CREATE INDEX idx_ereferrals_clinic_id ON ereferrals (clinic_id);
    CREATE INDEX idx_ereferrals_patient_id ON ereferrals (patient_id);
    ALTER TABLE ereferrals ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_ereferrals_tenant ON ereferrals
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_ereferrals_updated_at
      BEFORE UPDATE ON ereferrals
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── workflows (workflow definitions; trigger event + steps JSONB) ──
  await knex.schema.createTable('workflows', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 200).notNullable();
    t.text('description').nullable();
    t.string('trigger_event', 100).notNullable();
    t.jsonb('steps').notNullable().defaultTo('[]');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.uuid('created_by_staff_id').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id', 'trigger_event', 'is_active']);
  });
  await knex.raw(`
    CREATE INDEX idx_workflows_clinic_id ON workflows (clinic_id);
    CREATE INDEX idx_workflows_deleted_at ON workflows (deleted_at)
      WHERE deleted_at IS NULL;
    -- Named FK preserved per archived migration.
    ALTER TABLE workflows
      ADD CONSTRAINT fk_workflows_created_by_staff_id
      FOREIGN KEY (created_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL;
    ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_workflows_tenant ON workflows
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_workflows_updated_at
      BEFORE UPDATE ON workflows
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── workflow_executions (per-trigger run; steps_completed counter; APPEND-ONLY) ──
  await knex.schema.createTable('workflow_executions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('workflow_id').notNullable().references('id').inTable('workflows').onDelete('CASCADE');
    t.jsonb('trigger_data').nullable();
    t.string('status', 30).notNullable().defaultTo('running');
    t.integer('steps_completed').notNullable().defaultTo(0);
    t.integer('total_steps').notNullable().defaultTo(0);
    t.text('error_message').nullable();
    t.jsonb('step_results').nullable();
    t.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('completed_at', { useTz: true }).nullable();

    t.index(['clinic_id', 'status']);
    t.index(['clinic_id', 'workflow_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_workflow_executions_clinic_id ON workflow_executions (clinic_id);
    ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_workflow_executions_tenant ON workflow_executions
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── import_jobs (CSV ingest; CHECK on kind + status; APPEND-ONLY but soft-delete) ──
  await knex.schema.createTable('import_jobs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('uploaded_by_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.string('kind', 40).notNullable();
    t.string('status', 20).notNullable().defaultTo('pending');
    t.string('filename', 500).nullable();
    t.integer('row_count').notNullable().defaultTo(0);
    t.integer('error_count').notNullable().defaultTo(0);
    t.integer('committed_count').notNullable().defaultTo(0);
    t.jsonb('report').notNullable().defaultTo('{}');
    t.timestamp('uploaded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('committed_at', { useTz: true }).nullable();
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id', 'kind']);
    t.index(['clinic_id', 'status']);
    t.index(['uploaded_by_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_import_jobs_clinic_id ON import_jobs (clinic_id);
    CREATE INDEX idx_import_jobs_deleted_at ON import_jobs (deleted_at)
      WHERE deleted_at IS NULL;
    ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_kind_check
      CHECK (kind IN ('patients','mha','lai','clozapine','clinical_notes'));
    ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_status_check
      CHECK (status IN ('pending','validated','committed','rejected'));
    ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_import_jobs_tenant ON import_jobs
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── fhir_bulk_export_jobs (FHIR bulk-data API job tracking; types as text[]) ──
  // clinic_id has ON DELETE SET NULL (atypical) — preserved exactly.
  // APPEND-ONLY (no updated_at column).
  await knex.schema.createTable('fhir_bulk_export_jobs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable();
    t.uuid('requested_by_staff_id').notNullable();
    t.specificType('types', 'text[]').notNullable();
    t.timestamp('since', { useTz: true }).nullable();
    t.text('request_url').notNullable();
    t.text('group_id').nullable();
    t.string('status', 16).notNullable().defaultTo('accepted');
    t.text('error_text').nullable();
    t.jsonb('output_files').notNullable().defaultTo('[]');
    t.integer('total_resources').nullable();
    t.integer('exported_resources').notNullable().defaultTo(0);
    t.timestamp('started_at', { useTz: true }).nullable();
    t.timestamp('finished_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id']);
    t.index(['created_at']);
    t.index(['status']);
  });
  await knex.raw(`
    CREATE INDEX idx_fhir_bulk_export_jobs_clinic_id ON fhir_bulk_export_jobs (clinic_id);
    -- Named FK constraints (per archived migration).
    ALTER TABLE fhir_bulk_export_jobs
      ADD CONSTRAINT fk_fhir_bulk_export_jobs_clinic_id
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
    ALTER TABLE fhir_bulk_export_jobs
      ADD CONSTRAINT fk_fhir_bulk_export_jobs_requested_by_staff_id
      FOREIGN KEY (requested_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL;
    ALTER TABLE fhir_bulk_export_jobs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_fhir_bulk_export_jobs_tenant ON fhir_bulk_export_jobs
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── feature_flags (per-clinic OR global; 2 partial UNIQUE indexes) ──
  // clinic_id NULLABLE — global flags share clinic_id IS NULL.
  await knex.schema.createTable('feature_flags', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').nullable();
    t.string('name', 100).notNullable();
    t.text('description').nullable();
    t.boolean('enabled').notNullable().defaultTo(false);
    t.integer('rollout_percentage').notNullable().defaultTo(100);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'name']);
    t.index(['name']);
  });
  await knex.raw(`
    CREATE INDEX idx_feature_flags_clinic_id ON feature_flags (clinic_id);
    -- Partial UNIQUE indexes — global vs per-clinic uniqueness.
    CREATE UNIQUE INDEX feature_flags_name_clinic_idx ON feature_flags (clinic_id, name)
      WHERE clinic_id IS NOT NULL;
    CREATE UNIQUE INDEX feature_flags_name_global_idx ON feature_flags (name)
      WHERE clinic_id IS NULL;
    -- Named FK preserved per archived migration.
    ALTER TABLE feature_flags
      ADD CONSTRAINT fk_feature_flags_clinic_id
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
    ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_feature_flags_tenant ON feature_flags
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_feature_flags_updated_at
      BEFORE UPDATE ON feature_flags
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION L6 — subscriptions + per-clinic config (8 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // SaaS billing + branding + per-clinic configuration:
  // subscriptions, subscriber_branding, clinic_contact_options,
  // clinic_thresholds, org_level_labels, org_unit_programs,
  // viva_alert_thresholds, erx_tokens.

  // ── subscriptions (per-clinic SaaS billing plan) ──
  await knex.schema.createTable('subscriptions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('plan_type', 50).notNullable();
    t.integer('seats').notNullable().defaultTo(1);
    t.decimal('price_per_month', 8, 2).notNullable();
    t.decimal('price_per_year', 8, 2).nullable();
    t.decimal('discount_percent', 8, 2).nullable();
    t.decimal('discount_amount', 8, 2).nullable();
    t.string('status', 30).notNullable().defaultTo('active');
    t.date('start_date').notNullable();
    t.date('end_date').nullable();
    t.date('renewal_date').nullable();
    t.integer('reminder_days').notNullable().defaultTo(30);
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_subscriptions_clinic_id ON subscriptions (clinic_id);
    ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_subscriptions_tenant ON subscriptions
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_subscriptions_updated_at
      BEFORE UPDATE ON subscriptions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── subscriber_branding (per-clinic UI branding overrides) ──
  await knex.schema.createTable('subscriber_branding', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.text('logo_url').nullable();
    t.string('primary_color', 20).nullable();
    t.string('sidebar_color', 20).nullable();
    t.string('sidebar_title', 200).nullable();
    t.string('sidebar_subtitle', 200).nullable();
    t.string('org_name', 200).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_subscriber_branding_clinic_id ON subscriber_branding (clinic_id);
    ALTER TABLE subscriber_branding ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_subscriber_branding_tenant ON subscriber_branding
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_subscriber_branding_updated_at
      BEFORE UPDATE ON subscriber_branding
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── clinic_contact_options (per-clinic dropdown options for contact_records) ──
  await knex.schema.createTable('clinic_contact_options', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.jsonb('locations').nullable();
    t.jsonb('programs').nullable();
    t.jsonb('service_recipient_types').nullable();
    t.jsonb('contact_media_types').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_clinic_contact_options_clinic_id ON clinic_contact_options (clinic_id);
    ALTER TABLE clinic_contact_options ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinic_contact_options_tenant ON clinic_contact_options
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_clinic_contact_options_updated_at
      BEFORE UPDATE ON clinic_contact_options
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── clinic_thresholds (per-clinic clinical alert thresholds) ──
  await knex.schema.createTable('clinic_thresholds', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').nullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.string('threshold_key', 100).nullable();
    t.decimal('threshold_value', 8, 2).nullable();
    t.string('unit', 50).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'threshold_key']);
  });
  await knex.raw(`
    CREATE INDEX idx_clinic_thresholds_clinic_id ON clinic_thresholds (clinic_id);
    ALTER TABLE clinic_thresholds ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinic_thresholds_tenant ON clinic_thresholds
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_clinic_thresholds_updated_at
      BEFORE UPDATE ON clinic_thresholds
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── org_level_labels (per-clinic naming for org-tree depth levels) ──
  // UNIQUE on (clinic_id, level) — one label per level per clinic.
  await knex.schema.createTable('org_level_labels', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.integer('level').notNullable();
    t.string('label', 200).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['clinic_id', 'level']);
  });
  await knex.raw(`
    CREATE INDEX idx_org_level_labels_clinic_id ON org_level_labels (clinic_id);
    ALTER TABLE org_level_labels ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_org_level_labels_tenant ON org_level_labels
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_org_level_labels_updated_at
      BEFORE UPDATE ON org_level_labels
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── org_unit_programs (per-org-unit program names; UNIQUE per unit) ──
  await knex.schema.createTable('org_unit_programs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('org_unit_id').notNullable().references('id').inTable('org_units').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));

    t.unique(['org_unit_id', 'name']);
    t.index(['clinic_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_org_unit_programs_clinic_id ON org_unit_programs (clinic_id);
    ALTER TABLE org_unit_programs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_org_unit_programs_tenant ON org_unit_programs
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_org_unit_programs_updated_at
      BEFORE UPDATE ON org_unit_programs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── viva_alert_thresholds (per-patient self-tracking alert thresholds; 2 RLS policies) ──
  await knex.schema.createTable('viva_alert_thresholds', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
    t.uuid('patient_id').notNullable().references('id').inTable('patients');
    t.string('tracking_type', 30).notNullable();
    t.string('direction', 10).notNullable().defaultTo('below');
    t.decimal('threshold', 10, 2).notNullable();
    t.integer('consecutive_days').notNullable().defaultTo(3);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.uuid('created_by').nullable().references('id').inTable('staff');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id']);
    t.index(['patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_viva_alert_thresholds_clinic_id ON viva_alert_thresholds (clinic_id);
    CREATE INDEX idx_viva_alert_thresholds_created_by ON viva_alert_thresholds (created_by);
    CREATE INDEX idx_viva_thresholds_clinic ON viva_alert_thresholds (clinic_id);
    CREATE INDEX idx_viva_thresholds_patient ON viva_alert_thresholds (patient_id);
    ALTER TABLE viva_alert_thresholds ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_viva_alert_thresholds_tenant ON viva_alert_thresholds
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- Duplicate policy preserved verbatim from archived migration.
    CREATE POLICY rls_viva_thresholds ON viva_alert_thresholds
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_viva_alert_thresholds_updated_at
      BEFORE UPDATE ON viva_alert_thresholds
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── erx_tokens (eRx prescription token tracking; FK to prescriptions) ──
  await knex.schema.createTable('erx_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('prescription_id').notNullable().references('id').inTable('prescriptions').onDelete('CASCADE');
    t.string('token_value', 500).notNullable();
    t.string('dsp_id', 100).nullable();
    t.string('npds_reference', 100).nullable();
    t.string('status', 30).notNullable().defaultTo('issued');
    t.timestamp('issued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).nullable();
    t.timestamp('dispensed_at', { useTz: true }).nullable();
    t.string('dispensing_pharmacy', 300).nullable();
    t.jsonb('raw_response').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['prescription_id']);
    t.index(['token_value']);
  });
  await knex.raw(`
    CREATE INDEX idx_erx_tokens_clinic_id ON erx_tokens (clinic_id);
    ALTER TABLE erx_tokens ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_erx_tokens_tenant ON erx_tokens
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_erx_tokens_updated_at
      BEFORE UPDATE ON erx_tokens
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION L7 — AI / LLM + voice (9 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // - AI configuration: ai_context_files (RAG context), ai_modelfiles
  //   (per-action LLM config), ai_training_feedback (per-interaction feedback)
  // - LLM audit: llm_interactions (every model call)
  // - Evidence RAG: evidence_documents + evidence_chunks (GLOBAL — no clinic_id,
  //   no RLS; regulatory guidelines shared across clinics). Resolves the
  //   deferred clinical_note_evidence.chunk_id FK from L2.
  // - Voice: voice_scripts (parent) + voice_calls (child) + voice_patient_preferences
  //   (SD5 fix baked in: opted_out_at, preferred_call_start/end/time/days)
  //
  // Declaration order matters here: llm_interactions before
  // ai_training_feedback; evidence_documents before evidence_chunks;
  // voice_scripts before voice_calls.

  // ── ai_context_files (per-clinic RAG context) ──
  await knex.schema.createTable('ai_context_files', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('title', 200).notNullable();
    t.text('description').nullable();
    t.string('category', 50).notNullable().defaultTo('general');
    t.text('content').notNullable();
    t.string('content_format', 20).notNullable().defaultTo('text');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('include_in_rag').notNullable().defaultTo(true);
    t.integer('priority').notNullable().defaultTo(50);
    t.integer('token_estimate').nullable();
    t.uuid('uploaded_by_staff_id').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'include_in_rag']);
    t.index(['clinic_id', 'is_active', 'category']);
  });
  await knex.raw(`
    CREATE INDEX idx_ai_context_files_clinic_id ON ai_context_files (clinic_id);
    -- Named FK preserved per archived migration.
    ALTER TABLE ai_context_files
      ADD CONSTRAINT fk_ai_context_files_uploaded_by_staff_id
      FOREIGN KEY (uploaded_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL;
    ALTER TABLE ai_context_files ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_ai_context_files_tenant ON ai_context_files
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_ai_context_files_updated_at
      BEFORE UPDATE ON ai_context_files
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── ai_modelfiles (per-action LLM config; UNIQUE (clinic_id, action_type)) ──
  await knex.schema.createTable('ai_modelfiles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('action_type', 50).notNullable();
    t.string('model_name', 100).notNullable().defaultTo('qwen2.5:14b');
    t.text('modelfile_content').nullable();
    t.text('system_prompt').nullable();
    t.decimal('temperature', 3, 2).notNullable().defaultTo(0.2);
    t.integer('max_tokens').notNullable().defaultTo(4096);
    t.text('few_shot_examples').nullable();
    t.text('rag_instructions').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.uuid('updated_by_staff_id').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['clinic_id', 'action_type']);
    t.index(['clinic_id', 'is_active']);
  });
  await knex.raw(`
    CREATE INDEX idx_ai_modelfiles_clinic_id ON ai_modelfiles (clinic_id);
    -- Named FK preserved per archived migration.
    ALTER TABLE ai_modelfiles
      ADD CONSTRAINT fk_ai_modelfiles_updated_by_staff_id
      FOREIGN KEY (updated_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL;
    ALTER TABLE ai_modelfiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_ai_modelfiles_tenant ON ai_modelfiles
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_ai_modelfiles_updated_at
      BEFORE UPDATE ON ai_modelfiles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── llm_interactions (every model call audit; declared BEFORE ai_training_feedback) ──
  await knex.schema.createTable('llm_interactions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('user_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('patient_id').nullable().references('id').inTable('patients').onDelete('SET NULL');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.string('feature', 50).notNullable().defaultTo('other');
    t.string('model_name', 100).notNullable();
    t.string('model_provider', 50).nullable();
    t.integer('prompt_tokens').nullable();
    t.integer('completion_tokens').nullable();
    t.integer('total_tokens').nullable();
    t.integer('latency_ms').nullable();
    t.boolean('success').notNullable().defaultTo(true);
    t.string('error_code', 50).nullable();
    t.string('input_ref', 200).nullable();
    t.string('output_ref', 200).nullable();
    t.jsonb('metadata').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));

    t.index(['clinic_id', 'created_at']);
    t.index(['feature']);
    t.index(['user_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_llm_interactions_clinic_id ON llm_interactions (clinic_id);
    CREATE INDEX idx_llm_interactions_episode_id ON llm_interactions (episode_id);
    CREATE INDEX idx_llm_interactions_patient_id ON llm_interactions (patient_id);
    ALTER TABLE llm_interactions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_llm_interactions_tenant ON llm_interactions
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_llm_interactions_updated_at
      BEFORE UPDATE ON llm_interactions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── ai_training_feedback (clinician feedback on llm_interactions) ──
  await knex.schema.createTable('ai_training_feedback', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('SET NULL');
    t.uuid('staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('interaction_id').nullable().references('id').inTable('llm_interactions').onDelete('SET NULL');
    t.string('feedback_type', 50).nullable();
    t.integer('rating').nullable();
    t.text('comments').nullable();
    t.text('original_output').nullable();
    t.text('corrected_output').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.raw('now()'));

    t.index(['interaction_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_ai_training_feedback_clinic_id ON ai_training_feedback (clinic_id);
    CREATE INDEX idx_ai_training_feedback_staff_id ON ai_training_feedback (staff_id);
    ALTER TABLE ai_training_feedback ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_ai_training_feedback_tenant ON ai_training_feedback
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_ai_training_feedback_updated_at
      BEFORE UPDATE ON ai_training_feedback
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── evidence_documents (GLOBAL — NO clinic_id, NO RLS) ──
  // Regulatory guidelines shared across all clinics.
  // APPEND-ONLY (no updated_at).
  await knex.schema.createTable('evidence_documents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('source_id', 128).notNullable();
    t.text('title').notNullable();
    t.string('publisher', 128).nullable();
    t.string('jurisdiction', 16).nullable();
    t.date('published_on').nullable();
    t.text('url').nullable();
    t.string('document_type', 32).notNullable().defaultTo('guideline');
    t.text('license').nullable();
    t.timestamp('ingested_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['source_id']);
    t.index(['document_type']);
    t.index(['publisher']);
  });

  // ── evidence_chunks (GLOBAL — child of evidence_documents) ──
  // CASCADE from evidence_documents. APPEND-ONLY. Resolves deferred
  // clinical_note_evidence.chunk_id FK from Section L2 — Section N
  // attaches the cross-table FK now that evidence_chunks exists.
  await knex.schema.createTable('evidence_chunks', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('document_id').notNullable().references('id').inTable('evidence_documents').onDelete('CASCADE');
    t.text('section_path').nullable();
    t.integer('chunk_index').notNullable();
    t.text('body').notNullable();
    t.integer('token_estimate').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['document_id', 'chunk_index']);
    t.index(['document_id']);
  });

  // ── voice_scripts (parent for voice_calls; per-clinic IVR scripts) ──
  await knex.schema.createTable('voice_scripts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('name', 200).notNullable();
    t.text('description').nullable();
    t.string('script_type', 50).notNullable().defaultTo('general');
    t.integer('version').notNullable().defaultTo(1);
    t.text('content').notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.uuid('created_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_voice_scripts_clinic_id ON voice_scripts (clinic_id);
    CREATE INDEX idx_voice_scripts_created_by_id ON voice_scripts (created_by_id);
    ALTER TABLE voice_scripts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_voice_scripts_tenant ON voice_scripts
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_voice_scripts_updated_at
      BEFORE UPDATE ON voice_scripts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── voice_calls (child of voice_scripts; per-call audit; transcript_s3_key) ──
  await knex.schema.createTable('voice_calls', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('script_id').nullable().references('id').inTable('voice_scripts').onDelete('SET NULL');
    t.uuid('initiated_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.string('direction', 20).notNullable().defaultTo('outbound');
    t.string('status', 30).notNullable().defaultTo('initiated');
    t.string('phone_number_masked', 30).nullable();
    t.integer('duration_seconds').nullable();
    t.timestamp('started_at', { useTz: true }).nullable();
    t.timestamp('ended_at', { useTz: true }).nullable();
    t.string('call_sid', 100).nullable();
    t.boolean('transcript_available').notNullable().defaultTo(false);
    t.string('transcript_s3_key', 500).nullable();
    t.string('outcome', 50).nullable();
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id', 'patient_id']);
    t.index(['status']);
  });
  await knex.raw(`
    CREATE INDEX idx_voice_calls_clinic_id ON voice_calls (clinic_id);
    CREATE INDEX idx_voice_calls_deleted_at ON voice_calls (deleted_at)
      WHERE deleted_at IS NULL;
    CREATE INDEX idx_voice_calls_episode_id ON voice_calls (episode_id);
    CREATE INDEX idx_voice_calls_initiated_by_id ON voice_calls (initiated_by_id);
    CREATE INDEX idx_voice_calls_patient_id ON voice_calls (patient_id);
    CREATE INDEX idx_voice_calls_script_id ON voice_calls (script_id);
    ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_voice_calls_tenant ON voice_calls
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_voice_calls_updated_at
      BEFORE UPDATE ON voice_calls
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── voice_patient_preferences (SD5 fix baked in: opted_out_at + 4 preferred_call_*) ──
  // UNIQUE (clinic_id, patient_id) — one preference set per patient per clinic.
  await knex.schema.createTable('voice_patient_preferences', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.boolean('opted_out').notNullable().defaultTo(false);
    t.timestamp('opted_out_at', { useTz: true }).nullable();
    t.string('opt_out_channel', 30).nullable();
    t.string('preferred_call_start', 10).nullable();
    t.string('preferred_call_end', 10).nullable();
    t.string('preferred_call_time', 10).nullable();
    t.specificType('preferred_days', 'text[]').nullable();
    t.jsonb('preferred_call_days').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['clinic_id', 'patient_id']);
    t.index(['patient_id'], 'voice_patient_preferences_patient_id_idx');
  });
  await knex.raw(`
    CREATE INDEX idx_voice_patient_preferences_clinic_id ON voice_patient_preferences (clinic_id);
    ALTER TABLE voice_patient_preferences ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_voice_patient_preferences_tenant ON voice_patient_preferences
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_voice_patient_preferences_updated_at
      BEFORE UPDATE ON voice_patient_preferences
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION M — audit + security + webauthn + oauth + smart (13 tables)
  // ════════════════════════════════════════════════════════════════════
  //
  // - audit_log (single table, NOT partitioned in current DB) with TWO
  //   RLS policies (tenant + preauth_insert for system events with NULL
  //   clinic_id)
  // - backup_config (SINGLETON via UNIQUE INDEX ((true))), backup_history
  //   (NO clinic_id, no RLS — system-level)
  // - break_glass_sessions (2 partial UNIQUE indexes; reason min length 10)
  // - mfa_secrets (RLS DISABLED — auth_bypass policy only, used for
  //   pre-auth TOTP lookup)
  // - oauth_access_tokens, oauth_authorization_codes, oauth_refresh_tokens
  //   (3 OAuth tables; SMART on FHIR support)
  // - smart_apps, smart_launch_contexts (SMART on FHIR app registry)
  // - webauthn_credentials (partial UNIQUE WHERE NOT deleted)
  // - webhook_audit_log (APPEND-ONLY, NULLable clinic_id)
  // - webhook_secrets (UNIQUE per (clinic_id, source))

  // ── audit_log (system-wide audit; clinic_id NULLABLE for system events;
  //   2 RLS policies including preauth_insert allowing NULL clinic_id) ──
  await knex.schema.createTable('audit_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').nullable();
    t.uuid('staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('user_id').nullable();
    t.string('username', 200).nullable();
    t.string('action', 50).nullable();
    t.string('operation', 50).nullable();
    t.string('module', 100).nullable();
    t.string('entity_type', 100).nullable();
    t.string('entity_id', 100).nullable();
    t.string('table_name', 100).nullable();
    t.string('record_id', 100).nullable();
    t.jsonb('details').nullable();
    t.jsonb('old_data').nullable();
    t.jsonb('new_data').nullable();
    t.string('ip_address', 50).nullable();
    t.string('user_agent', 500).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'created_at']);
    t.index(['entity_type', 'entity_id']);
    t.index(['staff_id']);
    t.index(['table_name', 'record_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_audit_log_clinic_id ON audit_log (clinic_id);
    -- Named clinic_id FK with SET NULL (system events survive clinic deletion).
    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_clinic_id_foreign
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
    ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_audit_log_tenant ON audit_log
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    -- Pre-auth INSERT: allows system events (NULL clinic_id) when app.clinic_id
    -- is not yet set (e.g. login flow, system jobs). Critical for boot-time audit.
    CREATE POLICY rls_audit_log_preauth_insert ON audit_log FOR INSERT
      WITH CHECK (NULLIF(current_setting('app.clinic_id', true), '') IS NULL);
  `);

  // ── backup_config (SINGLETON via UNIQUE INDEX ((true)) — only one row allowed) ──
  await knex.schema.createTable('backup_config', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.boolean('schedule_enabled').notNullable().defaultTo(true);
    t.string('frequency', 16).notNullable().defaultTo('daily');
    t.string('time_of_day', 5).notNullable().defaultTo('02:00');
    t.integer('retention_days').notNullable().defaultTo(30);
    t.text('local_dir').nullable();
    t.text('offsite_target').nullable();
    t.timestamp('last_run_at', { useTz: true }).nullable();
    t.string('last_run_status', 16).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    -- SINGLETON: UNIQUE INDEX on the constant expression ((true)) limits the
    -- table to a single row. Raw SQL because Knex builder cannot express
    -- functional/expression UNIQUE indexes.
    CREATE UNIQUE INDEX backup_config_singleton_idx ON backup_config ((true));
    CREATE TRIGGER trg_backup_config_updated_at
      BEFORE UPDATE ON backup_config
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── backup_history (NO clinic_id, NO RLS — system-level audit) ──
  await knex.schema.createTable('backup_history', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('finished_at', { useTz: true }).nullable();
    t.string('status', 16).notNullable();
    t.bigInteger('size_bytes').nullable();
    t.text('location').nullable();
    t.text('error_text').nullable();
    t.string('trigger_kind', 16).notNullable().defaultTo('manual');
    t.uuid('triggered_by_staff_id').nullable();

    t.index(['started_at']);
    t.index(['status']);
    t.index(['trigger_kind']);
  });
  await knex.raw(`
    -- Named FK preserved per archived migration.
    ALTER TABLE backup_history
      ADD CONSTRAINT fk_backup_history_triggered_by_staff_id
      FOREIGN KEY (triggered_by_staff_id) REFERENCES staff(id) ON DELETE SET NULL;
  `);

  // ── break_glass_sessions (emergency access; reason min length 10;
  //   2 partial UNIQUE indexes: one_pending_per_staff + active_idx) ──
  await knex.schema.createTable('break_glass_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
    t.uuid('staff_id').notNullable().references('id').inTable('staff');
    t.text('reason').notNullable();
    t.text('status').notNullable().defaultTo('pending');
    t.uuid('approver_id').nullable().references('id').inTable('staff');
    t.timestamp('approved_at', { useTz: true }).nullable();
    t.text('denied_reason').nullable();
    t.text('token_hash').nullable();
    t.timestamp('issued_at', { useTz: true }).nullable();
    t.timestamp('expires_at', { useTz: true }).nullable();
    t.timestamp('revoked_at', { useTz: true }).nullable();
    t.uuid('revoked_by').nullable().references('id').inTable('staff');
    t.specificType('ip_address', 'inet').nullable();
    t.text('user_agent').nullable();
    t.jsonb('actions_performed').defaultTo('[]');
    t.timestamp('alerted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id'], 'break_glass_sessions_clinic_id_idx');
    t.index(['staff_id'], 'break_glass_sessions_staff_id_idx');
  });
  await knex.raw(`
    CREATE INDEX idx_break_glass_sessions_clinic_id ON break_glass_sessions (clinic_id);
    CREATE INDEX idx_break_glass_sessions_approver_id ON break_glass_sessions (approver_id);
    CREATE INDEX idx_break_glass_sessions_revoked_by ON break_glass_sessions (revoked_by);
    -- Partial indexes (raw SQL — Knex builder cannot express WHERE).
    CREATE INDEX break_glass_sessions_active_idx ON break_glass_sessions (staff_id, expires_at)
      WHERE status = 'approved';
    CREATE INDEX break_glass_sessions_pending_idx ON break_glass_sessions (clinic_id, created_at)
      WHERE status = 'pending';
    -- Partial UNIQUE: only one pending session per staff at a time.
    CREATE UNIQUE INDEX break_glass_sessions_one_pending_per_staff
      ON break_glass_sessions (staff_id) WHERE status = 'pending';
    ALTER TABLE break_glass_sessions ADD CONSTRAINT break_glass_sessions_status_chk
      CHECK (status IN ('pending','approved','denied','expired','revoked'));
    ALTER TABLE break_glass_sessions ADD CONSTRAINT break_glass_sessions_reason_min_length
      CHECK (char_length(reason) >= 10);
    ALTER TABLE break_glass_sessions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_break_glass_sessions_tenant ON break_glass_sessions
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── mfa_secrets (RLS DISABLED — only auth_bypass policy used for pre-auth
  //   TOTP lookup during login flow; NO clinic_id) ──
  await knex.schema.createTable('mfa_secrets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.string('secret', 500).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['staff_id']);
  });
  await knex.raw(`
    -- RLS is intentionally DISABLED (the Policies (row security disabled)
    -- marker in psql). The auth_bypass policy still exists for documentation
    -- but is not enforced because row security is OFF.
    ALTER TABLE mfa_secrets DISABLE ROW LEVEL SECURITY;
    CREATE POLICY auth_bypass ON mfa_secrets
      USING (NULLIF(current_setting('app.clinic_id', true), '') IS NULL)
      WITH CHECK (NULLIF(current_setting('app.clinic_id', true), '') IS NULL);
    CREATE TRIGGER trg_mfa_secrets_updated_at
      BEFORE UPDATE ON mfa_secrets
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── oauth_access_tokens (SMART-on-FHIR access tokens; APPEND-ONLY) ──
  await knex.schema.createTable('oauth_access_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('jti', 64).notNullable();
    t.string('client_id', 100).notNullable();
    t.uuid('clinic_id').notNullable();
    t.uuid('user_id').notNullable();
    t.uuid('patient_id').nullable();
    t.specificType('scopes', 'text[]').notNullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('issued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('revoked_at', { useTz: true }).nullable();
    t.text('revoked_reason').nullable();

    t.unique(['jti']);
    t.index(['client_id']);
    t.index(['expires_at']);
    t.index(['jti']);
    t.index(['user_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_oauth_access_tokens_clinic_id ON oauth_access_tokens (clinic_id);
    -- Named FKs preserved per archived migration.
    ALTER TABLE oauth_access_tokens
      ADD CONSTRAINT fk_oauth_access_tokens_clinic_id
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
    ALTER TABLE oauth_access_tokens
      ADD CONSTRAINT fk_oauth_access_tokens_patient_id
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL;
    ALTER TABLE oauth_access_tokens ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_oauth_access_tokens_tenant ON oauth_access_tokens
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── oauth_authorization_codes (SMART-on-FHIR auth codes; APPEND-ONLY) ──
  await knex.schema.createTable('oauth_authorization_codes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('code_hash', 64).notNullable();
    t.string('client_id', 100).notNullable();
    t.uuid('clinic_id').notNullable();
    t.uuid('user_id').notNullable();
    t.uuid('patient_id').nullable();
    t.text('redirect_uri').notNullable();
    t.specificType('scopes', 'text[]').notNullable();
    t.string('code_challenge', 128).nullable();
    t.string('code_challenge_method', 10).nullable();
    t.string('launch_token', 64).nullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('redeemed_at', { useTz: true }).nullable();

    t.unique(['code_hash']);
    t.index(['client_id']);
    t.index(['code_hash']);
    t.index(['expires_at']);
  });
  await knex.raw(`
    CREATE INDEX idx_oauth_authorization_codes_clinic_id ON oauth_authorization_codes (clinic_id);
    ALTER TABLE oauth_authorization_codes
      ADD CONSTRAINT fk_oauth_authorization_codes_clinic_id
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
    ALTER TABLE oauth_authorization_codes
      ADD CONSTRAINT fk_oauth_authorization_codes_patient_id
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL;
    ALTER TABLE oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_oauth_authorization_codes_tenant ON oauth_authorization_codes
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── oauth_refresh_tokens (SMART-on-FHIR refresh tokens; rotation chain) ──
  await knex.schema.createTable('oauth_refresh_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('token_hash', 64).notNullable();
    t.string('client_id', 100).notNullable();
    t.uuid('clinic_id').notNullable();
    t.uuid('user_id').notNullable();
    t.uuid('patient_id').nullable();
    t.specificType('scopes', 'text[]').notNullable();
    t.uuid('rotated_to_id').nullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('issued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('revoked_at', { useTz: true }).nullable();

    t.unique(['token_hash']);
    t.index(['client_id']);
    t.index(['expires_at']);
    t.index(['token_hash']);
    t.index(['user_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_oauth_refresh_tokens_clinic_id ON oauth_refresh_tokens (clinic_id);
    ALTER TABLE oauth_refresh_tokens
      ADD CONSTRAINT fk_oauth_refresh_tokens_clinic_id
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
    ALTER TABLE oauth_refresh_tokens
      ADD CONSTRAINT fk_oauth_refresh_tokens_patient_id
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL;
    ALTER TABLE oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_oauth_refresh_tokens_tenant ON oauth_refresh_tokens
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── smart_apps (SMART-on-FHIR app registry; client_id UNIQUE globally) ──
  await knex.schema.createTable('smart_apps', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable();
    t.string('client_id', 100).notNullable();
    t.string('client_secret_hash', 255).nullable();
    t.string('name', 200).notNullable();
    t.string('description', 1000).nullable();
    t.string('vendor', 200).nullable();
    t.string('vendor_url', 500).nullable();
    t.string('logo_url', 500).nullable();
    t.string('app_type', 30).notNullable().defaultTo('confidential');
    t.specificType('redirect_uris', 'text[]').notNullable();
    t.specificType('scopes', 'text[]').notNullable();
    t.specificType('launch_modes', 'text[]').notNullable().defaultTo(knex.raw(`'{ehr,standalone}'::text[]`));
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('is_approved').notNullable().defaultTo(false);
    t.uuid('approved_by_id').nullable();
    t.timestamp('approved_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['client_id']);
    t.index(['client_id']);
    t.index(['clinic_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_smart_apps_clinic_id ON smart_apps (clinic_id);
    ALTER TABLE smart_apps
      ADD CONSTRAINT fk_smart_apps_clinic_id
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
    ALTER TABLE smart_apps ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_smart_apps_tenant ON smart_apps
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_smart_apps_updated_at
      BEFORE UPDATE ON smart_apps
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── smart_launch_contexts (SMART app launch context; APPEND-ONLY) ──
  await knex.schema.createTable('smart_launch_contexts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('launch_token', 64).notNullable();
    t.string('client_id', 100).notNullable();
    t.uuid('clinic_id').notNullable();
    t.uuid('user_id').notNullable();
    t.uuid('patient_id').nullable();
    t.uuid('encounter_id').nullable();
    t.specificType('scopes', 'text[]').notNullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('consumed_at', { useTz: true }).nullable();

    t.unique(['launch_token']);
    t.index(['expires_at']);
    t.index(['launch_token']);
  });
  await knex.raw(`
    CREATE INDEX idx_smart_launch_contexts_clinic_id ON smart_launch_contexts (clinic_id);
    ALTER TABLE smart_launch_contexts
      ADD CONSTRAINT fk_smart_launch_contexts_clinic_id
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
    ALTER TABLE smart_launch_contexts
      ADD CONSTRAINT fk_smart_launch_contexts_patient_id
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL;
    ALTER TABLE smart_launch_contexts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_smart_launch_contexts_tenant ON smart_launch_contexts
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── webauthn_credentials (FIDO2/WebAuthn passkeys; partial UNIQUE WHERE NOT deleted) ──
  await knex.schema.createTable('webauthn_credentials', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
    t.text('credential_id').notNullable();
    t.text('public_key').notNullable();
    t.bigInteger('counter').notNullable().defaultTo(0);
    t.specificType('transports', 'text[]').nullable();
    t.text('device_name').nullable();
    t.text('aaguid').nullable();
    t.boolean('backup_eligible').notNullable().defaultTo(false);
    t.boolean('backup_state').notNullable().defaultTo(false);
    t.timestamp('last_used_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id'], 'webauthn_credentials_clinic_id_idx');
    t.index(['staff_id'], 'webauthn_credentials_staff_id_idx');
  });
  await knex.raw(`
    CREATE INDEX idx_webauthn_credentials_clinic_id ON webauthn_credentials (clinic_id);
    CREATE INDEX idx_webauthn_credentials_deleted_at ON webauthn_credentials (deleted_at)
      WHERE deleted_at IS NULL;
    -- Partial UNIQUE: credential_id must be unique among non-deleted rows;
    -- soft-deleted credentials free up the credential_id for re-registration.
    CREATE UNIQUE INDEX webauthn_credentials_credential_id_uniq
      ON webauthn_credentials (credential_id) WHERE deleted_at IS NULL;
    ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_webauthn_credentials_tenant ON webauthn_credentials
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_webauthn_credentials_updated_at
      BEFORE UPDATE ON webauthn_credentials
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── webhook_audit_log (APPEND-ONLY; clinic_id NULLABLE for system webhooks;
  //   payload_hash + nonce for idempotency) ──
  await knex.schema.createTable('webhook_audit_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').nullable();
    t.string('source', 100).notNullable();
    t.string('payload_hash', 64).notNullable();
    t.string('nonce', 128).nullable();
    t.string('outcome', 32).notNullable();
    t.text('error_text').nullable();
    t.string('job_id', 100).nullable();
    t.integer('body_size').nullable();
    t.string('source_ip', 64).nullable();
    t.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['outcome']);
    t.index(['received_at']);
    t.index(['source']);
    t.index(['source', 'payload_hash', 'received_at']);
  });
  await knex.raw(`
    CREATE INDEX idx_webhook_audit_log_clinic_id ON webhook_audit_log (clinic_id);
    ALTER TABLE webhook_audit_log
      ADD CONSTRAINT fk_webhook_audit_log_clinic_id
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
    ALTER TABLE webhook_audit_log ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_webhook_audit_log_tenant ON webhook_audit_log
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── webhook_secrets (per-clinic per-source HMAC secrets; UNIQUE per (clinic, source)) ──
  await knex.schema.createTable('webhook_secrets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable();
    t.string('source', 100).notNullable();
    t.text('hmac_secret').notNullable();
    t.string('signature_header', 100).notNullable().defaultTo('x-signature');
    t.string('timestamp_header', 100).nullable();
    t.integer('replay_window_seconds').notNullable().defaultTo(300);
    t.integer('rate_limit_per_minute').notNullable().defaultTo(60);
    t.text('ip_allowlist').nullable();
    t.string('queue_name', 100).notNullable().defaultTo('webhook-inbound');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['clinic_id', 'source']);
    t.index(['source']);
  });
  await knex.raw(`
    CREATE INDEX idx_webhook_secrets_clinic_id ON webhook_secrets (clinic_id);
    ALTER TABLE webhook_secrets
      ADD CONSTRAINT fk_webhook_secrets_clinic_id
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
    ALTER TABLE webhook_secrets ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_webhook_secrets_tenant ON webhook_secrets
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_webhook_secrets_updated_at
      BEFORE UPDATE ON webhook_secrets
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION N — deferred FK constraints (9 cross-section FKs)
  // ════════════════════════════════════════════════════════════════════
  //
  // Attach FKs that earlier sections deferred because the target table
  // was declared later in the file. All 9 FKs match the live DB exactly
  // (constraint name + delete rule preserved verbatim per psql audit).
  //
  // FKs attached here (child → parent / delete rule / constraint name):
  //   1. clinic_enabled_specialties.enabled_by  → staff           SET NULL
  //   2. clinical_notes.appointment_id          → appointments    SET NULL
  //   3. clinical_notes.template_id             → templates       SET NULL
  //   4. safety_checklists.case_id              → surgical_cases  CASCADE
  //   5. assessment_responses.template_id       → templates       SET NULL
  //   6. outcome_measures.template_id           → templates       NO ACTION
  //   7. contact_records.template_id            → templates       SET NULL
  //   8. clinical_note_evidence.chunk_id        → evidence_chunks RESTRICT
  //   9. correspondence_letters.template_id     → templates       SET NULL
  //
  // Bare-uuid columns with NO FK declared in current DB (preserved as-is):
  //   - patient_app_accounts.episode_id
  //   - waitlist_entries.referral_id
  //   - waitlist_entries.converted_appointment_id
  //   - pathology_results.flag_task_id
  //   - audit_log.user_id (no constraint declared in DB despite name)

  await knex.raw(`
    -- 1. clinic_enabled_specialties.enabled_by → staff
    ALTER TABLE clinic_enabled_specialties
      ADD CONSTRAINT clinic_enabled_specialties_enabled_by_foreign
      FOREIGN KEY (enabled_by) REFERENCES staff(id) ON DELETE SET NULL;

    -- 2. clinical_notes.appointment_id → appointments
    ALTER TABLE clinical_notes
      ADD CONSTRAINT fk_clinical_notes_appointment_id
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;

    -- 3. clinical_notes.template_id → templates
    ALTER TABLE clinical_notes
      ADD CONSTRAINT fk_clinical_notes_template_id
      FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL;

    -- 4. safety_checklists.case_id → surgical_cases (CASCADE)
    ALTER TABLE safety_checklists
      ADD CONSTRAINT safety_checklists_case_id_foreign
      FOREIGN KEY (case_id) REFERENCES surgical_cases(id) ON DELETE CASCADE;

    -- 5. assessment_responses.template_id → templates
    ALTER TABLE assessment_responses
      ADD CONSTRAINT fk_assessment_responses_template_id
      FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL;

    -- 6. outcome_measures.template_id → templates (NO ACTION — note the
    --    _fkey suffix instead of _foreign; preserved per current DB).
    ALTER TABLE outcome_measures
      ADD CONSTRAINT outcome_measures_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES templates(id);

    -- 7. contact_records.template_id → templates
    ALTER TABLE contact_records
      ADD CONSTRAINT fk_contact_records_template_id
      FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL;

    -- 8. clinical_note_evidence.chunk_id → evidence_chunks (RESTRICT —
    --    cannot delete an evidence chunk that's still cited by any note).
    ALTER TABLE clinical_note_evidence
      ADD CONSTRAINT clinical_note_evidence_chunk_id_foreign
      FOREIGN KEY (chunk_id) REFERENCES evidence_chunks(id) ON DELETE RESTRICT;

    -- 9. correspondence_letters.template_id → templates
    ALTER TABLE correspondence_letters
      ADD CONSTRAINT fk_correspondence_letters_template_id
      FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL;
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION O — app_user GRANTS + missing auth_bypass policies
  // ════════════════════════════════════════════════════════════════════
  //
  // The runtime app_user role needs:
  //   - CONNECT on database
  //   - USAGE on schema public
  //   - SELECT/INSERT/UPDATE/DELETE on ALL TABLES
  //   - USAGE/SELECT on ALL SEQUENCES
  //   - DEFAULT PRIVILEGES so future tables created by signacare_owner
  //     also grant to app_user
  //
  // Without these grants, app_user cannot read information_schema columns
  // (and the snapshot generator returns empty), let alone access any data.
  //
  // Plus missing auth_bypass policies on staff (login lookup) — the
  // staff_sessions and mfa_secrets policies are already in C2/M.
  //
  // Source: 20260329_rls_app_user.sql (preserved name-agnostic, see
  // CLAUDE.md §7.4 — must NOT hardcode database name or owner role).

  await knex.raw(`
    -- Resolve owner role dynamically; fall back to current_user.
    -- See CLAUDE.md §7.4 for the rule + the 2026-04-15 drift incident
    -- that motivated dynamic resolution (hardcoded names broke against
    -- canonical signacare_owner / signacaredb).
    DO $$
    DECLARE
      owner_role TEXT := COALESCE(NULLIF(current_setting('app.owner_role', true), ''), current_user);
    BEGIN
      PERFORM set_config('app.owner_role', owner_role, true);
    END $$;

    -- ─── 1. GRANT app_user privileges (current + future) ───
    DO $$
    DECLARE
      db_name TEXT := current_database();
      owner_role TEXT := current_setting('app.owner_role', true);
    BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', db_name);
      EXECUTE 'GRANT USAGE ON SCHEMA public TO app_user';
      EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user';
      EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user';
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user',
        owner_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user',
        owner_role
      );
    END $$;

    -- ─── 2. Auth-bypass policies for pre-tenant-context login flow ───
    -- staff: login lookup by email + update failed_login_attempts before
    -- app.clinic_id is set. staff_sessions + mfa_secrets policies are
    -- already declared in their respective table sections.
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'staff' AND policyname = 'auth_bypass') THEN
        EXECUTE 'CREATE POLICY auth_bypass ON staff FOR ALL
          USING (NULLIF(current_setting(''app.clinic_id'', true), '''') IS NULL)
          WITH CHECK (NULLIF(current_setting(''app.clinic_id'', true), '''') IS NULL)';
      END IF;
    END $$;
  `);

  // ════════════════════════════════════════════════════════════════════
  // SECTION P — privacy module tables (Phase R3 R3a discovery)
  // ════════════════════════════════════════════════════════════════════
  //
  // Discovered during R3a/C8: privacyRoutes references 4 tables that
  // don't exist in any prior schema. Routes are mounted at
  // /api/v1/privacy/* and would crash with "relation does not exist"
  // on every POST. Per user direction (AskUserQuestion 2026-04-18):
  // add the 4 missing tables to baseline + reset DB.
  //
  // Schema derived from the route handler INSERT/SELECT calls (no
  // pre-existing migration to copy from). Standard tenant + audit
  // pattern: clinic_id NOT NULL + RLS + updated_at trigger.

  // ── consent_records ───────────────────────────────────────────────────
  await knex.schema.createTable('consent_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('consent_type', 100).notNullable();
    t.string('status', 30).notNullable().defaultTo('granted');
    t.timestamp('granted_at', { useTz: true }).nullable();
    t.timestamp('withdrawn_at', { useTz: true }).nullable();
    t.timestamp('expires_at', { useTz: true }).nullable();
    t.string('witness_name', 255).nullable();
    t.string('witness_role', 100).nullable();
    t.text('notes').nullable();
    t.uuid('recorded_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'patient_id']);
  });
  await knex.raw(`
    CREATE INDEX idx_consent_records_clinic_id ON consent_records (clinic_id);
    ALTER TABLE consent_records ADD CONSTRAINT consent_records_status_check
      CHECK (status IN ('granted','withdrawn','expired','pending'));
    ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_consent_records_tenant ON consent_records
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_consent_records_updated_at
      BEFORE UPDATE ON consent_records
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── data_breach_log (Privacy Act 1988 — NDB scheme audit trail) ──
  // The ndbNotification module (apps/api/src/features/privacy/ndbNotification.ts)
  // writes three additional NDB-assessment columns that need to be
  // real columns: is_notifiable (bool), notification_deadline
  // (timestamptz), oaic_form_data (jsonb).
  await knex.schema.createTable('data_breach_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('breach_type', 100).nullable();
    t.string('severity', 30).notNullable().defaultTo('medium');
    t.text('description').notNullable();
    t.integer('affected_records').notNullable().defaultTo(0);
    t.integer('affected_patients').notNullable().defaultTo(0);
    t.text('containment_actions').nullable();
    t.uuid('reported_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('detected_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('reported_at', { useTz: true }).nullable();
    t.string('status', 30).notNullable().defaultTo('open');
    t.text('resolution_notes').nullable();
    t.boolean('is_notifiable').nullable();
    t.timestamp('notification_deadline', { useTz: true }).nullable();
    t.jsonb('oaic_form_data').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'detected_at']);
    t.index(['clinic_id', 'status']);
  });
  await knex.raw(`
    CREATE INDEX idx_data_breach_log_clinic_id ON data_breach_log (clinic_id);
    ALTER TABLE data_breach_log ADD CONSTRAINT data_breach_log_severity_check
      CHECK (severity IN ('low','medium','high','critical'));
    ALTER TABLE data_breach_log ADD CONSTRAINT data_breach_log_status_check
      CHECK (status IN ('open','contained','resolved','reported_to_oaic'));
    ALTER TABLE data_breach_log ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_data_breach_log_tenant ON data_breach_log
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_data_breach_log_updated_at
      BEFORE UPDATE ON data_breach_log
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── data_retention_policies (per-data-category retention rules) ──
  await knex.schema.createTable('data_retention_policies', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('data_category', 100).notNullable();
    t.integer('retention_years').notNullable().defaultTo(7);
    t.text('legal_basis').nullable();
    t.text('disposal_method').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['clinic_id', 'data_category']);
  });
  await knex.raw(`
    CREATE INDEX idx_data_retention_policies_clinic_id ON data_retention_policies (clinic_id);
    ALTER TABLE data_retention_policies ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_data_retention_policies_tenant ON data_retention_policies
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_data_retention_policies_updated_at
      BEFORE UPDATE ON data_retention_policies
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── fhir_subscriptions (FHIR R4 Subscription — webhook+email channels) ──
  // Pre-R3 the fhirSubscription route created this table on-demand
  // (CLAUDE.md §7.3 forbids DDL in routes). Table is now a real
  // first-class citizen of the baseline.
  await knex.schema.createTable('fhir_subscriptions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.string('status', 30).defaultTo('active');
    t.string('criteria', 500).notNullable();
    t.string('channel_type', 30).notNullable();
    t.string('channel_endpoint', 1000).notNullable();
    t.specificType('channel_header', 'text[]').nullable();
    t.string('channel_payload', 30).defaultTo('application/fhir+json');
    t.string('reason', 500).nullable();
    t.timestamp('end_time', { useTz: true }).nullable();
    t.uuid('created_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'status']);
  });
  await knex.raw(`
    CREATE INDEX idx_fhir_subscriptions_clinic_id ON fhir_subscriptions (clinic_id);
    ALTER TABLE fhir_subscriptions ADD CONSTRAINT fhir_subscriptions_status_check
      CHECK (status IN ('requested','active','error','off'));
    ALTER TABLE fhir_subscriptions ADD CONSTRAINT fhir_subscriptions_channel_type_check
      CHECK (channel_type IN ('rest-hook','email','websocket'));
    ALTER TABLE fhir_subscriptions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_fhir_subscriptions_tenant ON fhir_subscriptions
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_fhir_subscriptions_updated_at
      BEFORE UPDATE ON fhir_subscriptions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── data_sharing_agreements (Privacy Act 2024 — inter-provider sharing) ──
  await knex.schema.createTable('data_sharing_agreements', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('partner_name', 255).notNullable();
    t.string('partner_type', 50).nullable();
    t.text('purpose').nullable();
    t.jsonb('data_categories').nullable();
    t.date('start_date').nullable();
    t.date('end_date').nullable();
    t.text('conditions').nullable();
    t.string('status', 30).notNullable().defaultTo('draft');
    t.uuid('approved_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'status']);
  });
  await knex.raw(`
    CREATE INDEX idx_data_sharing_agreements_clinic_id ON data_sharing_agreements (clinic_id);
    ALTER TABLE data_sharing_agreements ADD CONSTRAINT data_sharing_agreements_status_check
      CHECK (status IN ('draft','active','expired','revoked'));
    ALTER TABLE data_sharing_agreements ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_data_sharing_agreements_tenant ON data_sharing_agreements
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_data_sharing_agreements_updated_at
      BEFORE UPDATE ON data_sharing_agreements
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── audit_templates (Medical Director clinical-note quality audit — templates) ──
  // Pre-R3 reportsRoutes.ts referenced this as a ghost table (never existed
  // in any prior migration). Surfaced during C9 .returning conversion.
  // Owns the audit questionnaire definition — clinicians define rubrics,
  // then runs score sampled clinical notes against the rubric (manual or
  // LLM-assisted). Soft-deletable (line 422 whereNull('deleted_at')).
  await knex.schema.createTable('audit_templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('description').nullable();
    t.jsonb('questions').notNullable();
    t.uuid('created_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id', 'name']);
  });
  await knex.raw(`
    CREATE INDEX idx_audit_templates_not_deleted ON audit_templates (clinic_id)
      WHERE deleted_at IS NULL;
    ALTER TABLE audit_templates ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_audit_templates_tenant ON audit_templates
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_audit_templates_updated_at
      BEFORE UPDATE ON audit_templates
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ── audit_runs (Medical Director clinical-note quality audit — runs) ──
  // Each row = one audit execution against a random sample of signed
  // clinical notes. selected_note_ids stores the sampled UUIDs; results
  // stores LLM-scored or manually-scored findings. Status transitions:
  // manual → (no transition) | llm_pending → completed | llm_pending → llm_failed.
  await knex.schema.createTable('audit_runs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('template_id').notNullable().references('id').inTable('audit_templates').onDelete('RESTRICT');
    t.uuid('team_id').nullable().references('id').inTable('org_units').onDelete('SET NULL');
    t.uuid('clinician_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.integer('sample_size').notNullable();
    t.string('status', 30).notNullable().defaultTo('manual');
    t.jsonb('selected_note_ids').notNullable();
    t.jsonb('results').nullable();
    t.uuid('created_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'created_at']);
    t.index(['template_id']);
  });
  await knex.raw(`
    ALTER TABLE audit_runs ADD CONSTRAINT audit_runs_status_check
      CHECK (status IN ('manual','llm_pending','completed','llm_failed'));
    ALTER TABLE audit_runs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_audit_runs_tenant ON audit_runs
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    CREATE TRIGGER trg_audit_runs_updated_at
      BEFORE UPDATE ON audit_runs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // ════════════════════════════════════════════════════════════════════
  // R2b BASELINE COMPLETE — 202 tables declared (189 from live DB +
  // 11 newly materialized ghost tables: care_plans + care_plan_goals +
  // care_plan_interventions + community_resources + medication_administrations +
  // shift_handovers + clinical_formulations + side_effect_schedules +
  // phone_triage + staff_leave + report_schedules; + 6 Section P:
  // consent_records + data_breach_log + data_retention_policies +
  // fhir_subscriptions + data_sharing_agreements + audit_templates +
  // audit_runs) with 9 deferred FKs attached + app_user grants + staff
  // auth_bypass policy.
  //
  // Live DB count: 191 = 189 user tables + 2 knex internals (knex_migrations
  // + knex_migrations_lock) which Knex creates automatically.
  //
  // Next: R2c — drop signacaredb, recreate, run baseline, regen snapshot,
  // reseed Good Health.
  // ════════════════════════════════════════════════════════════════════
}

export async function down(_knex: Knex): Promise<void> {
  throw new Error(
    'Phase R R2b is a one-way migration. To rollback, use the git tag ' +
    '`pre-baseline-rebuild` placed at 2026-04-18:\n' +
    '  git reset --hard pre-baseline-rebuild\n' +
    '  git mv apps/api/migrations.archive/*.ts apps/api/migrations/\n' +
    '  psql -U postgres -c "DROP DATABASE signacaredb WITH (FORCE)"\n' +
    '  psql -U postgres -c "CREATE DATABASE signacaredb OWNER signacare_owner"\n' +
    '  npm run migrate:dev --workspace=apps/api\n' +
    '  npm run seed:good-health --workspace=apps/api\n',
  );
}
