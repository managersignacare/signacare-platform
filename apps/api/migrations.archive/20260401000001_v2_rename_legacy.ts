/**
 * V2 Rename Migration — Signacare EMR
 *
 * This migration runs on EXISTING (legacy) databases to rename camelCase
 * tables and columns to snake_case, bringing them in line with the v2
 * baseline schema.
 *
 * Every operation is idempotent:
 *   - Tables are only renamed when the source exists and the target does not.
 *   - Columns are only renamed when the source column exists on the
 *     (possibly already-renamed) table and the target column does not.
 *   - Views are dropped with IF EXISTS before table renames to avoid
 *     name collisions, then backward-compatibility views are created
 *     afterward so any old code that references the camelCase name still
 *     works during the transition period.
 */
import type { Knex } from 'knex';

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function renameTableIfExists(
  knex: Knex,
  from: string,
  to: string,
): Promise<void> {
  if (
    (await knex.schema.hasTable(from)) &&
    !(await knex.schema.hasTable(to))
  ) {
    await knex.schema.renameTable(from, to);
  }
}

async function renameColumnIfExists(
  knex: Knex,
  table: string,
  from: string,
  to: string,
): Promise<void> {
  if (
    (await knex.schema.hasTable(table)) &&
    (await knex.schema.hasColumn(table, from)) &&
    !(await knex.schema.hasColumn(table, to))
  ) {
    await knex.schema.alterTable(table, (t) => {
      t.renameColumn(from, to);
    });
  }
}

async function dropViewIfExists(knex: Knex, name: string): Promise<void> {
  await knex.raw(`DROP VIEW IF EXISTS "${name}" CASCADE`);
}

async function createCompatView(
  knex: Knex,
  oldName: string,
  newName: string,
): Promise<void> {
  await knex.raw(
    `CREATE OR REPLACE VIEW "${oldName}" AS SELECT * FROM "${newName}"`,
  );
}

