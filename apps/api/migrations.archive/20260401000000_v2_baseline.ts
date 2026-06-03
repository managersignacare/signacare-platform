/**
 * V2 Baseline Migration — Signacare EMR
 *
 * This is the canonical, single-file schema definition for the entire Signacare
 * EMR database.  Every table uses proper snake_case naming for both the table
 * name and all column names.  Every CREATE is guarded by a `hasTable` check so
 * the migration is fully idempotent and safe to run against databases that
 * already have some (or all) of these tables.
 *
 * This replaces the ad-hoc collection of earlier migrations with one
 * authoritative source of truth.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 0 — Foundation tables (no FK dependencies)
  // ══════════════════════════════════════════════════════════════════════════

  // ── clinics ─────────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('clinics'))) {
    await knex.schema.createTable('clinics', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.string('name', 255).notNullable();
      t.string('legal_name', 255).nullable();
      t.string('abn', 20).nullable();
      t.string('phone', 30).nullable();
      t.string('email', 255).nullable();
      t.string('address_line1', 255).nullable();
      t.string('address_line2', 255).nullable();
      t.string('suburb', 100).nullable();
      t.string('state', 20).nullable();
      t.string('postcode', 10).nullable();
      t.string('country', 10).defaultTo('AU');
      t.string('timezone', 100).defaultTo('Australia/Melbourne');
      t.string('time_zone', 100).defaultTo('Australia/Melbourne');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();
    });
  }

  // ── permissions ─────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('permissions'))) {
    await knex.schema.createTable('permissions', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.string('name', 200).notNullable().unique();
      t.string('description', 500).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }

  // ── legal_order_types ───────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('legal_order_types'))) {
    await knex.schema.createTable('legal_order_types', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.string('code', 50).notNullable();
      t.string('name', 200).notNullable();
      t.string('jurisdiction', 20).notNullable().defaultTo('VIC');
      t.integer('max_duration_days').nullable();
      t.boolean('requires_tribunal').notNullable().defaultTo(false);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }

  // ── investigation_types ─────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('investigation_types'))) {
    await knex.schema.createTable('investigation_types', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('name', 200).notNullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('sort_order').notNullable().defaultTo(0);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 1 — Staff & org structure (depend on clinics)
  // ══════════════════════════════════════════════════════════════════════════

  // ── staff ───────────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('staff'))) {
    await knex.schema.createTable('staff', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('given_name', 100).notNullable();
      t.string('family_name', 100).notNullable();
      t.string('preferred_name', 100).nullable();
      t.string('email', 255).notNullable().unique();
      t.string('password_hash', 255).notNullable();
      t.string('role', 50).notNullable().defaultTo('clinician');
      t.string('discipline', 100).nullable();
      t.string('discipline_id', 100).nullable();
      t.string('phone_mobile', 30).nullable();
      t.string('phone_work', 30).nullable();
      t.string('ahpra_number', 50).nullable();
      t.string('prescriber_number', 50).nullable();
      t.string('provider_number', 50).nullable();
      t.string('hpii', 50).nullable();
      t.text('qualifications').nullable();
      t.string('specialisation', 200).nullable();
      t.string('employment_type', 50).nullable();
      t.string('worker_type', 50).nullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.boolean('require_mfa').notNullable().defaultTo(false);
      t.boolean('has_mfa_configured').notNullable().defaultTo(false);
      t.boolean('mfa_enabled').defaultTo(false);
      t.string('mfa_secret', 255).nullable();
      t.jsonb('recovery_codes').nullable();
      t.boolean('must_change_password').defaultTo(false);
      t.integer('failed_login_attempts').notNullable().defaultTo(0);
      t.timestamp('locked_until', { useTz: true }).nullable();
      t.timestamp('last_login_at', { useTz: true }).nullable();
      t.string('outlook_email', 255).nullable();
      t.string('outlook_refresh_token', 1000).nullable();
      t.bigInteger('outlook_token_expires_at').nullable();
      t.string('outlook_calendar_id', 255).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id']);
      t.index(['clinic_id', 'is_active']);
      t.index(['email']);
    });
  }

  // ── staff_sessions ──────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('staff_sessions'))) {
    await knex.schema.createTable('staff_sessions', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.string('refresh_token', 500).notNullable();
      t.string('user_agent', 500).nullable();
      t.string('ip_address', 50).nullable();
      t.timestamp('expires_at', { useTz: true }).notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('revoked_at', { useTz: true }).nullable();

      t.index(['staff_id']);
      t.index(['refresh_token']);
    });
  }

  // ── staff_permissions ───────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('staff_permissions'))) {
    await knex.schema.createTable('staff_permissions', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
      t.uuid('permission_id').notNullable().references('id').inTable('permissions').onDelete('CASCADE');
      t.timestamp('granted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.uuid('granted_by').nullable().references('id').inTable('staff').onDelete('SET NULL');

      t.unique(['staff_id', 'permission_id']);
    });
  }

  // ── mfa_secrets ─────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('mfa_secrets'))) {
    await knex.schema.createTable('mfa_secrets', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
      t.string('secret', 500).notNullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['staff_id']);
    });
  }

  // ── staff_settings ──────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('staff_settings'))) {
    await knex.schema.createTable('staff_settings', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
      t.string('setting_key', 200).notNullable();
      t.jsonb('setting_value').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.unique(['staff_id', 'setting_key']);
      t.index(['staff_id']);
    });
  }

  // ── org_units ───────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('org_units'))) {
    await knex.schema.createTable('org_units', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('name', 200).notNullable();
      t.string('level', 50).notNullable().defaultTo('team');
      t.uuid('parent_id').nullable().references('id').inTable('org_units').onDelete('CASCADE');
      t.integer('sort_order').notNullable().defaultTo(0);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
      t.index(['parent_id']);
      t.index(['clinic_id', 'level']);
    });
  }

  // ── org_unit_programs ───────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('org_unit_programs'))) {
    await knex.schema.createTable('org_unit_programs', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('org_unit_id').notNullable().references('id').inTable('org_units').onDelete('CASCADE');
      t.string('name', 200).notNullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.unique(['org_unit_id', 'name']);
      t.index(['clinic_id']);
    });
  }

  // ── org_level_labels ────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('org_level_labels'))) {
    await knex.schema.createTable('org_level_labels', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.integer('level').notNullable();
      t.string('label', 200).notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.unique(['clinic_id', 'level']);
    });
  }

  // ── programs ────────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('programs'))) {
    await knex.schema.createTable('programs', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('name', 200).notNullable();
      t.text('description').nullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
    });
  }

  // ── clinical_roles ──────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('clinical_roles'))) {
    await knex.schema.createTable('clinical_roles', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('name', 200).notNullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('sort_order').notNullable().defaultTo(0);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
    });
  }

  // ── professional_disciplines ────────────────────────────────────────────
  if (!(await knex.schema.hasTable('professional_disciplines'))) {
    await knex.schema.createTable('professional_disciplines', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('name', 200).notNullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('sort_order').notNullable().defaultTo(0);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
    });
  }

  // ── staff_team_assignments ──────────────────────────────────────────────
  if (!(await knex.schema.hasTable('staff_team_assignments'))) {
    await knex.schema.createTable('staff_team_assignments', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
      t.uuid('org_unit_id').notNullable().references('id').inTable('org_units').onDelete('CASCADE');
      t.date('start_date').notNullable();
      t.date('end_date').nullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['staff_id']);
      t.index(['org_unit_id']);
    });
  }

  // ── staff_role_assignments ──────────────────────────────────────────────
  if (!(await knex.schema.hasTable('staff_role_assignments'))) {
    await knex.schema.createTable('staff_role_assignments', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
      t.uuid('org_unit_id').notNullable().references('id').inTable('org_units').onDelete('CASCADE');
      t.uuid('clinical_role_id').notNullable().references('id').inTable('clinical_roles').onDelete('CASCADE');
      t.string('role_type', 50).notNullable();
      t.date('start_date').notNullable();
      t.date('end_date').nullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['staff_id']);
      t.index(['org_unit_id']);
    });
  }

  // ── staff_module_access ─────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('staff_module_access'))) {
    await knex.schema.createTable('staff_module_access', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('module', 100).notNullable();
      t.string('access_level', 30).notNullable().defaultTo('read');
      t.uuid('granted_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.boolean('can_delegate_this').notNullable().defaultTo(false);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['staff_id', 'clinic_id']);
      t.index(['clinic_id', 'module']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 2 — Patients (depend on clinics)
  // ══════════════════════════════════════════════════════════════════════════

  // ── patients ────────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('patients'))) {
    await knex.schema.createTable('patients', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('emr_number', 50).nullable();
      t.string('given_name', 100).notNullable();
      t.string('family_name', 100).notNullable();
      t.string('preferred_name', 100).nullable();
      t.date('date_of_birth').notNullable();
      t.string('gender', 30).nullable();
      t.string('pronouns', 50).nullable();
      t.string('email', 255).nullable();
      t.string('email_primary', 255).nullable();
      t.string('phone_mobile', 30).nullable();
      t.string('phone_home', 30).nullable();
      t.string('address_line1', 255).nullable();
      t.string('address_line2', 255).nullable();
      t.string('suburb', 100).nullable();
      t.string('state', 30).nullable();
      t.string('postcode', 10).nullable();
      t.string('country', 60).nullable().defaultTo('AU');
      t.string('status', 30).notNullable().defaultTo('active');
      // Medicare / DVA / IHI
      t.string('medicare_number', 30).nullable();
      t.string('medicare_reference', 10).nullable();
      t.date('medicare_expiry').nullable();
      t.string('ihi_number', 30).nullable();
      t.string('dva_number', 30).nullable();
      t.string('dva_card_type', 20).nullable();
      // Cultural
      t.string('indigenous_status', 50).nullable();
      t.string('atsi_status', 50).nullable();
      t.boolean('interpreter_required').notNullable().defaultTo(false);
      t.string('interpreter_language', 100).nullable();
      // Emergency contact (legacy columns)
      t.string('emergency_contact_name', 200).nullable();
      t.string('emergency_contact_phone', 30).nullable();
      t.string('emergency_contact_relationship', 100).nullable();
      // GP details
      t.string('gp_name', 200).nullable();
      t.string('gp_practice', 200).nullable();
      t.string('gp_phone', 30).nullable();
      t.string('gp_fax', 30).nullable();
      t.string('gp_email', 255).nullable();
      t.string('gp_provider_number', 30).nullable();
      t.string('gp_address_street', 255).nullable();
      t.string('gp_address_suburb', 100).nullable();
      t.string('gp_address_state', 20).nullable();
      t.string('gp_address_postcode', 10).nullable();
      // Next of kin
      t.string('nok_name', 200).nullable();
      t.string('nok_relationship', 100).nullable();
      t.string('nok_phone', 30).nullable();
      // Consent
      t.boolean('consent_to_treatment').defaultTo(false);
      t.boolean('consent_for_research').defaultTo(false);
      t.boolean('consent_to_share_with_gp').defaultTo(false);
      t.boolean('consent_to_share_with_carer').defaultTo(false);
      // Timestamps
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id']);
      t.index(['clinic_id', 'family_name', 'given_name']);
      t.index(['clinic_id', 'emr_number']);
      t.index(['clinic_id', 'status']);
      t.index(['deleted_at']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 3 — Episodes (depend on patients, staff, clinics)
  // ══════════════════════════════════════════════════════════════════════════

  // ── episodes ────────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('episodes'))) {
    await knex.schema.createTable('episodes', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('title', 300).nullable();
      t.string('episode_number', 50).nullable();
      t.string('episode_type', 50).nullable();
      t.string('status', 30).notNullable().defaultTo('open');
      t.text('presenting_problem').nullable();
      t.text('primary_diagnosis').nullable();
      t.date('start_date').notNullable();
      t.date('end_date').nullable();
      t.text('closure_reason').nullable();
      t.text('closure_summary').nullable();
      t.uuid('team_id').nullable();
      t.uuid('primary_clinician_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'patient_id']);
      t.index(['clinic_id', 'status']);
      t.index(['patient_id', 'status']);
      t.index(['primary_clinician_id']);
    });
  }

  // ── patient_team_assignments ────────────────────────────────────────────
  if (!(await knex.schema.hasTable('patient_team_assignments'))) {
    await knex.schema.createTable('patient_team_assignments', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('org_unit_id').notNullable().references('id').inTable('org_units').onDelete('CASCADE');
      t.uuid('primary_clinician_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['patient_id']);
      t.index(['org_unit_id']);
      t.index(['patient_id', 'is_active']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 4 — Templates (depend on clinics, staff)
  // ══════════════════════════════════════════════════════════════════════════

  // ── template_categories ─────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('template_categories'))) {
    await knex.schema.createTable('template_categories', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('name', 200).notNullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('sort_order').notNullable().defaultTo(0);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
    });
  }

  // ── templates ───────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('templates'))) {
    await knex.schema.createTable('templates', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('name', 255).notNullable();
      t.string('type', 50).nullable();
      t.text('description').nullable();
      t.string('category', 100).notNullable().defaultTo('General');
      t.jsonb('content').nullable().defaultTo('[]');
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
  }

  // ── template_sections ───────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('template_sections'))) {
    await knex.schema.createTable('template_sections', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('template_id').notNullable().references('id').inTable('templates').onDelete('CASCADE');
      t.string('section_type', 50).nullable();
      t.string('label', 200).nullable();
      t.jsonb('options').nullable();
      t.integer('sort_order').defaultTo(0);
      t.boolean('is_required').defaultTo(false);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['template_id']);
    });
  }

  // ── clinical_templates ──────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('clinical_templates'))) {
    await knex.schema.createTable('clinical_templates', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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

      t.index(['clinic_id', 'type']);
      t.index(['category_id']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 5 — Clinical notes (depend on patients, episodes, staff, clinics)
  // ══════════════════════════════════════════════════════════════════════════

  // ── clinical_notes ──────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('clinical_notes'))) {
    await knex.schema.createTable('clinical_notes', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('author_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.uuid('appointment_id').nullable();
      t.string('title', 500).nullable();
      t.string('note_type', 50).notNullable().defaultTo('soap');
      t.string('note_category', 100).nullable();
      t.string('source_type', 50).nullable();
      t.timestamp('note_date_time', { useTz: true }).nullable();
      t.date('note_date').nullable();
      t.text('content').nullable();
      t.text('content_html').nullable();
      t.jsonb('structured_fields').nullable();
      t.string('status', 30).notNullable().defaultTo('draft');
      t.boolean('is_draft').defaultTo(true);
      t.boolean('is_signed').defaultTo(false);
      t.uuid('template_id').nullable();
      t.boolean('is_reportable_contact').notNullable().defaultTo(true);
      t.jsonb('contact_meta').nullable();
      t.text('foi_content').nullable();
      t.boolean('foi_exempt').notNullable().defaultTo(false);
      t.boolean('did_not_attend').notNullable().defaultTo(false);
      t.boolean('is_ai_draft').notNullable().defaultTo(false);
      t.text('soap_subjective').nullable();
      t.text('soap_objective').nullable();
      t.text('soap_assessment').nullable();
      t.text('soap_plan').nullable();
      t.uuid('amended_from_id').nullable();
      t.timestamp('signed_at', { useTz: true }).nullable();
      t.uuid('signed_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.uuid('signed_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'patient_id']);
      t.index(['clinic_id', 'episode_id']);
      t.index(['clinic_id', 'status']);
      t.index(['clinic_id', 'note_type']);
      t.index(['appointment_id']);
      t.index(['deleted_at']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 6 — Appointments, referrals, waitlist
  // ══════════════════════════════════════════════════════════════════════════

  // ── appointments ────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('appointments'))) {
    await knex.schema.createTable('appointments', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('clinician_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
      t.uuid('staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      // Times (v1 columns)
      t.timestamp('start_time', { useTz: true }).notNullable();
      t.timestamp('end_time', { useTz: true }).notNullable();
      // Times (v2 columns)
      t.timestamp('appointment_start', { useTz: true }).nullable();
      t.timestamp('appointment_end', { useTz: true }).nullable();
      t.integer('duration_minutes').nullable();
      // Type
      t.string('status', 50).notNullable().defaultTo('scheduled');
      t.string('type', 50).notNullable().defaultTo('initial');
      t.string('appointment_type', 50).nullable();
      t.string('mode', 50).nullable();
      t.string('mbs_item', 20).nullable();
      t.string('patient_response', 50).nullable();
      t.string('location', 200).nullable();
      // Notes
      t.text('notes').nullable();
      // Telehealth
      t.boolean('telehealth').defaultTo(false);
      t.string('telehealth_url', 500).nullable();
      t.string('telehealth_link', 500).nullable();
      t.string('telehealth_provider', 100).nullable();
      t.string('telehealth_passcode', 100).nullable();
      // Cancellation
      t.string('cancellation_reason', 500).nullable();
      t.uuid('cancelled_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      // Rescheduling
      t.uuid('rescheduled_from_id').nullable();
      // Reminders
      t.boolean('reminder_scheduled').notNullable().defaultTo(false);
      t.boolean('reminder_sent').notNullable().defaultTo(false);
      t.timestamp('reminder_sent_at', { useTz: true }).nullable();
      // Outlook sync
      t.string('outlook_event_id', 255).nullable();
      // Timestamps
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'patient_id']);
      t.index(['clinic_id', 'clinician_id']);
      t.index(['clinic_id', 'start_time']);
      t.index(['clinic_id', 'status']);
      t.index(['staff_id']);
      t.index(['deleted_at']);
    });
  }

  // ── appointment_modes ───────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('appointment_modes'))) {
    await knex.schema.createTable('appointment_modes', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('name', 100).notNullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('sort_order').notNullable().defaultTo(0);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
    });
  }

  // ── waitlist_entries ────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('waitlist_entries'))) {
    await knex.schema.createTable('waitlist_entries', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('referral_id').nullable();
      t.uuid('preferred_clinician_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.string('priority', 30).notNullable().defaultTo('medium');
      t.string('preferred_time_of_day', 50).nullable();
      t.time('preferred_start_time').nullable();
      t.time('preferred_end_time').nullable();
      t.date('added_date').notNullable().defaultTo(knex.fn.now());
      t.date('target_appointment_by').nullable();
      t.string('status', 30).notNullable().defaultTo('waiting');
      t.uuid('converted_appointment_id').nullable();
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'status']);
      t.index(['clinic_id', 'patient_id']);
      t.index(['preferred_clinician_id']);
    });
  }

  // ── referral_sources ────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('referral_sources'))) {
    await knex.schema.createTable('referral_sources', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('category', 100).notNullable();
      t.string('name', 200).notNullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('sort_order').notNullable().defaultTo(0);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
    });
  }

  // ── referrals ───────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('referrals'))) {
    await knex.schema.createTable('referrals', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').nullable().references('id').inTable('patients').onDelete('SET NULL');
      t.string('referral_number', 50).notNullable();
      t.date('referral_date').notNullable();
      t.string('source', 50).notNullable().defaultTo('external');
      t.string('from_service', 200).notNullable();
      t.string('from_provider_name', 200).nullable();
      t.string('from_provider_phone', 30).nullable();
      t.string('from_provider_email', 255).nullable();
      t.string('from_provider_prescriber_no', 30).nullable();
      t.string('referring_org', 200).nullable();
      t.text('reason').notNullable();
      t.text('clinical_summary').nullable();
      t.text('current_medications').nullable();
      t.text('diagnosis_info').nullable();
      t.string('urgency', 30).notNullable().defaultTo('routine');
      t.string('status', 30).notNullable().defaultTo('received');
      t.timestamp('status_changed_at', { useTz: true }).nullable();
      t.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.uuid('assigned_to_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.uuid('linked_episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.boolean('has_attachment').notNullable().defaultTo(false);
      t.jsonb('ocr_extracted').nullable();
      t.text('rejection_reason').nullable();
      t.string('redirect_to', 200).nullable();
      t.date('sla_due_date').nullable();
      t.boolean('sla_breached').notNullable().defaultTo(false);
      t.text('internal_notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'status']);
      t.index(['clinic_id', 'patient_id']);
      t.index(['referral_number']);
      t.index(['assigned_to_staff_id']);
    });
  }

  // ── referral_attachments ────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('referral_attachments'))) {
    await knex.schema.createTable('referral_attachments', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('referral_id').notNullable().references('id').inTable('referrals').onDelete('CASCADE');
      t.string('original_filename', 500).notNullable();
      t.string('stored_filename', 500).notNullable();
      t.string('mime_type', 100).notNullable();
      t.bigInteger('file_size_bytes').notNullable();
      t.string('storage_key', 500).notNullable();
      t.string('category', 50).notNullable().defaultTo('referral');
      t.string('ocr_status', 30).notNullable().defaultTo('pending');
      t.jsonb('ocr_result').nullable();
      t.text('ocr_error_message').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['referral_id']);
    });
  }

  // ── referral_workflow_events ────────────────────────────────────────────
  if (!(await knex.schema.hasTable('referral_workflow_events'))) {
    await knex.schema.createTable('referral_workflow_events', (t) => {
      t.bigIncrements('id').primary();
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('referral_id').notNullable().references('id').inTable('referrals').onDelete('CASCADE');
      t.string('event_type', 50).notNullable();
      t.uuid('performed_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.text('notes').nullable();
      t.string('outcome', 100).nullable();
      t.timestamp('event_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['referral_id', 'event_at']);
    });
  }

  // ── ereferrals ──────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('ereferrals'))) {
    await knex.schema.createTable('ereferrals', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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

      t.index(['clinic_id', 'status']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 7 — Medications & prescriptions
  // ══════════════════════════════════════════════════════════════════════════

  // ── drug_products ───────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('drug_products'))) {
    await knex.schema.createTable('drug_products', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').nullable().references('id').inTable('clinics').onDelete('SET NULL');
      t.string('generic_name', 300).notNullable();
      t.string('brand_name', 300).nullable();
      t.string('form', 100).nullable();
      t.string('strength', 100).nullable();
      t.string('unit', 50).nullable();
      t.string('route', 50).notNullable().defaultTo('oral');
      t.string('schedule', 20).nullable();
      t.string('pbs_code', 20).nullable();
      t.boolean('pbs_listed').notNullable().defaultTo(false);
      t.boolean('is_authority_required').notNullable().defaultTo(false);
      t.boolean('is_controlled').notNullable().defaultTo(false);
      t.string('atc_code', 20).nullable();
      t.string('drug_class', 100).nullable();
      t.boolean('is_lai').notNullable().defaultTo(false);
      t.boolean('is_clozapine').notNullable().defaultTo(false);
      t.text('contraindications').nullable();
      t.jsonb('common_interactions').notNullable().defaultTo('[]');
      t.text('monitoring_requirements').nullable();
      t.string('dose_range', 100).nullable();
      t.string('data_source', 50).notNullable().defaultTo('MIMS');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['generic_name']);
      t.index(['is_active']);
    });
  }

  // ── patient_medications ─────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('patient_medications'))) {
    await knex.schema.createTable('patient_medications', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('drug_product_id').nullable().references('id').inTable('drug_products').onDelete('SET NULL');
      t.string('drug_code', 50).nullable();
      t.string('drug_label', 300).notNullable();
      t.string('generic_name', 300).nullable();
      t.string('brand_name', 300).nullable();
      t.string('dose', 100).notNullable();
      t.string('dose_unit', 50).nullable();
      t.string('route', 50).notNullable().defaultTo('oral');
      t.string('frequency', 100).notNullable();
      t.text('instructions').nullable();
      t.text('indication').nullable();
      t.date('start_date').nullable();
      t.date('end_date').nullable();
      t.string('status', 30).notNullable().defaultTo('active');
      t.text('reason_for_cessation').nullable();
      t.boolean('is_regular').notNullable().defaultTo(true);
      t.boolean('is_prn').notNullable().defaultTo(false);
      t.boolean('is_lai').notNullable().defaultTo(false);
      t.jsonb('taper_schedule').nullable();
      t.string('source', 30).notNullable().defaultTo('manual');
      t.uuid('prescribed_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.uuid('recorded_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'patient_id']);
      t.index(['patient_id', 'status']);
    });
  }

  // ── prescriptions ───────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('prescriptions'))) {
    await knex.schema.createTable('prescriptions', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('drug_product_id').nullable().references('id').inTable('drug_products').onDelete('SET NULL');
      t.uuid('prescribed_by_staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
      t.uuid('patient_medication_id').nullable().references('id').inTable('patient_medications').onDelete('SET NULL');
      t.string('generic_name', 300).notNullable();
      t.string('brand_name', 300).nullable();
      t.string('dose', 100).notNullable();
      t.string('route', 50).notNullable();
      t.string('frequency', 100).notNullable();
      t.text('directions').nullable();
      t.integer('quantity').notNullable();
      t.integer('repeats').notNullable().defaultTo(0);
      t.string('pbs_item_code', 20).nullable();
      t.boolean('is_authority').notNullable().defaultTo(false);
      t.string('authority_code', 50).nullable();
      t.boolean('is_s8').notNullable().defaultTo(false);
      t.string('prescription_type', 30).notNullable().defaultTo('standard');
      t.string('status', 30).notNullable().defaultTo('draft');
      t.boolean('safescript_checked').notNullable().defaultTo(false);
      t.timestamp('safescript_checked_at', { useTz: true }).nullable();
      t.jsonb('safescript_result').nullable();
      t.string('erx_token', 200).nullable();
      t.string('erx_dsp_id', 100).nullable();
      t.timestamp('erx_submitted_at', { useTz: true }).nullable();
      t.boolean('is_electronic').notNullable().defaultTo(true);
      t.date('prescribed_date').notNullable();
      t.date('expiry_date').nullable();
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'patient_id']);
      t.index(['prescribed_by_staff_id']);
      t.index(['status']);
    });
  }

  // ── erx_tokens ──────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('erx_tokens'))) {
    await knex.schema.createTable('erx_tokens', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 8 — Patient clinical data
  // ══════════════════════════════════════════════════════════════════════════

  // ── patient_allergies ───────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('patient_allergies'))) {
    await knex.schema.createTable('patient_allergies', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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
  }

  // ── patient_flags ───────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('patient_flags'))) {
    await knex.schema.createTable('patient_flags', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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
  }

  // ── patient_contacts ────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('patient_contacts'))) {
    await knex.schema.createTable('patient_contacts', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.string('given_name', 100).notNullable();
      t.string('family_name', 100).nullable();
      t.string('relationship', 100).nullable();
      t.string('phone_mobile', 30).nullable();
      t.string('phone_home', 30).nullable();
      t.string('email', 255).nullable();
      t.boolean('is_emergency_contact').notNullable().defaultTo(false);
      t.boolean('is_carer').notNullable().defaultTo(false);
      t.boolean('has_consent').notNullable().defaultTo(false);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['patient_id']);
    });
  }

  // ── patient_providers ───────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('patient_providers'))) {
    await knex.schema.createTable('patient_providers', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('clinic_id').nullable().references('id').inTable('clinics').onDelete('SET NULL');
      t.string('provider_type', 50).nullable();
      t.string('provider_name', 200).nullable();
      t.string('provider_practice', 200).nullable();
      t.string('provider_phone', 30).nullable();
      t.string('provider_fax', 30).nullable();
      t.string('provider_email', 255).nullable();
      t.string('provider_number', 30).nullable();
      t.text('provider_address').nullable();
      t.boolean('is_primary').defaultTo(false);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['patient_id']);
    });
  }

  // ── risk_assessments ────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('risk_assessments'))) {
    await knex.schema.createTable('risk_assessments', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('template_submission_id').nullable();
      t.string('assessment_type', 50).notNullable().defaultTo('clinical');
      t.decimal('total_score').nullable();
      t.string('score_band', 50).nullable();
      t.jsonb('interpretation_detail').nullable();
      t.string('overall_risk_level', 30).notNullable().defaultTo('low');
      t.boolean('suicide_risk').notNullable().defaultTo(false);
      t.boolean('self_harm_risk').notNullable().defaultTo(false);
      t.boolean('harm_to_others_risk').notNullable().defaultTo(false);
      t.boolean('absconding_risk').notNullable().defaultTo(false);
      t.boolean('vulnerability_risk').notNullable().defaultTo(false);
      t.text('protective_factors').nullable();
      t.text('risk_narrative').nullable();
      t.text('risk_management_plan').nullable();
      t.boolean('safety_plan_in_place').notNullable().defaultTo(false);
      t.text('safety_plan_summary').nullable();
      t.uuid('assessed_by_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
      t.date('assessment_date').notNullable();
      t.date('review_date').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'patient_id']);
      t.index(['patient_id', 'assessment_date']);
    });
  }

  // ── safety_plans ────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('safety_plans'))) {
    await knex.schema.createTable('safety_plans', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.jsonb('content').nullable();
      t.string('status', 30).notNullable().defaultTo('active');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['patient_id']);
    });
  }

  // ── advance_directives ──────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('advance_directives'))) {
    await knex.schema.createTable('advance_directives', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('type', 100).notNullable();
      t.jsonb('content').nullable();
      t.string('status', 30).notNullable().defaultTo('active');
      t.date('valid_from').nullable();
      t.date('valid_until').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['patient_id']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 9 — Pathology
  // ══════════════════════════════════════════════════════════════════════════

  // ── pathology_orders ────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('pathology_orders'))) {
    await knex.schema.createTable('pathology_orders', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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
      t.index(['status']);
    });
  }

  // ── pathology_results ───────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('pathology_results'))) {
    await knex.schema.createTable('pathology_results', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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
      t.uuid('flag_task_id').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['pathology_order_id']);
      t.index(['patient_id', 'test_code']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 10 — LAI & Clozapine
  // ══════════════════════════════════════════════════════════════════════════

  // ── lai_schedules ───────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('lai_schedules'))) {
    await knex.schema.createTable('lai_schedules', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('drug_product_id').nullable().references('id').inTable('drug_products').onDelete('SET NULL');
      t.uuid('prescriber_staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
      t.string('drug_name', 300).notNullable();
      t.string('dose_mg', 50).notNullable();
      t.integer('frequency_days').notNullable().defaultTo(28);
      t.string('injection_site', 50).notNullable().defaultTo('gluteal');
      t.string('injection_technique', 20).notNullable().defaultTo('IM');
      t.string('needle_gauge', 20).nullable();
      t.text('indication').nullable();
      t.boolean('loading_dose_required').notNullable().defaultTo(false);
      t.integer('loading_doses_required').notNullable().defaultTo(0);
      t.integer('loading_doses_given').notNullable().defaultTo(0);
      t.boolean('oral_overlap_required').notNullable().defaultTo(false);
      t.date('oral_overlap_end_date').nullable();
      t.date('start_date').notNullable();
      t.date('first_due_date').notNullable();
      t.date('next_due_date').nullable();
      t.date('last_given_date').nullable();
      t.date('end_date').nullable();
      t.integer('baseline_aims_score').nullable();
      t.date('last_aims_date').nullable();
      t.date('next_aims_due_date').nullable();
      t.string('status', 30).notNullable().defaultTo('active');
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'patient_id']);
      t.index(['patient_id', 'status']);
      t.index(['next_due_date']);
    });
  }

  // ── lai_given ───────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('lai_given'))) {
    await knex.schema.createTable('lai_given', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('lai_schedule_id').notNullable().references('id').inTable('lai_schedules').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('administered_by_staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
      t.uuid('schedule_id').nullable();
      t.uuid('administered_by_id').nullable();
      t.string('outcome', 30).notNullable().defaultTo('given');
      t.date('given_date').notNullable();
      t.string('dose_given_mg', 50).nullable();
      t.string('dose_given', 50).nullable();
      t.string('injection_site', 50).nullable();
      t.string('batch_number', 100).nullable();
      t.date('expiry_date').nullable();
      t.string('refusal_reason', 300).nullable();
      t.date('deferred_to_date').nullable();
      t.date('next_due_date').nullable();
      t.boolean('aims_due').defaultTo(false);
      t.boolean('aims_completed').defaultTo(false);
      t.uuid('aims_response_id').nullable();
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['lai_schedule_id']);
      t.index(['patient_id', 'given_date']);
    });
  }

  // ── aims_assessments ────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('aims_assessments'))) {
    await knex.schema.createTable('aims_assessments', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('lai_schedule_id').nullable().references('id').inTable('lai_schedules').onDelete('SET NULL');
      t.uuid('assessed_by_staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
      t.date('assessment_date').notNullable();
      t.jsonb('item_scores').notNullable().defaultTo('{}');
      t.integer('total_score').nullable();
      t.string('interpretation', 100).nullable();
      t.integer('global_severity').nullable();
      t.integer('incapacitation').nullable();
      t.integer('patient_awareness').nullable();
      t.boolean('current_dental_problems').notNullable().defaultTo(false);
      t.boolean('dentures').notNullable().defaultTo(false);
      t.text('clinical_notes').nullable();
      t.boolean('is_baseline').notNullable().defaultTo(false);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['patient_id', 'assessment_date']);
      t.index(['lai_schedule_id']);
    });
  }

  // ── clozapine_registrations ─────────────────────────────────────────────
  if (!(await knex.schema.hasTable('clozapine_registrations'))) {
    await knex.schema.createTable('clozapine_registrations', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('drug_product_id').nullable().references('id').inTable('drug_products').onDelete('SET NULL');
      t.uuid('prescriber_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.date('registration_date').notNullable();
      t.string('dispenser_pharmacy', 200).nullable();
      t.decimal('current_dose_mg').nullable();
      t.string('titration_phase', 30).notNullable().defaultTo('initiation');
      t.integer('monitoring_week').nullable();
      t.string('monitoring_frequency', 30).notNullable().defaultTo('weekly');
      t.date('last_anc_date').nullable();
      t.decimal('last_anc_value').nullable();
      t.string('anc_status', 30).notNullable().defaultTo('unknown');
      t.date('last_wbc_date').nullable();
      t.decimal('last_wbc_value').nullable();
      t.date('next_blood_due_date').nullable();
      t.date('physical_health_check_due').nullable();
      t.date('ceased_date').nullable();
      t.text('ceased_reason').nullable();
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'patient_id']);
    });
  }

  // ── clozapine_blood_results ─────────────────────────────────────────────
  if (!(await knex.schema.hasTable('clozapine_blood_results'))) {
    await knex.schema.createTable('clozapine_blood_results', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('registration_id').notNullable().references('id').inTable('clozapine_registrations').onDelete('CASCADE');
      t.uuid('recorded_by_staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
      t.date('collection_date').notNullable();
      t.date('resulted_date').nullable();
      t.decimal('anc_value').nullable();
      t.decimal('wbc_value').nullable();
      t.decimal('neutrophils_pct').nullable();
      t.string('anc_status', 30).notNullable().defaultTo('unknown');
      t.boolean('flag_raised').notNullable().defaultTo(false);
      t.string('flag_type', 50).nullable();
      t.string('lab_name', 200).nullable();
      t.string('lab_reference', 100).nullable();
      t.text('clinical_notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['registration_id']);
      t.index(['patient_id', 'collection_date']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 11 — Legal orders & MHA
  // ══════════════════════════════════════════════════════════════════════════

  // ── legal_orders ────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('legal_orders'))) {
    await knex.schema.createTable('legal_orders', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('order_type_id').notNullable().references('id').inTable('legal_order_types').onDelete('RESTRICT');
      t.string('order_number', 50).nullable();
      t.date('start_date').notNullable();
      t.date('expiry_date').nullable();
      t.date('review_date').nullable();
      t.string('status', 30).notNullable().defaultTo('active');
      t.string('issuing_authority', 200).nullable();
      t.text('conditions').nullable();
      t.text('notes').nullable();
      t.boolean('auto_flagged').notNullable().defaultTo(false);
      t.uuid('created_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'patient_id']);
      t.index(['patient_id', 'status']);
      t.index(['expiry_date']);
    });
  }

  // ── legal_order_type_configs ────────────────────────────────────────────
  if (!(await knex.schema.hasTable('legal_order_type_configs'))) {
    await knex.schema.createTable('legal_order_type_configs', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('name', 200).notNullable();
      t.string('category', 100).notNullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('sort_order').notNullable().defaultTo(0);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
    });
  }

  // ── patient_legal_orders ────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('patient_legal_orders'))) {
    await knex.schema.createTable('patient_legal_orders', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('order_type_id').notNullable();
      t.uuid('entered_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.string('order_number', 50).nullable();
      t.date('start_date').notNullable();
      t.date('end_date').nullable();
      t.date('review_date').nullable();
      t.date('next_application_date').nullable();
      t.string('status', 30).notNullable().defaultTo('active');
      t.text('notes').nullable();
      t.text('ai_summary').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['patient_id', 'status']);
      t.index(['clinic_id']);
    });
  }

  // ── patient_legal_attachments ───────────────────────────────────────────
  if (!(await knex.schema.hasTable('patient_legal_attachments'))) {
    await knex.schema.createTable('patient_legal_attachments', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('legal_order_id').nullable();
      t.string('category', 50).notNullable().defaultTo('order');
      t.string('filename', 500).notNullable();
      t.string('mime_type', 100).nullable();
      t.integer('file_size').nullable();
      t.text('file_path').notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['patient_id']);
      t.index(['legal_order_id']);
    });
  }

  // ── mha_reviews ─────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('mha_reviews'))) {
    await knex.schema.createTable('mha_reviews', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('legal_order_id').notNullable().references('id').inTable('legal_orders').onDelete('CASCADE');
      t.uuid('order_id').nullable();
      t.string('review_type', 50).notNullable();
      t.date('review_date').notNullable();
      t.string('outcome', 50).nullable();
      t.text('notes').nullable();
      t.text('clinical_notes').nullable();
      t.date('next_review_date').nullable();
      t.uuid('reviewed_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.uuid('reviewed_by_id').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['legal_order_id']);
      t.index(['patient_id']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 12 — Alerts & attachments
  // ══════════════════════════════════════════════════════════════════════════

  // ── alert_types ─────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('alert_types'))) {
    await knex.schema.createTable('alert_types', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('name', 200).notNullable();
      t.string('severity', 30).notNullable().defaultTo('medium');
      t.string('color', 20).nullable();
      t.text('plan_template').nullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('sort_order').notNullable().defaultTo(0);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
    });
  }

  // ── patient_alerts ──────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('patient_alerts'))) {
    await knex.schema.createTable('patient_alerts', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('alert_type_id').notNullable().references('id').inTable('alert_types').onDelete('RESTRICT');
      t.uuid('entered_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.string('title', 300).notNullable();
      t.text('notes').nullable();
      t.text('management_plan').nullable();
      t.string('severity', 30).notNullable().defaultTo('medium');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.boolean('show_flag').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('resolved_at', { useTz: true }).nullable();

      t.index(['patient_id', 'is_active']);
      t.index(['clinic_id']);
    });
  }

  // ── patient_alert_attachments ───────────────────────────────────────────
  if (!(await knex.schema.hasTable('patient_alert_attachments'))) {
    await knex.schema.createTable('patient_alert_attachments', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_alert_id').notNullable().references('id').inTable('patient_alerts').onDelete('CASCADE');
      t.string('filename', 500).notNullable();
      t.string('mime_type', 100).nullable();
      t.integer('file_size').nullable();
      t.text('file_path').notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['patient_alert_id']);
    });
  }

  // ── patient_attachments ─────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('patient_attachments'))) {
    await knex.schema.createTable('patient_attachments', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('uploaded_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.string('filename', 500).notNullable();
      t.string('label', 300).nullable();
      t.string('mime_type', 100).nullable();
      t.integer('file_size').nullable();
      t.text('file_path').notNullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['patient_id']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 13 — Messaging, tasks, escalations
  // ══════════════════════════════════════════════════════════════════════════

  // ── escalations ─────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('escalations'))) {
    await knex.schema.createTable('escalations', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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

      t.index(['clinic_id', 'status']);
      t.index(['patient_id']);
    });
  }

  // ── escalation_events ───────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('escalation_events'))) {
    await knex.schema.createTable('escalation_events', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('escalation_id').nullable().references('id').inTable('escalations').onDelete('CASCADE');
      t.uuid('actor_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.string('event_type', 50).nullable();
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['escalation_id']);
    });
  }

  // ── message_threads ─────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('message_threads'))) {
    await knex.schema.createTable('message_threads', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('created_by_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
      t.uuid('patient_id').nullable().references('id').inTable('patients').onDelete('SET NULL');
      t.string('subject', 300).notNullable();
      t.timestamp('last_message_at', { useTz: true }).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id']);
      t.index(['patient_id']);
    });
  }

  // ── message_thread_participants ─────────────────────────────────────────
  if (!(await knex.schema.hasTable('message_thread_participants'))) {
    await knex.schema.createTable('message_thread_participants', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('thread_id').notNullable().references('id').inTable('message_threads').onDelete('CASCADE');
      t.uuid('user_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
      t.timestamp('last_read_at', { useTz: true }).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.unique(['thread_id', 'user_id']);
    });
  }

  // ── messages ────────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('messages'))) {
    await knex.schema.createTable('messages', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('thread_id').nullable().references('id').inTable('message_threads').onDelete('CASCADE');
      t.uuid('sender_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.uuid('clinic_id').nullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.text('content').nullable();
      t.boolean('is_read').defaultTo(false);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['thread_id', 'created_at']);
    });
  }

  // ── tasks ───────────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('tasks'))) {
    await knex.schema.createTable('tasks', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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

      t.index(['clinic_id', 'status']);
      t.index(['assigned_to_id', 'status']);
      t.index(['patient_id']);
      t.index(['due_date']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 14 — AI & LLM
  // ══════════════════════════════════════════════════════════════════════════

  // ── llm_interactions ────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('llm_interactions'))) {
    await knex.schema.createTable('llm_interactions', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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

      t.index(['clinic_id', 'created_at']);
      t.index(['user_id']);
      t.index(['feature']);
    });
  }

  // ── ai_training_feedback ────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('ai_training_feedback'))) {
    await knex.schema.createTable('ai_training_feedback', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').nullable().references('id').inTable('clinics').onDelete('SET NULL');
      t.uuid('staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.uuid('interaction_id').nullable().references('id').inTable('llm_interactions').onDelete('SET NULL');
      t.string('feedback_type', 50).nullable();
      t.integer('rating').nullable();
      t.text('comments').nullable();
      t.text('original_output').nullable();
      t.text('corrected_output').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['interaction_id']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 15 — Assessments, correspondence, contacts, outcomes
  // ══════════════════════════════════════════════════════════════════════════

  // ── assessment_responses ────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('assessment_responses'))) {
    await knex.schema.createTable('assessment_responses', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').nullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('clinic_id').nullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.uuid('template_id').nullable();
      t.string('assessment_type', 100).nullable();
      t.jsonb('responses').defaultTo('{}');
      t.decimal('total_score').nullable();
      t.string('severity', 50).nullable();
      t.string('collection_occasion', 50).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['patient_id']);
      t.index(['clinic_id', 'assessment_type']);
    });
  }

  // ── correspondence_letters ──────────────────────────────────────────────
  if (!(await knex.schema.hasTable('correspondence_letters'))) {
    await knex.schema.createTable('correspondence_letters', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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
      t.uuid('template_id').nullable();
      t.uuid('generated_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.text('notes').nullable();
      t.string('sent_via', 50).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('sent_at', { useTz: true }).nullable();
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'patient_id']);
      t.index(['clinic_id', 'status']);
    });
  }

  // ── contact_records ─────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('contact_records'))) {
    await knex.schema.createTable('contact_records', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.string('contact_type', 50).notNullable();
      t.date('contact_date').notNullable();
      t.time('contact_time').nullable();
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
      t.uuid('template_id').nullable();
      t.string('status', 30).notNullable().defaultTo('draft');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id', 'patient_id']);
      t.index(['clinic_id', 'contact_date']);
      t.index(['episode_id']);
    });
  }

  // ── outcome_measures ────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('outcome_measures'))) {
    await knex.schema.createTable('outcome_measures', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.string('measure_type', 100).notNullable();
      t.string('collection_occasion', 50).nullable();
      t.decimal('total_score').nullable();
      t.jsonb('items').nullable();
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['patient_id', 'measure_type']);
      t.index(['clinic_id']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 16 — Group sessions, beds, carers
  // ══════════════════════════════════════════════════════════════════════════

  // ── group_sessions ──────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('group_sessions'))) {
    await knex.schema.createTable('group_sessions', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('facilitator_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.string('name', 200).notNullable();
      t.string('group_type', 50).nullable();
      t.string('program', 100).nullable();
      t.date('session_date').notNullable();
      t.time('start_time').nullable();
      t.time('end_time').nullable();
      t.integer('duration_min').nullable();
      t.string('location', 200).nullable();
      t.text('notes').nullable();
      t.string('status', 30).notNullable().defaultTo('scheduled');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id', 'session_date']);
    });
  }

  // ── group_session_attendees ─────────────────────────────────────────────
  if (!(await knex.schema.hasTable('group_session_attendees'))) {
    await knex.schema.createTable('group_session_attendees', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('group_session_id').notNullable().references('id').inTable('group_sessions').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.string('attendance_status', 30).notNullable().defaultTo('attended');
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['group_session_id']);
      t.index(['patient_id']);
    });
  }

  // ── beds ────────────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('beds'))) {
    await knex.schema.createTable('beds', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('org_unit_id').nullable();
      t.string('ward', 100).nullable();
      t.string('room', 50).nullable();
      t.string('bed_label', 50).notNullable();
      t.string('bed_type', 50).nullable();
      t.string('status', 30).notNullable().defaultTo('available');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id', 'status']);
    });
  }

  // ── bed_movements ───────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('bed_movements'))) {
    await knex.schema.createTable('bed_movements', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('bed_id').notNullable().references('id').inTable('beds').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('movement_type', 30).notNullable();
      t.timestamp('movement_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.uuid('authorised_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['bed_id']);
      t.index(['patient_id']);
    });
  }

  // ── carers ──────────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('carers'))) {
    await knex.schema.createTable('carers', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('given_name', 100).notNullable();
      t.string('family_name', 100).nullable();
      t.string('relationship', 100).nullable();
      t.string('phone', 30).nullable();
      t.string('email', 255).nullable();
      t.boolean('is_primary').notNullable().defaultTo(false);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['patient_id']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 17 — Treatment, transitions, voice
  // ══════════════════════════════════════════════════════════════════════════

  // ── treatment_pathways ──────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('treatment_pathways'))) {
    await knex.schema.createTable('treatment_pathways', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('name', 200).notNullable();
      t.string('status', 30).notNullable().defaultTo('active');
      t.jsonb('milestones').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['patient_id']);
    });
  }

  // ── treatment_plans ─────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('treatment_plans'))) {
    await knex.schema.createTable('treatment_plans', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('clinic_id').nullable().references('id').inTable('clinics').onDelete('SET NULL');
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
  }

  // ── planned_transitions ─────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('planned_transitions'))) {
    await knex.schema.createTable('planned_transitions', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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
  }

  // ── planned_transition_assignments ──────────────────────────────────────
  if (!(await knex.schema.hasTable('planned_transition_assignments'))) {
    await knex.schema.createTable('planned_transition_assignments', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('transition_id').notNullable().references('id').inTable('planned_transitions').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('to_staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
      t.string('to_team', 100).nullable();
      t.string('status', 30).notNullable().defaultTo('pending');
      t.text('handover_notes').nullable();
      t.timestamp('executed_at', { useTz: true }).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['transition_id']);
      t.index(['patient_id']);
    });
  }

  // ── voice_scripts ───────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('voice_scripts'))) {
    await knex.schema.createTable('voice_scripts', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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
  }

  // ── voice_calls ─────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('voice_calls'))) {
    await knex.schema.createTable('voice_calls', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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
  }

  // ── voice_patient_preferences ───────────────────────────────────────────
  if (!(await knex.schema.hasTable('voice_patient_preferences'))) {
    await knex.schema.createTable('voice_patient_preferences', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 18 — Reporting, audit, subscriptions, branding, config
  // ══════════════════════════════════════════════════════════════════════════

  // ── report_runs ─────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('report_runs'))) {
    await knex.schema.createTable('report_runs', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('requested_by_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
      t.string('report_type', 100).notNullable();
      t.jsonb('filters').notNullable();
      t.string('format', 20).notNullable().defaultTo('json');
      t.string('status', 30).notNullable().defaultTo('completed');
      t.integer('total_rows').notNullable().defaultTo(0);
      t.jsonb('result_data').nullable();
      t.string('error_message', 500).nullable();
      t.timestamp('generated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id', 'report_type']);
    });
  }

  // ── audit_log ───────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('audit_log'))) {
    await knex.schema.createTable('audit_log', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').nullable().references('id').inTable('clinics').onDelete('SET NULL');
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
      t.index(['staff_id']);
      t.index(['entity_type', 'entity_id']);
      t.index(['table_name', 'record_id']);
    });
  }

  // ── subscriber_branding ─────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('subscriber_branding'))) {
    await knex.schema.createTable('subscriber_branding', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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
  }

  // ── subscriptions ───────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('subscriptions'))) {
    await knex.schema.createTable('subscriptions', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('plan_type', 50).notNullable();
      t.integer('seats').notNullable().defaultTo(1);
      t.decimal('price_per_month').notNullable();
      t.decimal('price_per_year').nullable();
      t.decimal('discount_percent').nullable();
      t.decimal('discount_amount').nullable();
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
  }

  // ── clinic_thresholds ───────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('clinic_thresholds'))) {
    await knex.schema.createTable('clinic_thresholds', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').nullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.string('threshold_key', 100).nullable();
      t.decimal('threshold_value').nullable();
      t.string('unit', 50).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id', 'threshold_key']);
    });
  }

  // ── clinic_contact_options ──────────────────────────────────────────────
  if (!(await knex.schema.hasTable('clinic_contact_options'))) {
    await knex.schema.createTable('clinic_contact_options', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.jsonb('locations').nullable();
      t.jsonb('programs').nullable();
      t.jsonb('service_recipient_types').nullable();
      t.jsonb('contact_media_types').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
    });
  }

  // ── hotspots ────────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('hotspots'))) {
    await knex.schema.createTable('hotspots', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.string('hotspot_type', 50).nullable();
      t.text('reason').nullable();
      t.string('severity', 30).nullable();
      t.boolean('is_active').defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id', 'patient_id']);
    });
  }

  // ── restrictive_interventions ───────────────────────────────────────────
  if (!(await knex.schema.hasTable('restrictive_interventions'))) {
    await knex.schema.createTable('restrictive_interventions', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.string('intervention_type', 100).nullable();
      t.timestamp('start_time', { useTz: true }).nullable();
      t.timestamp('end_time', { useTz: true }).nullable();
      t.integer('duration_minutes').nullable();
      t.text('reason').nullable();
      t.uuid('authorised_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.uuid('recorded_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.text('outcome').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id', 'patient_id']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 19 — Billing
  // ══════════════════════════════════════════════════════════════════════════

  // ── billing_accounts ────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('billing_accounts'))) {
    await knex.schema.createTable('billing_accounts', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').nullable().references('id').inTable('patients').onDelete('SET NULL');
      t.string('account_type', 50).nullable();
      t.string('medicare_number', 30).nullable();
      t.string('dva_number', 30).nullable();
      t.string('private_health_fund', 100).nullable();
      t.string('member_number', 50).nullable();
      t.boolean('is_active').defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id', 'patient_id']);
    });
  }

  // ── invoices ────────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('invoices'))) {
    await knex.schema.createTable('invoices', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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

      t.index(['clinic_id', 'status']);
      t.index(['patient_id']);
    });
  }

  // ── invoice_line_items ──────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('invoice_line_items'))) {
    await knex.schema.createTable('invoice_line_items', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('invoice_id').nullable().references('id').inTable('invoices').onDelete('CASCADE');
      t.string('mbs_item_code', 20).nullable();
      t.string('description', 300).nullable();
      t.integer('fee_cents').nullable();
      t.integer('quantity').defaultTo(1);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['invoice_id']);
    });
  }

  // ── payments ────────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('payments'))) {
    await knex.schema.createTable('payments', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('invoice_id').nullable().references('id').inTable('invoices').onDelete('SET NULL');
      t.uuid('clinic_id').nullable().references('id').inTable('clinics').onDelete('SET NULL');
      t.integer('amount_cents').nullable();
      t.string('payment_method', 50).nullable();
      t.string('reference', 100).nullable();
      t.string('status', 30).defaultTo('completed');
      t.timestamp('paid_at', { useTz: true }).defaultTo(knex.fn.now());
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['invoice_id']);
      t.index(['clinic_id']);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TIER 20 — Clinical review / consultation domain objects
  // ══════════════════════════════════════════════════════════════════════════

  // ── diagnoses ───────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('diagnoses'))) {
    await knex.schema.createTable('diagnoses', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('created_by_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
      t.string('icd_code', 20).notNullable();
      t.string('description', 500).notNullable();
      t.date('diagnosed_date').notNullable();
      t.string('status', 30).notNullable().defaultTo('active');
      t.boolean('is_primary').notNullable().defaultTo(false);
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'patient_id']);
      t.index(['patient_id', 'status']);
    });
  }

  // ── consultations ───────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('consultations'))) {
    await knex.schema.createTable('consultations', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('clinician_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
      t.timestamp('encounter_date', { useTz: true }).notNullable();
      t.string('encounter_type', 50).notNullable().defaultTo('consultation');
      t.integer('duration_minutes').nullable();
      t.text('presenting_complaints').nullable();
      t.jsonb('mse').nullable();
      t.text('plan_text').nullable();
      t.uuid('note_id').nullable();
      t.string('status', 30).notNullable().defaultTo('draft');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'patient_id']);
      t.index(['clinician_id']);
    });
  }

  // ── engagement_scores ───────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('engagement_scores'))) {
    await knex.schema.createTable('engagement_scores', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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
  }

  // ── key_issues ──────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('key_issues'))) {
    await knex.schema.createTable('key_issues', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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
  }

  // ── review_plans ────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('review_plans'))) {
    await knex.schema.createTable('review_plans', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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
  }

  // ── clinical_reviews ────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('clinical_reviews'))) {
    await knex.schema.createTable('clinical_reviews', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
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
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Viva / Patient App tables (absorbed from SQL sidecar files in
  //  Phase 0.7.1 so migrate:latest from empty works without a two-
  //  phase SQL execution step)
  // ══════════════════════════════════════════════════════════════════════════

  if (!(await knex.schema.hasTable('patient_invites'))) {
    await knex.schema.createTable('patient_invites', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
      t.uuid('patient_id').notNullable().references('id').inTable('patients');
      t.string('code', 6).notNullable();
      t.uuid('qr_token').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      t.timestamp('expires_at', { useTz: true }).notNullable();
      t.timestamp('used_at', { useTz: true }).nullable();
      t.uuid('created_by').nullable().references('id').inTable('staff');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['patient_id']);
      t.index(['clinic_id']);
    });
  }

  if (!(await knex.schema.hasTable('patient_app_accounts'))) {
    await knex.schema.createTable('patient_app_accounts', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
      t.uuid('patient_id').notNullable().references('id').inTable('patients');
      t.string('phone', 20).nullable();
      t.string('email', 255).nullable();
      t.string('password_hash', 255).notNullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.boolean('mfa_enabled').notNullable().defaultTo(false);
      t.string('mfa_secret', 64).nullable();
      t.timestamp('last_login_at', { useTz: true }).nullable();
      t.integer('failed_login_attempts').notNullable().defaultTo(0);
      t.timestamp('locked_until', { useTz: true }).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['clinic_id', 'patient_id']);
      t.unique(['clinic_id', 'phone']);
      t.index(['patient_id']);
      t.index(['clinic_id']);
    });
  }

  if (!(await knex.schema.hasTable('patient_tracking'))) {
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
      t.index(['patient_id', 'tracking_type']);
      t.index(['clinic_id']);
    });
  }

  if (!(await knex.schema.hasTable('patient_tasks'))) {
    await knex.schema.createTable('patient_tasks', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
      t.uuid('patient_id').notNullable().references('id').inTable('patients');
      t.string('title', 255).notNullable();
      t.text('description').nullable();
      t.date('due_date').nullable();
      t.time('reminder_time').nullable();
      t.string('status', 20).notNullable().defaultTo('pending');
      t.timestamp('completed_at', { useTz: true }).nullable();
      t.uuid('created_by').nullable().references('id').inTable('staff');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['patient_id']);
      t.index(['clinic_id']);
    });
  }

  if (!(await knex.schema.hasTable('appointment_checklists'))) {
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
      t.index(['patient_id']);
      t.index(['clinic_id']);
    });
  }

  if (!(await knex.schema.hasTable('viva_alert_thresholds'))) {
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
      t.index(['patient_id']);
      t.index(['clinic_id']);
    });
  }

  if (!(await knex.schema.hasTable('patient_med_reminders'))) {
    await knex.schema.createTable('patient_med_reminders', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
      t.uuid('patient_id').notNullable().references('id').inTable('patients');
      t.uuid('medication_id').nullable().references('id').inTable('patient_medications');
      t.string('drug_name', 255).notNullable();
      t.string('dose', 100).nullable();
      t.text('instructions').notNullable();
      t.specificType('days_of_week', 'INTEGER[]').notNullable().defaultTo('{1,2,3,4,5,6,7}');
      t.time('reminder_time').notNullable().defaultTo('08:00');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.uuid('created_by').nullable().references('id').inTable('staff');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['patient_id']);
      t.index(['clinic_id']);
    });
  }

  if (!(await knex.schema.hasTable('patient_shared_documents'))) {
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
      t.index(['patient_id']);
      t.index(['clinic_id']);
    });
  }

  // Viva columns on existing tables
  if (await knex.schema.hasTable('patients')) {
    if (!(await knex.schema.hasColumn('patients', 'viva_triage_number'))) {
      await knex.schema.alterTable('patients', (t) => {
        t.string('viva_triage_number', 30).nullable();
      });
    }
  }
  if (await knex.schema.hasTable('appointments')) {
    if (!(await knex.schema.hasColumn('appointments', 'patient_response'))) {
      await knex.schema.alterTable('appointments', (t) => {
        t.string('patient_response', 30).nullable();
      });
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  DOWN — drops tables in reverse dependency order
// ════════════════════════════════════════════════════════════════════════════
export async function down(knex: Knex): Promise<void> {
  const tables = [
    // Tier 20 — clinical review domain
    'clinical_reviews',
    'review_plans',
    'key_issues',
    'engagement_scores',
    'consultations',
    'diagnoses',
    // Tier 19 — billing
    'payments',
    'invoice_line_items',
    'invoices',
    'billing_accounts',
    // Tier 18 — config, audit, branding
    'restrictive_interventions',
    'hotspots',
    'clinic_contact_options',
    'clinic_thresholds',
    'subscriptions',
    'subscriber_branding',
    'audit_log',
    'report_runs',
    // Tier 17 — treatment, transitions, voice
    'voice_patient_preferences',
    'voice_calls',
    'voice_scripts',
    'planned_transition_assignments',
    'planned_transitions',
    'treatment_plans',
    'treatment_pathways',
    // Tier 16 — group sessions, beds, carers
    'carers',
    'bed_movements',
    'beds',
    'group_session_attendees',
    'group_sessions',
    // Tier 15 — assessments, correspondence, contacts, outcomes
    'outcome_measures',
    'contact_records',
    'correspondence_letters',
    'assessment_responses',
    // Tier 14 — AI
    'ai_training_feedback',
    'llm_interactions',
    // Tier 13 — messaging, tasks, escalations
    'tasks',
    'messages',
    'message_thread_participants',
    'message_threads',
    'escalation_events',
    'escalations',
    // Tier 12 — alerts & attachments
    'patient_attachments',
    'patient_alert_attachments',
    'patient_alerts',
    'alert_types',
    // Tier 11 — legal orders
    'mha_reviews',
    'patient_legal_attachments',
    'patient_legal_orders',
    'legal_order_type_configs',
    'legal_orders',
    // Tier 10 — LAI & clozapine
    'clozapine_blood_results',
    'clozapine_registrations',
    'aims_assessments',
    'lai_given',
    'lai_schedules',
    // Tier 9 — pathology
    'pathology_results',
    'pathology_orders',
    // Tier 8 — patient clinical data
    'advance_directives',
    'safety_plans',
    'risk_assessments',
    'patient_providers',
    'patient_contacts',
    'patient_flags',
    'patient_allergies',
    // Tier 7 — medications & prescriptions
    'erx_tokens',
    'prescriptions',
    'patient_medications',
    'drug_products',
    // Tier 6 — appointments, referrals, waitlist
    'ereferrals',
    'referral_workflow_events',
    'referral_attachments',
    'referrals',
    'referral_sources',
    'waitlist_entries',
    'appointment_modes',
    'appointments',
    // Tier 5 — clinical notes
    'clinical_notes',
    // Tier 4 — templates
    'clinical_templates',
    'template_sections',
    'templates',
    'template_categories',
    // Tier 3 — episodes, patient team assignments
    'patient_team_assignments',
    'episodes',
    // Tier 2 — patients
    'patients',
    // Tier 1 — staff & org structure
    'staff_module_access',
    'staff_role_assignments',
    'staff_team_assignments',
    'professional_disciplines',
    'clinical_roles',
    'programs',
    'org_level_labels',
    'org_unit_programs',
    'org_units',
    'staff_settings',
    'mfa_secrets',
    'staff_permissions',
    'staff_sessions',
    'staff',
    // Tier 0 — foundation
    'investigation_types',
    'legal_order_types',
    'permissions',
    'clinics',
  ];

  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
