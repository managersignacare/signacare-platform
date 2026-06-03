// apps/api/src/features/provisioning/provisioningService.ts
// Atomic clinic provisioning — creates clinic, admin, branding, modules,
// reference data, and subscription in a single transaction.
import { randomBytes, randomUUID } from 'crypto';
import type { AuthContext } from '@signacare/shared';
import bcrypt from 'bcryptjs';
import { seedMbsItems } from '../../seed-mbs';
import logger from '../../utils/logger';
import { generateNonBreachedPassword } from '../auth/passwordBreachService';
import { AppError, ErrorCode } from '../../shared/errors';
import { canonicalizeModuleKey } from '../../shared/moduleKeys';
import {
  AU_DISCIPLINES,
  AU_CLINICAL_ROLES,
  AU_REFERRAL_SOURCES,
  AU_ALERT_TYPES,
  AU_TEMPLATE_CATEGORIES,
  AU_APPOINTMENT_TYPES,
  type AuReferenceRow,
  type ProvisionClinicDTO,
  type ProvisionResult,
} from '@signacare/shared';

const SETTINGS_PROFILE_TAB_VISIBLE_KEY = 'settings_profile_tab_visible';

// Strong temporary password generator (16 chars, mixed case + digits + symbols)
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';
  let pw = '';
  const bytes = randomBytes(16);
  for (let i = 0; i < 16; i++) {
    pw += chars[bytes[i] % chars.length];
  }
  return pw;
}

// Reference data is sourced from the single authoritative curation in
// `packages/shared/src/au_reference_data.ts` (Phase R follow-up 2026-04-18).
// That file carries `displayName` + `sortOrder` + primary `sourceUrl` for
// every row. `seed-good-health/generators/00_reference_data.ts` reads the
// SAME arrays and upserts across existing tenants; new-tenant provisioning
// below reads them too. Both consumers therefore stay in lockstep.
const INTERNAL_REFERRAL_SOURCES: readonly AuReferenceRow[] =
  AU_REFERRAL_SOURCES.filter((r) => r.metadata.category === 'internal');
const EXTERNAL_REFERRAL_SOURCES: readonly AuReferenceRow[] =
  AU_REFERRAL_SOURCES.filter((r) => r.metadata.category === 'external');