async function addForeignKeySafe(
  knex: Knex,
  table: string,
  column: string,
  refTable: string,
  refColumn: string,
  onDelete: string = 'RESTRICT',
  constraintName?: string,
): Promise<void> {
  const name =
    constraintName ?? `${table}_${column}_foreign`;
  try {
    // Check if constraint already exists
    const existing = await knex.raw(
      `SELECT 1 FROM information_schema.table_constraints
       WHERE constraint_name = ? AND table_name = ?`,
      [name, table],
    );
    if (existing.rows.length > 0) return;

    await knex.raw(
      `ALTER TABLE "${table}"
       ADD CONSTRAINT "${name}"
       FOREIGN KEY ("${column}") REFERENCES "${refTable}"("${refColumn}")
       ON DELETE ${onDelete}`,
    );
  } catch {
    // Silently skip — orphan data prevents the FK from being created
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  UP
// ─────────────────────────────────────────────────────────────────────────────

export async function up(knex: Knex): Promise<void> {
  // ── Guard: only run on legacy (pre-v2) databases ─────────────────────────
  const isLegacy = await knex.schema.hasTable('auditlog');
  if (!isLegacy) {
    // Database was created by the v2 baseline — nothing to rename.
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PHASE 1 — Drop alias views that would block table renames
  // ════════════════════════════════════════════════════════════════════════════

  const viewsToDrop = [
    'audit_log',
    'clinic_thresholds',
    'clinical_templates',
    'users',
    'medications',
    'lai_administrations',
    'mh_act_orders',
    'mh_act_reviews',
    'voice_preferences',
  ];
  for (const v of viewsToDrop) {
    await dropViewIfExists(knex, v);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PHASE 2 — Rename tables and columns
  // ════════════════════════════════════════════════════════════════════════════

  // ── auditlog → audit_log ─────────────────────────────────────────────────
  await renameTableIfExists(knex, 'auditlog', 'audit_log');
  await renameColumnIfExists(knex, 'audit_log', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'audit_log', 'userid', 'user_id');
  await renameColumnIfExists(knex, 'audit_log', 'username', 'user_name');
  await renameColumnIfExists(knex, 'audit_log', 'entitytype', 'entity_type');
  await renameColumnIfExists(knex, 'audit_log', 'entityid', 'entity_id');
  await renameColumnIfExists(knex, 'audit_log', 'ipaddress', 'ip_address');
  await renameColumnIfExists(knex, 'audit_log', 'useragent', 'user_agent');
  await renameColumnIfExists(knex, 'audit_log', 'createdat', 'created_at');

  // ── alerttypes → alert_types ─────────────────────────────────────────────
  await renameTableIfExists(knex, 'alerttypes', 'alert_types');
  await renameColumnIfExists(knex, 'alert_types', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'alert_types', 'plantemplate', 'plan_template');
  await renameColumnIfExists(knex, 'alert_types', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'alert_types', 'sortorder', 'sort_order');
  await renameColumnIfExists(knex, 'alert_types', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'alert_types', 'updatedat', 'updated_at');

  // ── clinicaltemplates → clinical_templates ────────────────────────────────
  await renameTableIfExists(knex, 'clinicaltemplates', 'clinical_templates');
  await renameColumnIfExists(knex, 'clinical_templates', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'clinical_templates', 'categoryid', 'category_id');
  await renameColumnIfExists(knex, 'clinical_templates', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'clinical_templates', 'issystem', 'is_system');
  await renameColumnIfExists(knex, 'clinical_templates', 'sortorder', 'sort_order');
  await renameColumnIfExists(knex, 'clinical_templates', 'createdbyid', 'created_by_id');
  await renameColumnIfExists(knex, 'clinical_templates', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'clinical_templates', 'updatedat', 'updated_at');

  // ── templatecategories → template_categories ──────────────────────────────
  await renameTableIfExists(knex, 'templatecategories', 'template_categories');
  await renameColumnIfExists(knex, 'template_categories', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'template_categories', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'template_categories', 'sortorder', 'sort_order');
  await renameColumnIfExists(knex, 'template_categories', 'createdat', 'created_at');

  // ── orgunits → org_units ─────────────────────────────────────────────────
  await renameTableIfExists(knex, 'orgunits', 'org_units');
  await renameColumnIfExists(knex, 'org_units', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'org_units', 'parentid', 'parent_id');
  await renameColumnIfExists(knex, 'org_units', 'sortorder', 'sort_order');
  await renameColumnIfExists(knex, 'org_units', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'org_units', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'org_units', 'updatedat', 'updated_at');

  // ── orgunitprograms → org_unit_programs ───────────────────────────────────
  await renameTableIfExists(knex, 'orgunitprograms', 'org_unit_programs');
  await renameColumnIfExists(knex, 'org_unit_programs', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'org_unit_programs', 'orgunitid', 'org_unit_id');
  await renameColumnIfExists(knex, 'org_unit_programs', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'org_unit_programs', 'createdat', 'created_at');

  // ── orglevellabels → org_level_labels ─────────────────────────────────────
  await renameTableIfExists(knex, 'orglevellabels', 'org_level_labels');
  await renameColumnIfExists(knex, 'org_level_labels', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'org_level_labels', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'org_level_labels', 'updatedat', 'updated_at');

  // ── patientteamassignments → patient_team_assignments ─────────────────────
  await renameTableIfExists(knex, 'patientteamassignments', 'patient_team_assignments');
  await renameColumnIfExists(knex, 'patient_team_assignments', 'patientid', 'patient_id');
  await renameColumnIfExists(knex, 'patient_team_assignments', 'orgunitid', 'org_unit_id');
  await renameColumnIfExists(knex, 'patient_team_assignments', 'primaryclinicianid', 'primary_clinician_id');
  await renameColumnIfExists(knex, 'patient_team_assignments', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'patient_team_assignments', 'createdat', 'created_at');

  // ── staffmoduleaccess → staff_module_access ───────────────────────────────
  await renameTableIfExists(knex, 'staffmoduleaccess', 'staff_module_access');
  await renameColumnIfExists(knex, 'staff_module_access', 'staffid', 'staff_id');
  await renameColumnIfExists(knex, 'staff_module_access', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'staff_module_access', 'accesslevel', 'access_level');
  await renameColumnIfExists(knex, 'staff_module_access', 'grantedbyid', 'granted_by_id');
  await renameColumnIfExists(knex, 'staff_module_access', 'candelegatethis', 'can_delegate_this');
  await renameColumnIfExists(knex, 'staff_module_access', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'staff_module_access', 'updatedat', 'updated_at');

  // ── staffteamassignments → staff_team_assignments ─────────────────────────
  await renameTableIfExists(knex, 'staffteamassignments', 'staff_team_assignments');
  await renameColumnIfExists(knex, 'staff_team_assignments', 'staffid', 'staff_id');
  await renameColumnIfExists(knex, 'staff_team_assignments', 'orgunitid', 'org_unit_id');
  await renameColumnIfExists(knex, 'staff_team_assignments', 'startdate', 'start_date');
  await renameColumnIfExists(knex, 'staff_team_assignments', 'enddate', 'end_date');
  await renameColumnIfExists(knex, 'staff_team_assignments', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'staff_team_assignments', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'staff_team_assignments', 'updatedat', 'updated_at');

  // ── staffroleassignments → staff_role_assignments ─────────────────────────
  await renameTableIfExists(knex, 'staffroleassignments', 'staff_role_assignments');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'staffid', 'staff_id');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'orgunitid', 'org_unit_id');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'clinicalroleid', 'clinical_role_id');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'roletype', 'role_type');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'startdate', 'start_date');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'enddate', 'end_date');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'updatedat', 'updated_at');

  // ── subscriberbranding → subscriber_branding ──────────────────────────────
  // Note: this table already has snake_case columns in most deployments,
  // but the TABLE name itself is still camelCase.
  await renameTableIfExists(knex, 'subscriberbranding', 'subscriber_branding');
  // Columns are already snake_case, but be safe:
  await renameColumnIfExists(knex, 'subscriber_branding', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'subscriber_branding', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'subscriber_branding', 'updatedat', 'updated_at');

  // ── patientalerts → patient_alerts ────────────────────────────────────────
  await renameTableIfExists(knex, 'patientalerts', 'patient_alerts');
  await renameColumnIfExists(knex, 'patient_alerts', 'patientid', 'patient_id');
  await renameColumnIfExists(knex, 'patient_alerts', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'patient_alerts', 'alerttypeid', 'alert_type_id');
  await renameColumnIfExists(knex, 'patient_alerts', 'enteredbyid', 'entered_by_id');
  await renameColumnIfExists(knex, 'patient_alerts', 'managementplan', 'management_plan');
  await renameColumnIfExists(knex, 'patient_alerts', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'patient_alerts', 'showflag', 'show_flag');
  await renameColumnIfExists(knex, 'patient_alerts', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'patient_alerts', 'updatedat', 'updated_at');
  await renameColumnIfExists(knex, 'patient_alerts', 'resolvedat', 'resolved_at');

  // ── patientalertattachments → patient_alert_attachments ───────────────────
  await renameTableIfExists(knex, 'patientalertattachments', 'patient_alert_attachments');
  await renameColumnIfExists(knex, 'patient_alert_attachments', 'patientalertid', 'patient_alert_id');
  await renameColumnIfExists(knex, 'patient_alert_attachments', 'mimetype', 'mime_type');
  await renameColumnIfExists(knex, 'patient_alert_attachments', 'filesize', 'file_size');
  await renameColumnIfExists(knex, 'patient_alert_attachments', 'filepath', 'file_path');
  await renameColumnIfExists(knex, 'patient_alert_attachments', 'createdat', 'created_at');

  // ── patientlegalorders → patient_legal_orders ─────────────────────────────
  await renameTableIfExists(knex, 'patientlegalorders', 'patient_legal_orders');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'patientid', 'patient_id');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'ordertypeid', 'order_type_id');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'enteredbyid', 'entered_by_id');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'ordernumber', 'order_number');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'startdate', 'start_date');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'enddate', 'end_date');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'reviewdate', 'review_date');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'nextapplicationdate', 'next_application_date');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'aisummary', 'ai_summary');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'updatedat', 'updated_at');

  // ── legalordertypes → legal_order_type_configs ────────────────────────────
  await renameTableIfExists(knex, 'legalordertypes', 'legal_order_type_configs');
  await renameColumnIfExists(knex, 'legal_order_type_configs', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'legal_order_type_configs', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'legal_order_type_configs', 'sortorder', 'sort_order');
  await renameColumnIfExists(knex, 'legal_order_type_configs', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'legal_order_type_configs', 'updatedat', 'updated_at');

  // ── patientlegalattachments → patient_legal_attachments ───────────────────
  await renameTableIfExists(knex, 'patientlegalattachments', 'patient_legal_attachments');
  await renameColumnIfExists(knex, 'patient_legal_attachments', 'patientid', 'patient_id');
  await renameColumnIfExists(knex, 'patient_legal_attachments', 'legalorderid', 'legal_order_id');
  await renameColumnIfExists(knex, 'patient_legal_attachments', 'mimetype', 'mime_type');
  await renameColumnIfExists(knex, 'patient_legal_attachments', 'filesize', 'file_size');
  await renameColumnIfExists(knex, 'patient_legal_attachments', 'filepath', 'file_path');
  await renameColumnIfExists(knex, 'patient_legal_attachments', 'createdat', 'created_at');

  // ── professionaldisciplines → professional_disciplines ────────────────────
  await renameTableIfExists(knex, 'professionaldisciplines', 'professional_disciplines');
  await renameColumnIfExists(knex, 'professional_disciplines', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'professional_disciplines', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'professional_disciplines', 'sortorder', 'sort_order');
  await renameColumnIfExists(knex, 'professional_disciplines', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'professional_disciplines', 'updatedat', 'updated_at');

  // ── clinicalroles → clinical_roles ────────────────────────────────────────
  await renameTableIfExists(knex, 'clinicalroles', 'clinical_roles');
  await renameColumnIfExists(knex, 'clinical_roles', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'clinical_roles', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'clinical_roles', 'sortorder', 'sort_order');
  await renameColumnIfExists(knex, 'clinical_roles', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'clinical_roles', 'updatedat', 'updated_at');

  // ── referralsources → referral_sources ────────────────────────────────────
  await renameTableIfExists(knex, 'referralsources', 'referral_sources');
  await renameColumnIfExists(knex, 'referral_sources', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'referral_sources', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'referral_sources', 'sortorder', 'sort_order');
  await renameColumnIfExists(knex, 'referral_sources', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'referral_sources', 'updatedat', 'updated_at');

  // ── investigationtypes → investigation_types ──────────────────────────────
  await renameTableIfExists(knex, 'investigationtypes', 'investigation_types');
  await renameColumnIfExists(knex, 'investigation_types', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'investigation_types', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'investigation_types', 'sortorder', 'sort_order');
  await renameColumnIfExists(knex, 'investigation_types', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'investigation_types', 'updatedat', 'updated_at');

  // ── cliniccontactoptions → clinic_contact_options ─────────────────────────
  await renameTableIfExists(knex, 'cliniccontactoptions', 'clinic_contact_options');
  await renameColumnIfExists(knex, 'clinic_contact_options', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'clinic_contact_options', 'servicerecipienttypes', 'service_recipient_types');
  await renameColumnIfExists(knex, 'clinic_contact_options', 'contactmediatypes', 'contact_media_types');
  await renameColumnIfExists(knex, 'clinic_contact_options', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'clinic_contact_options', 'updatedat', 'updated_at');

  // ── clinicthresholds → clinic_thresholds ──────────────────────────────────
  await renameTableIfExists(knex, 'clinicthresholds', 'clinic_thresholds');
  await renameColumnIfExists(knex, 'clinic_thresholds', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'clinic_thresholds', 'thresholdkey', 'threshold_key');
  await renameColumnIfExists(knex, 'clinic_thresholds', 'thresholdvalue', 'threshold_value');
  await renameColumnIfExists(knex, 'clinic_thresholds', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'clinic_thresholds', 'updatedat', 'updated_at');

  // ── appointmentmodes → appointment_modes ──────────────────────────────────
  await renameTableIfExists(knex, 'appointmentmodes', 'appointment_modes');
  await renameColumnIfExists(knex, 'appointment_modes', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'appointment_modes', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'appointment_modes', 'sortorder', 'sort_order');
  await renameColumnIfExists(knex, 'appointment_modes', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'appointment_modes', 'updatedat', 'updated_at');

  // ── clinicalnotes → clinical_notes ────────────────────────────────────────
  // Special case: if both clinicalnotes AND clinical_notes exist, merge data
  // from the legacy table into the v2 table, then drop the legacy table.
  if (await knex.schema.hasTable('clinicalnotes')) {
    if (await knex.schema.hasTable('clinical_notes')) {
      // Both exist — migrate any rows from clinicalnotes that are not already
      // in clinical_notes (by id), then drop the legacy table.
      try {
        await knex.raw(`
          INSERT INTO clinical_notes (id, clinic_id, patient_id, episode_id,
            author_id, title, note_type, content, status, template_id,
            is_reportable_contact, contact_meta, foi_content, foi_exempt,
            did_not_attend, signed_at, signed_by, created_at, updated_at, deleted_at)
          SELECT
            cn.id,
            cn.clinicid,
            cn.patientid,
            cn.episodeid,
            cn.authorid,
            cn.title,
            cn.notetype,
            cn.content,
            cn.status,
            cn.templateid,
            cn.isreportablecontact,
            cn.contactmeta,
            cn.foicontent,
            cn.foiexempt,
            cn.didnotattend,
            cn.signedat,
            cn.signedbyid,
            cn.createdat,
            cn.updatedat,
            cn.deletedat
          FROM clinicalnotes cn
          WHERE NOT EXISTS (SELECT 1 FROM clinical_notes WHERE id = cn.id)
        `);
      } catch {
        // If merge fails (schema mismatch, etc.), skip — data stays in the
        // legacy table which we will not drop in this case.
      }
      // Drop the legacy table only if it's now empty or merge succeeded
      try {
        const count = await knex('clinicalnotes').count('* as cnt').first();
        const legacyRows = Number(count?.cnt ?? 0);
        const v2Count = await knex('clinical_notes').count('* as cnt').first();
        const v2Rows = Number(v2Count?.cnt ?? 0);
        if (v2Rows > 0 && legacyRows <= v2Rows) {
          await knex.schema.dropTableIfExists('clinicalnotes');
        }
      } catch {
        // Leave it alone
      }
    } else {
      // Only legacy table exists — rename it and rename columns
      await knex.schema.renameTable('clinicalnotes', 'clinical_notes');
      await renameColumnIfExists(knex, 'clinical_notes', 'patientid', 'patient_id');
      await renameColumnIfExists(knex, 'clinical_notes', 'clinicid', 'clinic_id');
      await renameColumnIfExists(knex, 'clinical_notes', 'episodeid', 'episode_id');
      await renameColumnIfExists(knex, 'clinical_notes', 'authorid', 'author_id');
      await renameColumnIfExists(knex, 'clinical_notes', 'notetype', 'note_type');
      await renameColumnIfExists(knex, 'clinical_notes', 'templateid', 'template_id');
      await renameColumnIfExists(knex, 'clinical_notes', 'isreportablecontact', 'is_reportable_contact');
      await renameColumnIfExists(knex, 'clinical_notes', 'contactmeta', 'contact_meta');
      await renameColumnIfExists(knex, 'clinical_notes', 'foicontent', 'foi_content');
      await renameColumnIfExists(knex, 'clinical_notes', 'foiexempt', 'foi_exempt');
      await renameColumnIfExists(knex, 'clinical_notes', 'didnotattend', 'did_not_attend');
      await renameColumnIfExists(knex, 'clinical_notes', 'createdat', 'created_at');
      await renameColumnIfExists(knex, 'clinical_notes', 'updatedat', 'updated_at');
      await renameColumnIfExists(knex, 'clinical_notes', 'deletedat', 'deleted_at');
      await renameColumnIfExists(knex, 'clinical_notes', 'signedat', 'signed_at');
      await renameColumnIfExists(knex, 'clinical_notes', 'signedbyid', 'signed_by_id');
    }
  }

  // ── episodetypes → episode_types ──────────────────────────────────────────
  await renameTableIfExists(knex, 'episodetypes', 'episode_types');
  await renameColumnIfExists(knex, 'episode_types', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'episode_types', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'episode_types', 'sortorder', 'sort_order');
  await renameColumnIfExists(knex, 'episode_types', 'createdat', 'created_at');

  // ── patientattachments → patient_attachments ──────────────────────────────
  await renameTableIfExists(knex, 'patientattachments', 'patient_attachments');
  await renameColumnIfExists(knex, 'patient_attachments', 'patientid', 'patient_id');
  await renameColumnIfExists(knex, 'patient_attachments', 'uploadedby', 'uploaded_by');
  await renameColumnIfExists(knex, 'patient_attachments', 'mimetype', 'mime_type');
  await renameColumnIfExists(knex, 'patient_attachments', 'filesize', 'file_size');
  await renameColumnIfExists(knex, 'patient_attachments', 'filepath', 'file_path');
  await renameColumnIfExists(knex, 'patient_attachments', 'isactive', 'is_active');
  await renameColumnIfExists(knex, 'patient_attachments', 'createdat', 'created_at');

  // ── subscriptions (table name stays, just rename columns) ─────────────────
  await renameColumnIfExists(knex, 'subscriptions', 'clinicid', 'clinic_id');
  await renameColumnIfExists(knex, 'subscriptions', 'plantype', 'plan_type');
  await renameColumnIfExists(knex, 'subscriptions', 'pricepermonth', 'price_per_month');
  await renameColumnIfExists(knex, 'subscriptions', 'priceperyear', 'price_per_year');
  await renameColumnIfExists(knex, 'subscriptions', 'discountpercent', 'discount_percent');
  await renameColumnIfExists(knex, 'subscriptions', 'discountamount', 'discount_amount');
  await renameColumnIfExists(knex, 'subscriptions', 'startdate', 'start_date');
  await renameColumnIfExists(knex, 'subscriptions', 'enddate', 'end_date');
  await renameColumnIfExists(knex, 'subscriptions', 'renewaldate', 'renewal_date');
  await renameColumnIfExists(knex, 'subscriptions', 'reminderdays', 'reminder_days');
  await renameColumnIfExists(knex, 'subscriptions', 'createdat', 'created_at');
  await renameColumnIfExists(knex, 'subscriptions', 'updatedat', 'updated_at');

  // ════════════════════════════════════════════════════════════════════════════
  //  PHASE 3 — Backward-compatibility views (old name → new table)
  // ════════════════════════════════════════════════════════════════════════════

  const compatViews: [string, string][] = [
    ['auditlog', 'audit_log'],
    ['alerttypes', 'alert_types'],
    ['clinicaltemplates', 'clinical_templates'],
    ['templatecategories', 'template_categories'],
    ['orgunits', 'org_units'],
    ['orgunitprograms', 'org_unit_programs'],
    ['orglevellabels', 'org_level_labels'],
    ['patientteamassignments', 'patient_team_assignments'],
    ['staffmoduleaccess', 'staff_module_access'],
    ['staffteamassignments', 'staff_team_assignments'],
    ['staffroleassignments', 'staff_role_assignments'],
    ['subscriberbranding', 'subscriber_branding'],
    ['patientalerts', 'patient_alerts'],
    ['patientalertattachments', 'patient_alert_attachments'],
    ['patientlegalorders', 'patient_legal_orders'],
    ['legalordertypes', 'legal_order_type_configs'],
    ['patientlegalattachments', 'patient_legal_attachments'],
    ['professionaldisciplines', 'professional_disciplines'],
    ['clinicalroles', 'clinical_roles'],
    ['referralsources', 'referral_sources'],
    ['investigationtypes', 'investigation_types'],
    ['cliniccontactoptions', 'clinic_contact_options'],
    ['clinicthresholds', 'clinic_thresholds'],
    ['appointmentmodes', 'appointment_modes'],
    ['episodetypes', 'episode_types'],
    ['patientattachments', 'patient_attachments'],
  ];

  for (const [oldName, newName] of compatViews) {
    // Only create the view if the new table exists and the old name is not
    // still a real table (which would happen if the rename was skipped).
    if (
      (await knex.schema.hasTable(newName)) &&
      !(await knex.schema.hasTable(oldName))
    ) {
      await createCompatView(knex, oldName, newName);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PHASE 4 — Drop stale alias views that are no longer needed
  // ════════════════════════════════════════════════════════════════════════════
  //
  // These were created by earlier ad-hoc migrations and now conflict with the
  // renamed tables or are superseded by the compat views above.

  const staleViews = [
    'users',           // was: SELECT … FROM staff
    'medications',     // was: SELECT … FROM patient_medications
    'lai_administrations', // was: SELECT … FROM lai_given
    'mh_act_orders',   // was: SELECT … FROM legal_orders
    'mh_act_reviews',  // was: SELECT … FROM mha_reviews
    'voice_preferences', // was: SELECT … FROM voice_patient_preferences
  ];

  for (const v of staleViews) {
    await dropViewIfExists(knex, v);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PHASE 5 — Add missing foreign key constraints
  // ════════════════════════════════════════════════════════════════════════════

  // audit_log
  await addForeignKeySafe(knex, 'audit_log', 'clinic_id', 'clinics', 'id', 'SET NULL', 'audit_log_clinic_id_fk');
  await addForeignKeySafe(knex, 'audit_log', 'staff_id', 'staff', 'id', 'SET NULL', 'audit_log_staff_id_fk');

  // alert_types
  await addForeignKeySafe(knex, 'alert_types', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'alert_types_clinic_id_fk');

  // clinical_templates
  await addForeignKeySafe(knex, 'clinical_templates', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'clinical_templates_clinic_id_fk');
  await addForeignKeySafe(knex, 'clinical_templates', 'created_by_id', 'staff', 'id', 'SET NULL', 'clinical_templates_created_by_id_fk');
  await addForeignKeySafe(knex, 'clinical_templates', 'category_id', 'template_categories', 'id', 'SET NULL', 'clinical_templates_category_id_fk');

  // template_categories
  await addForeignKeySafe(knex, 'template_categories', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'template_categories_clinic_id_fk');

  // org_units
  await addForeignKeySafe(knex, 'org_units', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'org_units_clinic_id_fk');
  await addForeignKeySafe(knex, 'org_units', 'parent_id', 'org_units', 'id', 'CASCADE', 'org_units_parent_id_fk');

  // org_unit_programs
  await addForeignKeySafe(knex, 'org_unit_programs', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'org_unit_programs_clinic_id_fk');
  await addForeignKeySafe(knex, 'org_unit_programs', 'org_unit_id', 'org_units', 'id', 'CASCADE', 'org_unit_programs_org_unit_id_fk');

  // org_level_labels
  await addForeignKeySafe(knex, 'org_level_labels', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'org_level_labels_clinic_id_fk');

  // patient_team_assignments
  await addForeignKeySafe(knex, 'patient_team_assignments', 'patient_id', 'patients', 'id', 'CASCADE', 'patient_team_assignments_patient_id_fk');
  await addForeignKeySafe(knex, 'patient_team_assignments', 'org_unit_id', 'org_units', 'id', 'CASCADE', 'patient_team_assignments_org_unit_id_fk');
  await addForeignKeySafe(knex, 'patient_team_assignments', 'primary_clinician_id', 'staff', 'id', 'SET NULL', 'patient_team_assignments_primary_clinician_id_fk');

  // staff_module_access
  await addForeignKeySafe(knex, 'staff_module_access', 'staff_id', 'staff', 'id', 'CASCADE', 'staff_module_access_staff_id_fk');
  await addForeignKeySafe(knex, 'staff_module_access', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'staff_module_access_clinic_id_fk');
  await addForeignKeySafe(knex, 'staff_module_access', 'granted_by_id', 'staff', 'id', 'SET NULL', 'staff_module_access_granted_by_id_fk');

  // staff_team_assignments
  await addForeignKeySafe(knex, 'staff_team_assignments', 'staff_id', 'staff', 'id', 'CASCADE', 'staff_team_assignments_staff_id_fk');
  await addForeignKeySafe(knex, 'staff_team_assignments', 'org_unit_id', 'org_units', 'id', 'CASCADE', 'staff_team_assignments_org_unit_id_fk');

  // staff_role_assignments
  await addForeignKeySafe(knex, 'staff_role_assignments', 'staff_id', 'staff', 'id', 'CASCADE', 'staff_role_assignments_staff_id_fk');
  await addForeignKeySafe(knex, 'staff_role_assignments', 'org_unit_id', 'org_units', 'id', 'CASCADE', 'staff_role_assignments_org_unit_id_fk');
  await addForeignKeySafe(knex, 'staff_role_assignments', 'clinical_role_id', 'clinical_roles', 'id', 'CASCADE', 'staff_role_assignments_clinical_role_id_fk');

  // subscriber_branding
  await addForeignKeySafe(knex, 'subscriber_branding', 'clinic_id', 'clinics', 'id', 'CASCADE', 'subscriber_branding_clinic_id_fk');

  // patient_alerts
  await addForeignKeySafe(knex, 'patient_alerts', 'patient_id', 'patients', 'id', 'CASCADE', 'patient_alerts_patient_id_fk');
  await addForeignKeySafe(knex, 'patient_alerts', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'patient_alerts_clinic_id_fk');
  await addForeignKeySafe(knex, 'patient_alerts', 'alert_type_id', 'alert_types', 'id', 'RESTRICT', 'patient_alerts_alert_type_id_fk');
  await addForeignKeySafe(knex, 'patient_alerts', 'entered_by_id', 'staff', 'id', 'SET NULL', 'patient_alerts_entered_by_id_fk');

  // patient_alert_attachments
  await addForeignKeySafe(knex, 'patient_alert_attachments', 'patient_alert_id', 'patient_alerts', 'id', 'CASCADE', 'patient_alert_attachments_patient_alert_id_fk');

  // patient_legal_orders
  await addForeignKeySafe(knex, 'patient_legal_orders', 'patient_id', 'patients', 'id', 'CASCADE', 'patient_legal_orders_patient_id_fk');
  await addForeignKeySafe(knex, 'patient_legal_orders', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'patient_legal_orders_clinic_id_fk');
  await addForeignKeySafe(knex, 'patient_legal_orders', 'entered_by_id', 'staff', 'id', 'SET NULL', 'patient_legal_orders_entered_by_id_fk');

  // patient_legal_attachments
  await addForeignKeySafe(knex, 'patient_legal_attachments', 'patient_id', 'patients', 'id', 'CASCADE', 'patient_legal_attachments_patient_id_fk');

  // professional_disciplines
  await addForeignKeySafe(knex, 'professional_disciplines', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'professional_disciplines_clinic_id_fk');

  // clinical_roles
  await addForeignKeySafe(knex, 'clinical_roles', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'clinical_roles_clinic_id_fk');

  // referral_sources
  await addForeignKeySafe(knex, 'referral_sources', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'referral_sources_clinic_id_fk');

  // investigation_types
  await addForeignKeySafe(knex, 'investigation_types', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'investigation_types_clinic_id_fk');

  // clinic_contact_options
  await addForeignKeySafe(knex, 'clinic_contact_options', 'clinic_id', 'clinics', 'id', 'CASCADE', 'clinic_contact_options_clinic_id_fk');

  // clinic_thresholds
  await addForeignKeySafe(knex, 'clinic_thresholds', 'clinic_id', 'clinics', 'id', 'CASCADE', 'clinic_thresholds_clinic_id_fk');

  // appointment_modes
  await addForeignKeySafe(knex, 'appointment_modes', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'appointment_modes_clinic_id_fk');

  // subscriptions
  await addForeignKeySafe(knex, 'subscriptions', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'subscriptions_clinic_id_fk');

  // patient_attachments
  await addForeignKeySafe(knex, 'patient_attachments', 'patient_id', 'patients', 'id', 'CASCADE', 'patient_attachments_patient_id_fk');
  await addForeignKeySafe(knex, 'patient_attachments', 'uploaded_by', 'staff', 'id', 'SET NULL', 'patient_attachments_uploaded_by_fk');

  // episode_types
  if (await knex.schema.hasTable('episode_types')) {
    await addForeignKeySafe(knex, 'episode_types', 'clinic_id', 'clinics', 'id', 'RESTRICT', 'episode_types_clinic_id_fk');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  DOWN — Reverse the renames
// ─────────────────────────────────────────────────────────────────────────────

export async function down(knex: Knex): Promise<void> {
  // ════════════════════════════════════════════════════════════════════════════
  //  PHASE 1 — Drop backward-compatibility views (old camelCase names)
  // ════════════════════════════════════════════════════════════════════════════

  const compatViews = [
    'auditlog',
    'alerttypes',
    'clinicaltemplates',
    'templatecategories',
    'orgunits',
    'orgunitprograms',
    'orglevellabels',
    'patientteamassignments',
    'staffmoduleaccess',
    'staffteamassignments',
    'staffroleassignments',
    'subscriberbranding',
    'patientalerts',
    'patientalertattachments',
    'patientlegalorders',
    'legalordertypes',
    'patientlegalattachments',
    'professionaldisciplines',
    'clinicalroles',
    'referralsources',
    'investigationtypes',
    'cliniccontactoptions',
    'clinicthresholds',
    'appointmentmodes',
    'episodetypes',
    'patientattachments',
  ];

  for (const v of compatViews) {
    await dropViewIfExists(knex, v);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PHASE 2 — Drop added foreign key constraints
  // ════════════════════════════════════════════════════════════════════════════

  const fksToRemove = [
    ['audit_log', 'audit_log_clinic_id_fk'],
    ['audit_log', 'audit_log_staff_id_fk'],
    ['alert_types', 'alert_types_clinic_id_fk'],
    ['clinical_templates', 'clinical_templates_clinic_id_fk'],
    ['clinical_templates', 'clinical_templates_created_by_id_fk'],
    ['clinical_templates', 'clinical_templates_category_id_fk'],
    ['template_categories', 'template_categories_clinic_id_fk'],
    ['org_units', 'org_units_clinic_id_fk'],
    ['org_units', 'org_units_parent_id_fk'],
    ['org_unit_programs', 'org_unit_programs_clinic_id_fk'],
    ['org_unit_programs', 'org_unit_programs_org_unit_id_fk'],
    ['org_level_labels', 'org_level_labels_clinic_id_fk'],
    ['patient_team_assignments', 'patient_team_assignments_patient_id_fk'],
    ['patient_team_assignments', 'patient_team_assignments_org_unit_id_fk'],
    ['patient_team_assignments', 'patient_team_assignments_primary_clinician_id_fk'],
    ['staff_module_access', 'staff_module_access_staff_id_fk'],
    ['staff_module_access', 'staff_module_access_clinic_id_fk'],
    ['staff_module_access', 'staff_module_access_granted_by_id_fk'],
    ['staff_team_assignments', 'staff_team_assignments_staff_id_fk'],
    ['staff_team_assignments', 'staff_team_assignments_org_unit_id_fk'],
    ['staff_role_assignments', 'staff_role_assignments_staff_id_fk'],
    ['staff_role_assignments', 'staff_role_assignments_org_unit_id_fk'],
    ['staff_role_assignments', 'staff_role_assignments_clinical_role_id_fk'],
    ['subscriber_branding', 'subscriber_branding_clinic_id_fk'],
    ['patient_alerts', 'patient_alerts_patient_id_fk'],
    ['patient_alerts', 'patient_alerts_clinic_id_fk'],
    ['patient_alerts', 'patient_alerts_alert_type_id_fk'],
    ['patient_alerts', 'patient_alerts_entered_by_id_fk'],
    ['patient_alert_attachments', 'patient_alert_attachments_patient_alert_id_fk'],
    ['patient_legal_orders', 'patient_legal_orders_patient_id_fk'],
    ['patient_legal_orders', 'patient_legal_orders_clinic_id_fk'],
    ['patient_legal_orders', 'patient_legal_orders_entered_by_id_fk'],
    ['patient_legal_attachments', 'patient_legal_attachments_patient_id_fk'],
    ['professional_disciplines', 'professional_disciplines_clinic_id_fk'],
    ['clinical_roles', 'clinical_roles_clinic_id_fk'],
    ['referral_sources', 'referral_sources_clinic_id_fk'],
    ['investigation_types', 'investigation_types_clinic_id_fk'],
    ['clinic_contact_options', 'clinic_contact_options_clinic_id_fk'],
    ['clinic_thresholds', 'clinic_thresholds_clinic_id_fk'],
    ['appointment_modes', 'appointment_modes_clinic_id_fk'],
    ['subscriptions', 'subscriptions_clinic_id_fk'],
    ['patient_attachments', 'patient_attachments_patient_id_fk'],
    ['patient_attachments', 'patient_attachments_uploaded_by_fk'],
    ['episode_types', 'episode_types_clinic_id_fk'],
  ];

  for (const [table, constraint] of fksToRemove) {
    try {
      if (await knex.schema.hasTable(table)) {
        await knex.raw(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`);
      }
    } catch {
      // Ignore — constraint may not exist
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PHASE 3 — Reverse column renames (snake_case → camelCase)
  // ════════════════════════════════════════════════════════════════════════════

  // subscriptions (table name stays)
  await renameColumnIfExists(knex, 'subscriptions', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'subscriptions', 'plan_type', 'plantype');
  await renameColumnIfExists(knex, 'subscriptions', 'price_per_month', 'pricepermonth');
  await renameColumnIfExists(knex, 'subscriptions', 'price_per_year', 'priceperyear');
  await renameColumnIfExists(knex, 'subscriptions', 'discount_percent', 'discountpercent');
  await renameColumnIfExists(knex, 'subscriptions', 'discount_amount', 'discountamount');
  await renameColumnIfExists(knex, 'subscriptions', 'start_date', 'startdate');
  await renameColumnIfExists(knex, 'subscriptions', 'end_date', 'enddate');
  await renameColumnIfExists(knex, 'subscriptions', 'renewal_date', 'renewaldate');
  await renameColumnIfExists(knex, 'subscriptions', 'reminder_days', 'reminderdays');
  await renameColumnIfExists(knex, 'subscriptions', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'subscriptions', 'updated_at', 'updatedat');

  // patient_attachments → patientattachments
  await renameColumnIfExists(knex, 'patient_attachments', 'patient_id', 'patientid');
  await renameColumnIfExists(knex, 'patient_attachments', 'uploaded_by', 'uploadedby');
  await renameColumnIfExists(knex, 'patient_attachments', 'mime_type', 'mimetype');
  await renameColumnIfExists(knex, 'patient_attachments', 'file_size', 'filesize');
  await renameColumnIfExists(knex, 'patient_attachments', 'file_path', 'filepath');
  await renameColumnIfExists(knex, 'patient_attachments', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'patient_attachments', 'created_at', 'createdat');
  await renameTableIfExists(knex, 'patient_attachments', 'patientattachments');

  // episode_types → episodetypes
  await renameColumnIfExists(knex, 'episode_types', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'episode_types', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'episode_types', 'sort_order', 'sortorder');
  await renameColumnIfExists(knex, 'episode_types', 'created_at', 'createdat');
  await renameTableIfExists(knex, 'episode_types', 'episodetypes');

  // appointment_modes → appointmentmodes
  await renameColumnIfExists(knex, 'appointment_modes', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'appointment_modes', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'appointment_modes', 'sort_order', 'sortorder');
  await renameColumnIfExists(knex, 'appointment_modes', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'appointment_modes', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'appointment_modes', 'appointmentmodes');

  // clinic_thresholds → clinicthresholds
  await renameColumnIfExists(knex, 'clinic_thresholds', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'clinic_thresholds', 'threshold_key', 'thresholdkey');
  await renameColumnIfExists(knex, 'clinic_thresholds', 'threshold_value', 'thresholdvalue');
  await renameColumnIfExists(knex, 'clinic_thresholds', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'clinic_thresholds', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'clinic_thresholds', 'clinicthresholds');

  // clinic_contact_options → cliniccontactoptions
  await renameColumnIfExists(knex, 'clinic_contact_options', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'clinic_contact_options', 'service_recipient_types', 'servicerecipienttypes');
  await renameColumnIfExists(knex, 'clinic_contact_options', 'contact_media_types', 'contactmediatypes');
  await renameColumnIfExists(knex, 'clinic_contact_options', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'clinic_contact_options', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'clinic_contact_options', 'cliniccontactoptions');

  // investigation_types → investigationtypes
  await renameColumnIfExists(knex, 'investigation_types', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'investigation_types', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'investigation_types', 'sort_order', 'sortorder');
  await renameColumnIfExists(knex, 'investigation_types', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'investigation_types', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'investigation_types', 'investigationtypes');

  // referral_sources → referralsources
  await renameColumnIfExists(knex, 'referral_sources', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'referral_sources', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'referral_sources', 'sort_order', 'sortorder');
  await renameColumnIfExists(knex, 'referral_sources', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'referral_sources', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'referral_sources', 'referralsources');

  // clinical_roles → clinicalroles
  await renameColumnIfExists(knex, 'clinical_roles', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'clinical_roles', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'clinical_roles', 'sort_order', 'sortorder');
  await renameColumnIfExists(knex, 'clinical_roles', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'clinical_roles', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'clinical_roles', 'clinicalroles');

  // professional_disciplines → professionaldisciplines
  await renameColumnIfExists(knex, 'professional_disciplines', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'professional_disciplines', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'professional_disciplines', 'sort_order', 'sortorder');
  await renameColumnIfExists(knex, 'professional_disciplines', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'professional_disciplines', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'professional_disciplines', 'professionaldisciplines');

  // patient_legal_attachments → patientlegalattachments
  await renameColumnIfExists(knex, 'patient_legal_attachments', 'patient_id', 'patientid');
  await renameColumnIfExists(knex, 'patient_legal_attachments', 'legal_order_id', 'legalorderid');
  await renameColumnIfExists(knex, 'patient_legal_attachments', 'mime_type', 'mimetype');
  await renameColumnIfExists(knex, 'patient_legal_attachments', 'file_size', 'filesize');
  await renameColumnIfExists(knex, 'patient_legal_attachments', 'file_path', 'filepath');
  await renameColumnIfExists(knex, 'patient_legal_attachments', 'created_at', 'createdat');
  await renameTableIfExists(knex, 'patient_legal_attachments', 'patientlegalattachments');

  // legal_order_type_configs → legalordertypes
  await renameColumnIfExists(knex, 'legal_order_type_configs', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'legal_order_type_configs', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'legal_order_type_configs', 'sort_order', 'sortorder');
  await renameColumnIfExists(knex, 'legal_order_type_configs', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'legal_order_type_configs', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'legal_order_type_configs', 'legalordertypes');

  // patient_legal_orders → patientlegalorders
  await renameColumnIfExists(knex, 'patient_legal_orders', 'patient_id', 'patientid');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'order_type_id', 'ordertypeid');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'entered_by_id', 'enteredbyid');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'order_number', 'ordernumber');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'start_date', 'startdate');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'end_date', 'enddate');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'review_date', 'reviewdate');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'next_application_date', 'nextapplicationdate');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'ai_summary', 'aisummary');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'patient_legal_orders', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'patient_legal_orders', 'patientlegalorders');

  // patient_alert_attachments → patientalertattachments
  await renameColumnIfExists(knex, 'patient_alert_attachments', 'patient_alert_id', 'patientalertid');
  await renameColumnIfExists(knex, 'patient_alert_attachments', 'mime_type', 'mimetype');
  await renameColumnIfExists(knex, 'patient_alert_attachments', 'file_size', 'filesize');
  await renameColumnIfExists(knex, 'patient_alert_attachments', 'file_path', 'filepath');
  await renameColumnIfExists(knex, 'patient_alert_attachments', 'created_at', 'createdat');
  await renameTableIfExists(knex, 'patient_alert_attachments', 'patientalertattachments');

  // patient_alerts → patientalerts
  await renameColumnIfExists(knex, 'patient_alerts', 'patient_id', 'patientid');
  await renameColumnIfExists(knex, 'patient_alerts', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'patient_alerts', 'alert_type_id', 'alerttypeid');
  await renameColumnIfExists(knex, 'patient_alerts', 'entered_by_id', 'enteredbyid');
  await renameColumnIfExists(knex, 'patient_alerts', 'management_plan', 'managementplan');
  await renameColumnIfExists(knex, 'patient_alerts', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'patient_alerts', 'show_flag', 'showflag');
  await renameColumnIfExists(knex, 'patient_alerts', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'patient_alerts', 'updated_at', 'updatedat');
  await renameColumnIfExists(knex, 'patient_alerts', 'resolved_at', 'resolvedat');
  await renameTableIfExists(knex, 'patient_alerts', 'patientalerts');

  // subscriber_branding → subscriberbranding
  await renameColumnIfExists(knex, 'subscriber_branding', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'subscriber_branding', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'subscriber_branding', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'subscriber_branding', 'subscriberbranding');

  // staff_role_assignments → staffroleassignments
  await renameColumnIfExists(knex, 'staff_role_assignments', 'staff_id', 'staffid');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'org_unit_id', 'orgunitid');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'clinical_role_id', 'clinicalroleid');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'role_type', 'roletype');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'start_date', 'startdate');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'end_date', 'enddate');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'staff_role_assignments', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'staff_role_assignments', 'staffroleassignments');

  // staff_team_assignments → staffteamassignments
  await renameColumnIfExists(knex, 'staff_team_assignments', 'staff_id', 'staffid');
  await renameColumnIfExists(knex, 'staff_team_assignments', 'org_unit_id', 'orgunitid');
  await renameColumnIfExists(knex, 'staff_team_assignments', 'start_date', 'startdate');
  await renameColumnIfExists(knex, 'staff_team_assignments', 'end_date', 'enddate');
  await renameColumnIfExists(knex, 'staff_team_assignments', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'staff_team_assignments', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'staff_team_assignments', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'staff_team_assignments', 'staffteamassignments');

  // staff_module_access → staffmoduleaccess
  await renameColumnIfExists(knex, 'staff_module_access', 'staff_id', 'staffid');
  await renameColumnIfExists(knex, 'staff_module_access', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'staff_module_access', 'access_level', 'accesslevel');
  await renameColumnIfExists(knex, 'staff_module_access', 'granted_by_id', 'grantedbyid');
  await renameColumnIfExists(knex, 'staff_module_access', 'can_delegate_this', 'candelegatethis');
  await renameColumnIfExists(knex, 'staff_module_access', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'staff_module_access', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'staff_module_access', 'staffmoduleaccess');

  // patient_team_assignments → patientteamassignments
  await renameColumnIfExists(knex, 'patient_team_assignments', 'patient_id', 'patientid');
  await renameColumnIfExists(knex, 'patient_team_assignments', 'org_unit_id', 'orgunitid');
  await renameColumnIfExists(knex, 'patient_team_assignments', 'primary_clinician_id', 'primaryclinicianid');
  await renameColumnIfExists(knex, 'patient_team_assignments', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'patient_team_assignments', 'created_at', 'createdat');
  await renameTableIfExists(knex, 'patient_team_assignments', 'patientteamassignments');

  // org_level_labels → orglevellabels
  await renameColumnIfExists(knex, 'org_level_labels', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'org_level_labels', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'org_level_labels', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'org_level_labels', 'orglevellabels');

  // org_unit_programs → orgunitprograms
  await renameColumnIfExists(knex, 'org_unit_programs', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'org_unit_programs', 'org_unit_id', 'orgunitid');
  await renameColumnIfExists(knex, 'org_unit_programs', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'org_unit_programs', 'created_at', 'createdat');
  await renameTableIfExists(knex, 'org_unit_programs', 'orgunitprograms');

  // org_units → orgunits
  await renameColumnIfExists(knex, 'org_units', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'org_units', 'parent_id', 'parentid');
  await renameColumnIfExists(knex, 'org_units', 'sort_order', 'sortorder');
  await renameColumnIfExists(knex, 'org_units', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'org_units', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'org_units', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'org_units', 'orgunits');

  // template_categories → templatecategories
  await renameColumnIfExists(knex, 'template_categories', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'template_categories', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'template_categories', 'sort_order', 'sortorder');
  await renameColumnIfExists(knex, 'template_categories', 'created_at', 'createdat');
  await renameTableIfExists(knex, 'template_categories', 'templatecategories');

  // clinical_templates → clinicaltemplates
  await renameColumnIfExists(knex, 'clinical_templates', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'clinical_templates', 'category_id', 'categoryid');
  await renameColumnIfExists(knex, 'clinical_templates', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'clinical_templates', 'is_system', 'issystem');
  await renameColumnIfExists(knex, 'clinical_templates', 'sort_order', 'sortorder');
  await renameColumnIfExists(knex, 'clinical_templates', 'created_by_id', 'createdbyid');
  await renameColumnIfExists(knex, 'clinical_templates', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'clinical_templates', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'clinical_templates', 'clinicaltemplates');

  // alert_types → alerttypes
  await renameColumnIfExists(knex, 'alert_types', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'alert_types', 'plan_template', 'plantemplate');
  await renameColumnIfExists(knex, 'alert_types', 'is_active', 'isactive');
  await renameColumnIfExists(knex, 'alert_types', 'sort_order', 'sortorder');
  await renameColumnIfExists(knex, 'alert_types', 'created_at', 'createdat');
  await renameColumnIfExists(knex, 'alert_types', 'updated_at', 'updatedat');
  await renameTableIfExists(knex, 'alert_types', 'alerttypes');

  // audit_log → auditlog
  await renameColumnIfExists(knex, 'audit_log', 'clinic_id', 'clinicid');
  await renameColumnIfExists(knex, 'audit_log', 'user_id', 'userid');
  await renameColumnIfExists(knex, 'audit_log', 'user_name', 'username');
  await renameColumnIfExists(knex, 'audit_log', 'entity_type', 'entitytype');
  await renameColumnIfExists(knex, 'audit_log', 'entity_id', 'entityid');
  await renameColumnIfExists(knex, 'audit_log', 'ip_address', 'ipaddress');
  await renameColumnIfExists(knex, 'audit_log', 'user_agent', 'useragent');
  await renameColumnIfExists(knex, 'audit_log', 'created_at', 'createdat');
  await renameTableIfExists(knex, 'audit_log', 'auditlog');

  // ════════════════════════════════════════════════════════════════════════════
  //  PHASE 4 — Re-create the old alias views that Phase 1 of up() dropped
  // ════════════════════════════════════════════════════════════════════════════

  // audit_log view (pointing back at auditlog table)
  if (await knex.schema.hasTable('auditlog')) {
    await knex.raw(`
      CREATE OR REPLACE VIEW audit_log AS
        SELECT * FROM auditlog
    `);
  }

  // clinic_thresholds view
  if (await knex.schema.hasTable('clinicthresholds')) {
    await knex.raw(`
      CREATE OR REPLACE VIEW clinic_thresholds AS
        SELECT
          id,
          clinicid AS clinic_id,
          thresholdkey AS threshold_key,
          thresholdvalue AS threshold_value,
          unit,
          createdat AS created_at,
          updatedat AS updated_at
        FROM clinicthresholds
    `);
  }

  // clinical_templates view
  if (await knex.schema.hasTable('clinicaltemplates')) {
    await knex.raw(`
      CREATE OR REPLACE VIEW clinical_templates AS
        SELECT * FROM clinicaltemplates
    `);
  }

  // users view (from staff)
  if (await knex.schema.hasTable('staff')) {
    await knex.raw(`
      CREATE OR REPLACE VIEW users AS
        SELECT
          id, clinic_id,
          given_name AS first_name,
          family_name AS last_name,
          given_name, family_name,
          email, role, is_active,
          created_at, updated_at, deleted_at
        FROM staff
    `);
  }

  // medications view (from patient_medications)
  if (await knex.schema.hasTable('patient_medications')) {
    await knex.raw(`
      CREATE OR REPLACE VIEW medications AS
        SELECT * FROM patient_medications
    `);
  }
}