const DEFAULT_RATING_SCALE_TEMPLATES: Array<{ name: string; category: string; type: string; content: unknown[] }> = [
  { name: 'PHQ-9 (Patient Health Questionnaire)', category: 'Rating Scales', type: 'assessment', content: [
    { label: 'Little interest or pleasure', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Feeling down, depressed, or hopeless', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Trouble falling or staying asleep', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Feeling tired or having little energy', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Poor appetite or overeating', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Feeling bad about yourself', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Trouble concentrating', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Moving or speaking slowly / being fidgety', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Thoughts of self-harm', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
  ] },
  { name: 'GAD-7 (Generalised Anxiety Disorder)', category: 'Rating Scales', type: 'assessment', content: [
    { label: 'Feeling nervous, anxious, or on edge', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Not being able to stop worrying', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Worrying too much about different things', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Trouble relaxing', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Being so restless it is hard to sit still', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Becoming easily annoyed or irritable', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Feeling afraid something awful might happen', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
  ] },
  { name: 'K10 (Kessler Psychological Distress Scale)', category: 'Rating Scales', type: 'assessment', content: [
    { label: 'Did you feel tired out for no good reason?', fieldType: 'likert', options: ['None','A little','Some','Most','All of the time'], scores: [1,2,3,4,5] },
    { label: 'Did you feel nervous?', fieldType: 'likert', options: ['None','A little','Some','Most','All of the time'], scores: [1,2,3,4,5] },
    { label: 'Did you feel so nervous nothing could calm you?', fieldType: 'likert', options: ['None','A little','Some','Most','All of the time'], scores: [1,2,3,4,5] },
    { label: 'Did you feel hopeless?', fieldType: 'likert', options: ['None','A little','Some','Most','All of the time'], scores: [1,2,3,4,5] },
    { label: 'Did you feel restless or fidgety?', fieldType: 'likert', options: ['None','A little','Some','Most','All of the time'], scores: [1,2,3,4,5] },
  ] },
  { name: 'HoNOS (Health of the Nation Outcome Scales)', category: 'Rating Scales', type: 'assessment', content: [
    { label: 'Overactive/aggressive behaviour', fieldType: 'likert', options: ['No problem','Minor','Mild','Moderately severe','Severe to very severe'], scores: [0,1,2,3,4] },
    { label: 'Non-accidental self-injury', fieldType: 'likert', options: ['No problem','Minor','Mild','Moderately severe','Severe to very severe'], scores: [0,1,2,3,4] },
    { label: 'Problem drinking or drug-taking', fieldType: 'likert', options: ['No problem','Minor','Mild','Moderately severe','Severe to very severe'], scores: [0,1,2,3,4] },
  ] },
  { name: 'LSP-16 (Life Skills Profile)', category: 'Rating Scales', type: 'assessment', content: [
    { label: 'General self-care', fieldType: 'likert', options: ['No difficulty','Slight','Moderate','Extreme'], scores: [0,1,2,3] },
  ] },
  { name: 'BPRS (Brief Psychiatric Rating Scale)', category: 'Rating Scales', type: 'assessment', content: [
    { label: 'Somatic concern', fieldType: 'likert', options: ['Not reported','Very mild','Mild','Moderate','Moderately severe','Severe','Extremely severe'], scores: [1,2,3,4,5,6,7] },
  ] },
  { name: 'AIMS (Abnormal Involuntary Movement Scale)', category: 'Rating Scales', type: 'assessment', content: [
    { label: 'Muscles of facial expression', fieldType: 'likert', options: ['None','Minimal','Mild','Moderate','Severe'], scores: [0,1,2,3,4] },
  ] },
];

const DEFAULT_PLAN_TEMPLATES: Array<{ name: string; category: string; type: string; content: unknown[] }> = [
  { name: 'Management Plan', category: 'Management Plans', type: 'management_plan', content: [
    { label: 'Current Issues', fieldType: 'textarea' },
    { label: 'Goals', fieldType: 'textarea' },
    { label: 'Interventions', fieldType: 'textarea' },
    { label: 'Review Date', fieldType: 'date' },
  ] },
  { name: 'Safety Plan', category: 'Safety Plans', type: 'safety_plan', content: [
    { label: 'Warning signs', fieldType: 'textarea' },
    { label: 'Coping strategies', fieldType: 'textarea' },
    { label: 'Reasons for living', fieldType: 'textarea' },
    { label: 'People I can contact', fieldType: 'textarea' },
    { label: 'Emergency contacts', fieldType: 'textarea' },
  ] },
  { name: 'Relapse Prevention Plan', category: 'Management Plans', type: 'relapse_prevention', content: [
    { label: 'Early warning signs', fieldType: 'textarea' },
    { label: 'Triggers', fieldType: 'textarea' },
    { label: 'Action plan', fieldType: 'textarea' },
  ] },
  { name: 'Discharge Summary', category: 'Letters', type: 'discharge_summary', content: [
    { label: 'Admission date', fieldType: 'date' },
    { label: 'Discharge date', fieldType: 'date' },
    { label: 'Diagnosis', fieldType: 'textarea' },
    { label: 'Treatment provided', fieldType: 'textarea' },
    { label: 'Follow-up plan', fieldType: 'textarea' },
  ] },
];

export async function provisionClinic(auth: AuthContext, dto: ProvisionClinicDTO): Promise<ProvisionResult> {
  const clinicId = randomUUID();
  const adminId = randomUUID();
  const normalizedAdminEmail = dto.adminEmail.trim().toLowerCase();
  const tempPassword = await generateNonBreachedPassword(
    auth,
    generateTempPassword,
    { surface: 'provisioning.create-admin-password' },
  );
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const result: ProvisionResult = {
    clinicId,
    clinicName: dto.clinicName,
    adminEmail: normalizedAdminEmail,
    adminTemporaryPassword: tempPassword,
    modulesEnabled: [],
    referenceDataSeeded: {
      disciplines: 0,
      clinicalRoles: 0,
      mbsItems: 0,
      referralSources: 0,
      alertTypes: 0,
      templateCategories: 0,
      appointmentModes: 0,
      templates: 0,
    },
    subscriptionId: null,
  };

  // Use raw admin pool intentionally. `dbAdmin` is request-transaction aware
  // and may proxy to the caller's tenant-scoped app_user transaction.
  const { adminPoolRaw } = await import('../../db/db');

  await adminPoolRaw.transaction(async (trx) => {
    // ── Step 1: Create clinic ──────────────────────────────────────────
    await trx('clinics').insert({
      id: clinicId,
      name: dto.clinicName,
      legal_name: dto.legalName ?? null,
      abn: dto.abn ?? null,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      address_line1: dto.addressStreet ?? null,
      suburb: dto.addressSuburb ?? null,
      state: dto.addressState ?? null,
      postcode: dto.addressPostcode ?? null,
      timezone: dto.timeZone,
      time_zone: dto.timeZone,
      hpio: dto.hpio,
      // Phase 0.7.5 c24 C10 (SD17) — `clinic_type` column doesn't exist
      // on `clinics`. dto.clinicType is accepted from the provisioning
      // form but is not persisted — if it matters, add a migration that
      // creates the column, then add clinic_type back to the row write
      // in the same PR.
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    logger.info({ clinicId, clinicName: dto.clinicName }, 'Clinic created');

    // From this point onward, tenant-scoped writes (staff/settings/modules/etc.)
    // must execute under the newly created clinic context.
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);

    // ── Step 2: Create admin user ──────────────────────────────────────
    const existingAdmin = await trx('staff')
      .whereRaw('LOWER(email) = LOWER(?)', [normalizedAdminEmail])
      .whereNull('deleted_at')
      .first('id');
    if (existingAdmin) {
      throw new AppError(
        'A record with this email already exists.',
        409,
        ErrorCode.CONFLICT,
        { field: 'email', table: 'staff', reason: 'admin_email_unique' },
      );
    }

    await trx('staff').insert({
      id: adminId,
      clinic_id: clinicId,
      given_name: dto.adminGivenName,
      family_name: dto.adminFamilyName,
      email: normalizedAdminEmail,
      password_hash: passwordHash,
      role: 'admin',
      is_active: true,
      phone_mobile: dto.adminPhone ?? null,
      require_mfa: false,
      has_mfa_configured: false,
      failed_login_attempts: 0,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('staff_settings')
      .insert({
        staff_id: adminId,
        setting_key: SETTINGS_PROFILE_TAB_VISIBLE_KEY,
        setting_value: dto.adminProfileTabVisible ?? true,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict(['staff_id', 'setting_key'])
      .merge({
        setting_value: dto.adminProfileTabVisible ?? true,
        updated_at: new Date(),
      });

    // Bind onboarding contact as the clinic's nominated access admin.
    await trx('clinics')
      .where({ id: clinicId })
      .update({
        nominated_admin_staff_id: adminId,
        delegated_admin_staff_id: null,
        updated_at: new Date(),
      });

    logger.info({ clinicId, adminEmail: normalizedAdminEmail }, 'Admin user created');

    // ── Step 3: Branding ───────────────────────────────────────────────
    const hasBrandingTable = await trx.schema.hasTable('subscriber_branding');
    if (hasBrandingTable) {
      const existingBranding = await trx('subscriber_branding')
        .where({ clinic_id: clinicId })
        .select('id')
        .first();

      if (existingBranding) {
        await trx('subscriber_branding')
          .where({ id: existingBranding.id })
          .update({
            sidebar_title: dto.sidebarTitle ?? dto.clinicName,
            sidebar_subtitle: dto.sidebarSubtitle ?? 'Mental Health EMR',
            updated_at: new Date(),
          });
      } else {
        await trx('subscriber_branding').insert({
          id: randomUUID(),
          clinic_id: clinicId,
          sidebar_title: dto.sidebarTitle ?? dto.clinicName,
          sidebar_subtitle: dto.sidebarSubtitle ?? 'Mental Health EMR',
          logo_url: null,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
    }

    // ── Step 4: Enable modules ─────────────────────────────────────────
    // Auto-select referral module based on clinic type
    const modules = Array.from(new Set(dto.enabledModules.map((key) => canonicalizeModuleKey(key))));
    if (dto.clinicType === 'solo_practice' && !modules.includes('referral-solo')) {
      modules.push('referral-solo');
    }
    if ((dto.clinicType === 'group_practice' || dto.clinicType === 'hospital') && !modules.includes('referral-team')) {
      modules.push('referral-team');
    }

    for (const moduleKey of modules) {
      await trx('clinic_modules').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        module_key: moduleKey,
        is_enabled: true,
        updated_at: new Date(),
      }).onConflict(['clinic_id', 'module_key']).merge({ is_enabled: true, updated_at: new Date() });
    }
    result.modulesEnabled = modules;

    // ── Step 5: Seed reference data ────────────────────────────────────

    // 5a. Disciplines
    if (dto.seedDisciplines) {
      for (const row of AU_DISCIPLINES) {
        await trx('professional_disciplines').insert({
          id: randomUUID(),
          clinic_id: clinicId,
          name: row.displayName,
          is_active: true,
          sort_order: row.sortOrder,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
      result.referenceDataSeeded.disciplines = AU_DISCIPLINES.length;
    }

    // 5b. Clinical roles
    if (dto.seedClinicalRoles) {
      for (const row of AU_CLINICAL_ROLES) {
        await trx('clinical_roles').insert({
          id: randomUUID(),
          clinic_id: clinicId,
          name: row.displayName,
          is_active: true,
          sort_order: row.sortOrder,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
      result.referenceDataSeeded.clinicalRoles = AU_CLINICAL_ROLES.length;
    }

    // 5c. Referral sources
    if (dto.seedReferralSources) {
      const hasTable = await trx.schema.hasTable('referral_sources');
      if (hasTable) {
        let sortOrder = 0;
        for (const row of INTERNAL_REFERRAL_SOURCES) {
          await trx('referral_sources').insert({
            id: randomUUID(), clinic_id: clinicId, category: 'internal',
            name: row.displayName, is_active: true, sort_order: sortOrder++,
            created_at: new Date(), updated_at: new Date(),
          });
        }
        for (const row of EXTERNAL_REFERRAL_SOURCES) {
          await trx('referral_sources').insert({
            id: randomUUID(), clinic_id: clinicId, category: 'external',
            name: row.displayName, is_active: true, sort_order: sortOrder++,
            created_at: new Date(), updated_at: new Date(),
          });
        }
        result.referenceDataSeeded.referralSources = sortOrder;
      }
    }

    // 5d. Alert types
    if (dto.seedAlertTypes) {
      const hasTable = await trx.schema.hasTable('alert_types');
      if (hasTable) {
        for (const row of AU_ALERT_TYPES) {
          await trx('alert_types').insert({
            id: randomUUID(), clinic_id: clinicId,
            name: row.displayName,
            severity: (row.metadata.severity as string | undefined) ?? 'medium',
            color: (row.metadata.color as string | undefined) ?? null,
            plan_template: (row.metadata.planTemplate as string | undefined) ?? null,
            is_active: true, sort_order: row.sortOrder,
            created_at: new Date(), updated_at: new Date(),
          });
        }
        result.referenceDataSeeded.alertTypes = AU_ALERT_TYPES.length;
      }
    }

    // ── Step 5e: Template categories ──────────────────────────────────
    const hasTemplateCats = await trx.schema.hasTable('template_categories');
    if (hasTemplateCats) {
      let catCount = 0;
      for (const row of AU_TEMPLATE_CATEGORIES) {
        const exists = await trx('template_categories').where({ clinic_id: clinicId, name: row.displayName }).first();
        if (!exists) {
          await trx('template_categories').insert({
            id: randomUUID(), clinic_id: clinicId,
            name: row.displayName, is_active: true, sort_order: row.sortOrder,
            created_at: new Date(),
          });
          catCount++;
        }
      }
      result.referenceDataSeeded.templateCategories = catCount;
    }

    // ── Step 5f: Appointment modes ──────────────────────────────────
    const hasAppointmentModes = await trx.schema.hasTable('appointment_modes');
    if (hasAppointmentModes) {
      let modeCount = 0;
      for (const row of AU_APPOINTMENT_TYPES) {
        const exists = await trx('appointment_modes').where({ clinic_id: clinicId, name: row.displayName }).first();
        if (!exists) {
          await trx('appointment_modes').insert({
            id: randomUUID(), clinic_id: clinicId,
            name: row.displayName, is_active: true, sort_order: row.sortOrder,
            created_at: new Date(), updated_at: new Date(),
          });
          modeCount++;
        }
      }
      result.referenceDataSeeded.appointmentModes = modeCount;
    }

    // ── Step 5g: Clinical templates (rating scales + plans) ─────────
    // Seed into BOTH tables:
    // - `templates` table: used by GET /api/v1/templates (admin template management)
    // - `clinical_templates` table: used by GET /api/v1/staff-settings/templates (clinical workflows)
    const hasTemplates = await trx.schema.hasTable('templates');
    const hasClinicalTemplates = await trx.schema.hasTable('clinical_templates');
    const allTemplates = [...DEFAULT_RATING_SCALE_TEMPLATES, ...DEFAULT_PLAN_TEMPLATES];
    let tmplCount = 0;

    if (hasTemplates) {
      for (let i = 0; i < allTemplates.length; i++) {
        const t = allTemplates[i];
        const exists = await trx('templates').where({ clinic_id: clinicId, name: t.name }).first();
        if (!exists) {
          await trx('templates').insert({
            id: randomUUID(), clinic_id: clinicId,
            name: t.name, type: t.type, category: t.category,
            content: JSON.stringify(t.content),
            is_active: true, status: 'published', sort_order: i,
            published_at: new Date(),
            created_at: new Date(), updated_at: new Date(),
          });
          tmplCount++;
        }
      }
    }

    if (hasClinicalTemplates && hasTemplateCats) {
      // Look up category IDs we just created
      const catRows = await trx('template_categories').where({ clinic_id: clinicId }).select('id', 'name');
      const catMap = new Map(catRows.map((c: { id: string; name: string }) => [c.name, c.id]));

      for (let i = 0; i < allTemplates.length; i++) {
        const t = allTemplates[i];
        const exists = await trx('clinical_templates').where({ clinic_id: clinicId, name: t.name }).first();
        if (!exists) {
          const categoryId = catMap.get(t.category) ?? null;
          await trx('clinical_templates').insert({
            id: randomUUID(), clinic_id: clinicId,
            category_id: categoryId,
            name: t.name, type: t.type,
            content: JSON.stringify(t.content),
            is_active: true, is_system: true, sort_order: i,
            created_at: new Date(), updated_at: new Date(),
          });
        }
      }
    }
    result.referenceDataSeeded.templates = tmplCount;

    // ── Step 6: Org level labels (standard 3-level structure) ──────────
    const hasOrgLabels = await trx.schema.hasTable('org_level_labels');
    if (hasOrgLabels) {
      const labels = [
        { level: 1, label: 'Organisation' },
        { level: 2, label: 'Division' },
        { level: 3, label: 'Unit / Team' },
      ];
      for (const l of labels) {
        await trx('org_level_labels')
          .insert({
            id: randomUUID(), clinic_id: clinicId,
            level: l.level, label: l.label,
            created_at: new Date(), updated_at: new Date(),
          })
          .onConflict(['clinic_id', 'level']).merge({ label: l.label, updated_at: new Date() });
      }

      // Create root org unit
      await trx('org_units').insert({
        id: randomUUID(), clinic_id: clinicId,
        parent_id: null, name: dto.clinicName,
        level: 1, sort_order: 0, is_active: true,
        created_at: new Date(), updated_at: new Date(),
      });
    }

    // ── Step 7: Subscription ───────────────────────────────────────────
    const hasSubscriptions = await trx.schema.hasTable('subscriptions');
    if (hasSubscriptions) {
      const subId = randomUUID();
      const startDate = new Date();
      const endDate = new Date();
      if (dto.planType === 'trial') {
        endDate.setDate(endDate.getDate() + (dto.trialDays ?? 30));
      } else if (dto.planType === 'monthly') {
        endDate.setMonth(endDate.getMonth() + 1);
      } else {
        endDate.setFullYear(endDate.getFullYear() + 1);
      }

      await trx('subscriptions').insert({
        id: subId,
        clinic_id: clinicId,
        plan_type: dto.planType,
        seats: dto.seats,
        price_per_month: 0,
        status: dto.planType === 'trial' ? 'trial' : 'active',
        start_date: startDate,
        end_date: endDate,
        renewal_date: endDate,
        reminder_days: 30,
        notes: dto.notes ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      result.subscriptionId = subId;
    }
  });

  // Seed MBS items outside the transaction (uses db connection, not trx)
  if (dto.seedMbsItems) {
    try {
      const count = await seedMbsItems(clinicId);
      result.referenceDataSeeded.mbsItems = count;
    } catch (err) {
      logger.warn({ err, clinicId }, 'MBS seed failed — can be seeded later via Power Settings');
    }
  }

  logger.info({
    clinicId,
    clinicName: dto.clinicName,
    adminEmail: dto.adminEmail,
    modules: result.modulesEnabled.length,
  }, 'Clinic provisioned successfully');

  return result;
}
